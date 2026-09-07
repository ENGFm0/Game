/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { party: { pink: '#ff4fa3', yellow: '#ffd23f', mint: '#3ddc97', sky: '#3fa9ff', grape: '#7b2cff', ink: '#1b1035' } },
      fontFamily: { display: ['"Baloo 2"', '"Segoe UI"', 'system-ui', 'sans-serif'] },
      keyframes: {
        wiggle: { '0%,100%': { transform: 'rotate(-4deg)' }, '50%': { transform: 'rotate(4deg)' } },
        pop: { '0%': { transform: 'scale(.6)', opacity: '0' }, '70%': { transform: 'scale(1.08)', opacity: '1' }, '100%': { transform: 'scale(1)' } },
        pulse2: { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.06)' } },
      },
      animation: { wiggle: 'wiggle 1.2s ease-in-out infinite', pop: 'pop .45s cubic-bezier(.2,.9,.3,1.3) both', pulse2: 'pulse2 1s ease-in-out infinite' },
    },
  },
  plugins: [],
};
