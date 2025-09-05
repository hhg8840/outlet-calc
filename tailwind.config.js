/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          mint: "#40E0D0",   // 터키옥
          dark: "#008080",   // 진한 민트
        }
      }
    }
  },
  darkMode: 'media',
  plugins: [],
}
