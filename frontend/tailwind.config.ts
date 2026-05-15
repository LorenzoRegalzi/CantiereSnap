import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1A2332',
          accent:  '#D97706',
          success: '#0D9488',
          bg:      '#FAFAF9',
          border:  '#D6D3D1',
          text:    '#292524',
          muted:   '#78716C',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
