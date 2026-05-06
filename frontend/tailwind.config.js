/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg:      '#F8FAFC',
          primary: '#0F172A',
          accent:  '#3B82F6',
          surface: '#FFFFFF',
          muted:   '#64748B',
        },
        stock: {
          up:   '#EF4444',
          down: '#22C55E',
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans TC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
