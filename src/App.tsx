import React, { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * ===== Supabase (DB) 초기화 =====
 * Vercel 환경변수에 아래 두 값을 추가하세요.
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_ANON_KEY
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase: SupabaseClient | null = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

/**
 * ===== 플랫폼 독립 유틸 (RN 전환 대비) =====
 */
type DiscountMode = "amount" | "percent";
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const toKrw = (n: number) => (isNaN(n) ? "-" : new Intl.NumberFormat("ko-KR").format(Math.round(n)) + "원");
const krw = toKrw; // 기존 이름 유지

const step2AfterFirstDiscount = (
    basePrice: number,
    mode: DiscountMode,
    amount?: number,
    percent?: number
) => {
    if (mode === "amount") {
        const amt = clamp(amount ?? 0, 0, basePrice);
        return Math.max(0, basePrice - amt);
    }
    const p = clamp(percent ?? 0, 0, 100);
    return basePrice * (1 - p / 100);
};

const applyExtraPercent = (price: number, extraPercent: number) => price * (1 - clamp(extraPercent, 0, 100) / 100);
const simpleRefund10 = (final: number) => final * 0.1;

// Kream: 정산 = 가격*0.956 - 5500, 수수료 = 가격 - 정산
const kreamNetFromPrice = (price?: number) => (price === undefined ? undefined : price * 0.956 - 5500);
const kreamFeeFromPrice = (price?: number, net?: number) => (price !== undefined && net !== undefined ? price - net : undefined);
// Poizon: <=150k ▶ p-15000, >=450k ▶ p-45000, else ▶ p*0.9
const poizonNetFromPrice = (price?: number) => {
    if (price === undefined) return undefined;
    const p = price;
    if (p <= 150000) return p - 15000;
    if (p >= 450000) return p - 45000;
    return p * 0.9;
};

const poizonFeeFromPrice = (price?: number, net?: number) => (price !== undefined && net !== undefined ? price - net : undefined);

// ===== 숫자 포맷 유틸 (입력용) =====
const formatNumberInput = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    if (!digits) return "";
    return new Intl.NumberFormat("ko-KR").format(Number(digits));
};
const parseNumberInput = (value: string): number | undefined => {
    const digits = value.replace(/[^0-9]/g, "");
    return digits ? Number(digits) : undefined;
};


/**
 * ===== 타입 =====
 */
export type HistoryItem = {
    id: string; // uuid
    basePrice: number;
    discountMode: DiscountMode;
    baseDiscountAmount?: number;
    baseDiscountPercent?: number;
    extra: number;
    memo?: string;
    final: number;
    refund10: number;
    kreamPrice?: number;
    kreamFee?: number;
    kreamNet?: number;
    poizonPrice?: number;
    poizonFee?: number;
    poizonNet?: number;
    created_at?: string; // DB 채움
};

/**
 * ===== DB IO =====
 * 테이블명: outlet_history
 */
async function dbInsertHistory(item: HistoryItem) {
    if (!supabase) return { error: new Error("Supabase 미설정") };
    const { error } = await supabase.from("outlet_history").insert({
        id: item.id,
        memo: item.memo ?? null,
        base_price: item.basePrice,
        discount_mode: item.discountMode,
        base_discount_amount: item.baseDiscountAmount ?? null,
        base_discount_percent: item.baseDiscountPercent ?? null,
        extra: item.extra,
        final: item.final,
        refund10: item.refund10,
        kream_price: item.kreamPrice ?? null,
        kream_net: item.kreamNet ?? null,
        poizon_price: item.poizonPrice ?? null,
        poizon_net: item.poizonNet ?? null,
    });
    return { error };
}

async function dbFetchHistory(limit = 50) {
    if (!supabase) return { data: [] as HistoryItem[], error: new Error("Supabase 미설정") };
    const { data, error } = await supabase
        .from("outlet_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) return { data: [] as HistoryItem[], error };
    const mapped = (data ?? []).map((r: any) => ({
        id: r.id,
        memo: r.memo ?? undefined,
        basePrice: r.base_price,
        discountMode: r.discount_mode,
        baseDiscountAmount: r.base_discount_amount ?? undefined,
        baseDiscountPercent: r.base_discount_percent ?? undefined,
        extra: r.extra,
        final: r.final,
        refund10: r.refund10,
        kreamPrice: r.kream_price ?? undefined,
        kreamNet: r.kream_net ?? undefined,
        poizonPrice: r.poizon_price ?? undefined,
        poizonNet: r.poizon_net ?? undefined,
        created_at: r.created_at,
    })) as HistoryItem[];
    return { data: mapped, error: null };
}

async function dbDeleteHistory(id: string) {
    if (!supabase) return { error: new Error("Supabase 미설정") };
    const { error } = await supabase.from("outlet_history").delete().eq("id", id);
    return { error };
}

/**
 * ===== 컴포넌트 =====
 */
export default function OutletDiscountCalculator() {
    const [basePrice, setBasePrice] = useState<number>();
    const [discountMode, setDiscountMode] = useState<DiscountMode>("amount");
    const [baseDiscountAmount, setBaseDiscountAmount] = useState<number>();
    const [baseDiscountPercent, setBaseDiscountPercent] = useState<number>();
    const [extra, setExtra] = useState<number>();
    const [memo, setMemo] = useState<string>("");
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [kreamPrice, setKreamPrice] = useState<number | undefined>(undefined);
    const [poizonPrice, setPoizonPrice] = useState<number | undefined>(undefined);
    const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
    const [kreamPriceInput, setKreamPriceInput] = useState<string>("");
    const [poizonPriceInput, setPoizonPriceInput] = useState<string>("");


    // 초기 로드: DB 히스토리 가져오기
    useEffect(() => {
        (async () => {
            if (!supabase) return; // 로컬 개발 등에서 미설정이면 스킵
            setLoadingHistory(true);
            //const { data } = await dbFetchHistory(100);
            //if (data?.length) setHistory(data);
            setLoadingHistory(false);
        })();
    }, []);

    // 계산
    const step1 = basePrice;
    const step2 = useMemo(
        () => step2AfterFirstDiscount(basePrice, discountMode, baseDiscountAmount, baseDiscountPercent),
        [basePrice, discountMode, baseDiscountAmount, baseDiscountPercent]
    );
    const final = useMemo(() => applyExtraPercent(step2, extra), [step2, extra]);
    const refund10 = simpleRefund10(final);
    const afterRefund10 = Math.max(0, final - refund10);

    const kreamNet = useMemo(() => kreamNetFromPrice(kreamPrice), [kreamPrice]);
    const kreamFee = useMemo(() => kreamFeeFromPrice(kreamPrice, kreamNet), [kreamPrice, kreamNet]);
    const poizonNet = useMemo(() => poizonNetFromPrice(poizonPrice), [poizonPrice]);
    const poizonFee = useMemo(() => poizonFeeFromPrice(poizonPrice, poizonNet), [poizonPrice, poizonNet]);

    const saveHistory = async () => {
        const memoTrim = memo.trim();
        // 메모가 비어 있으면 저장하지 않음 (UI/DB 둘 다 스킵)
        if (!memoTrim) {
            // 필요 시 사용자 피드백
            if (typeof window !== 'undefined') {
                try { window.alert('품목정보가 비어 있어 저장하지 않습니다.'); } catch {}
            }
            return;
        }

        const newItem: HistoryItem = {
            id: (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random()}`,
            basePrice,
            discountMode,
            baseDiscountAmount: discountMode === "amount" ? clamp(baseDiscountAmount ?? 0, 0, basePrice) : undefined,
            baseDiscountPercent: discountMode === "percent" ? clamp(baseDiscountPercent ?? 0, 0, 100) : undefined,
            extra: clamp(extra, 0, 100),
            memo: memo?.trim() || undefined,
            final,
            refund10,
            kreamPrice,
            kreamFee,
            kreamNet,
            poizonPrice,
            poizonFee,
            poizonNet,
        };

        // 즉시 UI 반영
        setHistory((prev) => [newItem, ...prev]);
        setMemo("");

        // 비동기 DB 저장
        if (supabase) {
            const { error } = await dbInsertHistory(newItem);
            if (error) {
                // 실패 시 롤백(옵션). 여기서는 콘솔 경고만
                console.warn("DB 저장 실패", error.message);
            }
        }
    };

    const deleteHistory = async (id: string) => {
        setHistory((prev) => prev.filter((h) => h.id !== id));
        if (supabase) {
            const { error } = await dbDeleteHistory(id);
            if (error) console.warn("DB 삭제 실패", error.message);
        }
    };
    const clearHistory = () => setHistory([]); // 전체 삭제는 위험하여 로컬 UI만 초기화

    return (
        // <div className="min-h-screen bg-teal-50 flex items-center justify-center">
        <div className="min-h-screen bg-teal-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 grid items-start md:place-items-center p-3 md:p-6 overflow-y-auto">

            <div className="max-w-6xl w-full px-3 md:px-4">
                <div className="max-w-6xl mx-auto">
                    <h1 className="text-xl md:text-2xl font-bold mb-3 md:mb-4 text-teal-700">아울렛 계산기</h1>

                    {/* ✅ 결과 카드 — 상단 배치 */}
                    {/*<div className="bg-white p-4 md:p-5 rounded-2xl shadow">*/}
                    <div
                        className="bg-white dark:bg-slate-800 border border-transparent dark:border-slate-700 p-4 md:p-5 rounded-2xl shadow">

                        <h2 className="font-semibold mb-3 md:mb-4">결과</h2>
                        <div className="space-y-1.5 md:space-y-2 text-xs md:text-sm">
                            <div className="flex justify-between"><span>정가</span><span>{krw(step1)}</span></div>
                            <div className="flex justify-between"><span>1차 할인 적용가</span><span>{krw(step2)}</span></div>
                            <div className="border-t my-2"></div>
                            <div className="flex justify-between font-semibold text-sm md:text-base">
                                <span>최종 결제금액</span><span>{krw(final)}</span></div>

                            {/*<div className="mt-2 md:mt-3 p-2 md:p-3 bg-teal-50 rounded-xl">*/}
                            <div className="mt-2 md:mt-3 p-2 md:p-3 bg-teal-50 dark:bg-slate-700 rounded-xl">
                                <div className="flex justify-between"><span>공급가액</span><span>{krw(afterRefund10)}</span>
                                </div>
                                <div className="flex justify-between"><span>부가세액</span><span>{krw(refund10)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 md:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 text-xs md:text-sm">

                            <div>
                                <div
                                    className={`flex justify-between ${poizonNet !== undefined && poizonNet - final < 0 ? "text-red-600 font-semibold" : "text-gray-700"}`}>
                                    <span>Poizon 정산금액</span>
                                    <span>{poizonNet !== undefined ? krw(poizonNet) : "-"}</span>
                                </div>
                                <div
                                    className={`flex justify-between text-[11px] md:text-xs ${poizonNet !== undefined && poizonNet - final + refund10 < 0 ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                                    <span>Poizon 마진</span>
                                    <span>{poizonNet !== undefined ? `${krw(poizonNet - final + refund10)} (${((poizonNet - final + refund10) / (final || 1) * 100).toFixed(1)}%)` : "-"}</span>
                                </div>
                            </div>
                            <div>
                                <div
                                    className={`flex justify-between ${kreamNet !== undefined && kreamNet - final < 0 ? "text-red-600 font-semibold" : "text-gray-700"}`}>
                                    <span>Kream 정산금액</span>
                                    <span>{kreamNet !== undefined ? krw(kreamNet) : "-"}</span>
                                </div>
                                <div
                                    className={`flex justify-between text-[11px] md:text-xs ${kreamNet !== undefined && kreamNet - final < 0 ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                                    <span>Kream 마진</span>
                                    <span>{kreamNet !== undefined ? `${krw(kreamNet - final)} (${((kreamNet - final) / (final || 1) * 100).toFixed(1)}%)` : "-"}</span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 md:mt-4 flex gap-2">
                            <button
                                className="px-3 py-2 rounded border bg-teal-500 hover:bg-teal-600 text-white text-sm"
                                onClick={saveHistory}>히스토리 저장
                            </button>
                            <button className="px-3 py-2 rounded border text-sm" onClick={clearHistory}>히스토리 전체 삭제(로컬)
                            </button>
                        </div>
                    </div>

                    {/* 입력 카드 — 결과 아래로 */}
                    {/*<div className="mt-4 md:mt-6 bg-white p-4 md:p-5 rounded-2xl shadow">*/}
                    <div
                        className="mt-4 md:mt-6 bg-white dark:bg-slate-800 border border-transparent dark:border-slate-700 p-4 md:p-5 rounded-2xl shadow">

                        <h2 className="font-semibold mb-3 md:mb-4">입력</h2>

                        {/* 1) 기본 입력 */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                            <div className="flex items-center gap-2">
                                <label className="min-w-[84px] text-xs text-gray-600">품목</label>
                                <input type="text" className="flex-1 border rounded px-3 py-2 text-sm"
                                       placeholder="에어포스 등 품목코드" value={memo}
                                       onChange={(e) => setMemo(e.target.value)}/>
                            </div>

                            <div className="flex items-center gap-2">
                                <label className="min-w-[84px] text-xs text-gray-600">정가(원)</label>
                                <input inputMode="numeric" pattern="[0-9]*" type="number"
                                       className="flex-1 border rounded px-3 py-2 text-sm" value={basePrice}
                                       onChange={(e) => setBasePrice(Number(e.target.value))}/>
                            </div>

                            <div className="flex items-center gap-2">
                                <label className="min-w-[84px] text-xs text-gray-600">1차 할인</label>

                                {/* 토글 + 인풋이 겹치지 않도록 flex 수축/확장 제어 */}
                                <div className="flex-1 flex items-center gap-2 min-w-0">
                                    {/* 세그먼트 토글: 고정폭/수축 금지, 인풋 높이와 동일 */}
                                    <div className="inline-flex rounded-lg overflow-hidden border h-10 shrink-0">
                                        <button
                                            type="button"
                                            className={`px-3 h-full text-xs ${discountMode === "amount" ? "bg-teal-500 text-white" : "bg-white text-teal-600"}`}
                                            onClick={() => setDiscountMode("amount")}
                                        >
                                            금액
                                        </button>
                                        <button
                                            type="button"
                                            className={`px-3 h-full text-xs ${discountMode === "percent" ? "bg-teal-500 text-white" : "bg-white text-teal-600"}`}
                                            onClick={() => setDiscountMode("percent")}
                                        >
                                            %
                                        </button>
                                    </div>

                                    {/* 인풋: 남는 공간 모두 차지, 오버플로 방지 */}
                                    {discountMode === "amount" ? (
                                        <input
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            type="number"
                                            className="flex-1 min-w-0 h-10 border rounded px-3 text-sm"
                                            placeholder="예: 40000"
                                            value={baseDiscountAmount}
                                            onChange={(e) => setBaseDiscountAmount(Number(e.target.value))}
                                        />
                                    ) : (
                                        <div className="flex items-center gap-1 w-full min-w-0">
                                            <input
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                type="number"
                                                className="flex-1 min-w-0 h-10 border rounded px-3 text-sm"
                                                placeholder="예: 40"
                                                value={baseDiscountPercent}
                                                onChange={(e) => setBaseDiscountPercent(Number(e.target.value))}
                                            />
                                            <span className="text-xs text-gray-500 shrink-0">%</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/*<div className="flex items-center gap-2">*/}
                            {/*    <label className="min-w-[84px] text-xs text-gray-600">1차 할인</label>*/}
                            {/*    <div className="flex-1 flex items-center gap-2">*/}
                            {/*        <div className="inline-flex rounded-lg overflow-hidden border">*/}
                            {/*            <button type="button"*/}
                            {/*                    className={`px-2.5 py-1.5 text-xs ${discountMode === "amount" ? "bg-teal-500 text-white" : "bg-white text-teal-600"}`}*/}
                            {/*                    onClick={() => setDiscountMode("amount")}>금액*/}
                            {/*            </button>*/}
                            {/*            <button type="button"*/}
                            {/*                    className={`px-2.5 py-1.5 text-xs ${discountMode === "percent" ? "bg-teal-500 text-white" : "bg-white text-teal-600"}`}*/}
                            {/*                    onClick={() => setDiscountMode("percent")}>%*/}
                            {/*            </button>*/}
                            {/*        </div>*/}
                            {/*        {discountMode === "amount" ? (*/}

                            {/*            <input inputMode="numeric" pattern="[0-9]*" type="number"*/}
                            {/*                   className="flex-1 border rounded px-3 py-2 text-sm"*/}
                            {/*                   placeholder="예: 40000" value={baseDiscountAmount}*/}
                            {/*                   onChange={(e) => setBaseDiscountAmount(Number(e.target.value))}/>*/}

                            {/*        ) : (*/}

                            {/*                <input inputMode="numeric" pattern="[0-9]*" type="number"*/}
                            {/*                       className="flex-1 border rounded px-3 py-2 text-sm"*/}
                            {/*                       placeholder="예: 40" value={baseDiscountPercent}*/}
                            {/*                       onChange={(e) => setBaseDiscountPercent(Number(e.target.value))}/>*/}

                            {/*        )}*/}
                            {/*    </div>*/}
                            {/*</div>*/}

                            <div className="flex items-center gap-2">
                                <label className="min-w-[84px] text-xs text-gray-600">추가 할인(%)</label>
                                <input inputMode="numeric" pattern="[0-9]*" type="number"
                                       className="flex-1 border rounded px-3 py-2 text-sm" value={extra}
                                       onChange={(e) => setExtra(Number(e.target.value))}/>
                            </div>


                        </div>

                        {/* Kream / Poizon */}
                        <div className="mt-4 md:mt-6 grid grid-cols-1 gap-3">

                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <label className="min-w-[84px] text-xs text-gray-600">Poizon 가격</label>
                                    <input
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        type="text"
                                        className="flex-1 border rounded px-3 py-2 text-sm"
                                        placeholder="예: 66,000"
                                        value={poizonPriceInput}
                                        onChange={(e) => {
                                            const formatted = formatNumberInput(e.target.value);
                                            setPoizonPriceInput(formatted);
                                            setPoizonPrice(parseNumberInput(formatted));
                                        }}
                                    />
                                </div>
                                <div className="flex flex-wrap items-center gap-2 pl-[84px] text-[11px] text-gray-600">
                                <span
                                    className="px-2 py-1 rounded-full bg-gray-100">수수료 {poizonFee !== undefined ? krw(poizonFee) : "-"}</span>
                                    <span
                                        className={`px-2 py-1 rounded-full ${poizonNet !== undefined && poizonNet - final + refund10 < 0 ? "bg-red-100 text-red-700" : "bg-gray-100"}`}>정산 {poizonNet !== undefined ? krw(poizonNet) : "-"}</span>
                                    <span
                                        className={`px-2 py-1 rounded-full ${poizonNet !== undefined && poizonNet - final + refund10 < 0 ? "bg-red-100 text-red-700" : "bg-gray-100"}`}>마진 {poizonNet !== undefined ? `${krw(poizonNet - final + refund10)} (${((poizonNet - final + refund10) / (final || 1) * 100).toFixed(1)}%)` : "-"}</span>
                                </div>
                            </div>
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <label className="min-w-[84px] text-xs text-gray-600">Kream 가격</label>
                                    <input
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        type="text"
                                        className="flex-1 border rounded px-3 py-2 text-sm"
                                        placeholder="예: 65,000"
                                        value={kreamPriceInput}
                                        onChange={(e) => {
                                            const formatted = formatNumberInput(e.target.value);
                                            setKreamPriceInput(formatted);
                                            setKreamPrice(parseNumberInput(formatted));
                                        }}
                                    />

                                </div>
                                <div className="flex flex-wrap items-center gap-2 pl-[84px] text-[11px] text-gray-600">
                                <span
                                    className="px-2 py-1 rounded-full bg-gray-100">수수료 {kreamFee !== undefined ? krw(kreamFee) : "-"}</span>
                                    <span
                                        className={`px-2 py-1 rounded-full ${kreamNet !== undefined && kreamNet - final < 0 ? "bg-red-100 text-red-700" : "bg-gray-100"}`}>정산 {kreamNet !== undefined ? krw(kreamNet) : "-"}</span>
                                    <span
                                        className={`px-2 py-1 rounded-full ${kreamNet !== undefined && kreamNet - final < 0 ? "bg-red-100 text-red-700" : "bg-gray-100"}`}>마진 {kreamNet !== undefined ? `${krw(kreamNet - final)} (${((kreamNet - final) / (final || 1) * 100).toFixed(1)}%)` : "-"}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 히스토리 카드 */}
                    {/*<div className="mt-4 md:mt-6 bg-white p-4 md:p-5 rounded-2xl shadow text-xs md:text-sm">*/}
                    <div
                        className="mt-4 md:mt-6 bg-white dark:bg-slate-800 border border-transparent dark:border-slate-700 p-4 md:p-5 rounded-2xl shadow text-xs md:text-sm">

                        <h2 className="font-semibold mb-3">계산 히스토리 {loadingHistory &&
                            <span className="text-gray-400">(불러오는 중…)</span>}</h2>
                        {history.length === 0 ? (
                            <p className="text-gray-500">저장된 기록이 없습니다.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-left">
                                    <thead>
                                    <tr className="border-b align-bottom">
                                        <th rowSpan={2} className="py-2 px-2">메모</th>
                                        <th rowSpan={2} className="py-2 px-2">정가</th>
                                        <th rowSpan={2} className="py-2 px-2">1차</th>
                                        <th rowSpan={2} className="py-2 px-2">추가%</th>
                                        <th rowSpan={2} className="py-2 px-2">최종가</th>
                                        <th rowSpan={2} className="py-2 px-2">부가세</th>
                                        <th colSpan={2} className="py-2 px-2 text-center">Kream</th>
                                        <th colSpan={2} className="py-2 px-2 text-center">Poizon</th>
                                        <th rowSpan={2} className="py-2 px-2">삭제</th>
                                    </tr>
                                    <tr className="border-b">
                                        <th className="py-2 px-2">가격</th>
                                        <th className="py-2 px-2">마진</th>
                                        <th className="py-2 px-2">가격</th>
                                        <th className="py-2 px-2">마진</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {history.map((h) => {
                                        const kreamNeg = h.kreamNet !== undefined && h.kreamNet - h.final < 0;
                                        const poizonNeg = h.poizonNet !== undefined && h.poizonNet - h.final < 0;
                                        const firstDiscountCell = h.discountMode === "amount"
                                            ? (h.baseDiscountAmount !== undefined ? krw(h.baseDiscountAmount) : "-")
                                            : (h.baseDiscountPercent !== undefined ? `${h.baseDiscountPercent}%` : "-");
                                        return (
                                            <React.Fragment key={h.id}>
                                                <tr className="border-b align-top">
                                                    <td className="py-2 px-2">{h.memo || "-"}</td>
                                                    <td className="py-2 px-2">{krw(h.basePrice)}</td>
                                                    <td className="py-2 px-2">{firstDiscountCell}</td>
                                                    <td className="py-2 px-2">{h.extra}%</td>
                                                    <td className="py-2 px-2 font-semibold">{krw(h.final)}</td>
                                                    <td className="py-2 px-2">{krw(h.refund10)}</td>
                                                    <td className="py-2 px-2">{h.kreamPrice ? krw(h.kreamPrice) : "-"}</td>
                                                    <td className={`py-2 px-2 ${kreamNeg ? "text-red-600 font-semibold" : ""}`}>{h.kreamNet !== undefined ? `${krw(h.kreamNet - h.final)} (${(((h.kreamNet - h.final) / (h.final || 1)) * 100).toFixed(1)}%)` : "-"}</td>
                                                    <td className="py-2 px-2">{h.poizonPrice ? krw(h.poizonPrice) : "-"}</td>
                                                    <td className={`py-2 px-2 ${poizonNeg ? "text-red-600 font-semibold" : ""}`}>{h.poizonNet !== undefined ? `${krw(h.poizonNet - h.final)} (${(((h.poizonNet - h.final) / (h.final || 1)) * 100).toFixed(1)}%)` : "-"}</td>
                                                    <td className="py-2 px-2">
                                                        <button className="text-red-600"
                                                                onClick={() => deleteHistory(h.id)}>삭제
                                                        </button>
                                                    </td>
                                                </tr>
                                            </React.Fragment>
                                        );
                                    })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}
