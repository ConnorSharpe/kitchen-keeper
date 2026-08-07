/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--kk-green-800) / <alpha-value>)',
        'primary-hover': 'rgb(var(--kk-green-900) / <alpha-value>)',
        'on-primary': 'rgb(255 255 255 / <alpha-value>)',

        surface: 'rgb(var(--kk-cream-100) / <alpha-value>)',
        page: 'rgb(var(--kk-cream-300) / <alpha-value>)',
        border: 'rgb(var(--kk-cream-500) / <alpha-value>)',
        ink: 'rgb(var(--kk-ink-900) / <alpha-value>)',
        'ink-muted': 'rgb(var(--kk-gray-600) / <alpha-value>)',
        'ink-subtle': 'rgb(var(--kk-gray-500) / <alpha-value>)',

        highlight: 'rgb(var(--kk-amber-100) / <alpha-value>)',
        'highlight-border': 'rgb(var(--kk-amber-300) / <alpha-value>)',

        'status-critical-bg': 'rgb(var(--kk-rose-200) / <alpha-value>)',
        'status-critical-text': 'rgb(var(--kk-rose-800) / <alpha-value>)',
        'status-warning-bg': 'rgb(var(--kk-gold-200) / <alpha-value>)',
        'status-warning-text': 'rgb(var(--kk-gold-800) / <alpha-value>)',
        'status-ok-bg': 'rgb(var(--kk-sage-200) / <alpha-value>)',
        'status-ok-text': 'rgb(var(--kk-green-800) / <alpha-value>)',

        'accent-tan-bg': 'rgb(var(--kk-tan-100) / <alpha-value>)',
        'accent-tan-text': 'rgb(var(--kk-ink-900) / <alpha-value>)',
        'accent-coral-bg': 'rgb(var(--kk-coral-300) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
