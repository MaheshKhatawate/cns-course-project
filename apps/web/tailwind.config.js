/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'flow-ltr': { '0%': { left: '0%', transform: 'translateX(0)', opacity: '0' }, '15%, 85%': { opacity: '1' }, '100%': { left: '100%', transform: 'translateX(-100%)', opacity: '0' } },
        'flow-rtl': { '0%': { left: '100%', transform: 'translateX(-100%)', opacity: '0' }, '15%, 85%': { opacity: '1' }, '100%': { left: '0%', transform: 'translateX(0)', opacity: '0' } },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        'flow-ltr': 'flow-ltr 2.4s ease-in-out infinite',
        'flow-rtl': 'flow-rtl 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
