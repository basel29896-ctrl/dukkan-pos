// Tailwind 3.4 — auto-detected by react-scripts 5 (no PostCSS surgery needed).
// HeroUI plugin provides the semantic color system; both themes are defined here so
// every component reads tokens (bg-content1, text-foreground, primary, …) and the
// light/dark toggle stays a one-class swap on <html>.
const { heroui } = require('@heroui/react');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,jsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter'", "'IBM Plex Sans Arabic'", 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    heroui({
      layout: {
        radius: { small: '8px', medium: '12px', large: '16px' },
        borderWidth: { small: '1px', medium: '1px', large: '2px' },
      },
      themes: {
        // ── Emerald fresh-market · light ─────────────────────────────────────
        light: {
          colors: {
            background: '#FAFAFA',            // zinc-50 canvas
            foreground: '#18181B',            // zinc-900 text
            content1: '#FFFFFF',              // cards
            content2: '#F4F4F5',              // insets / table headers
            content3: '#E4E4E7',
            content4: '#D4D4D8',
            divider: 'rgba(24,24,27,0.08)',
            focus: '#059669',
            primary: {
              50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7',
              400: '#34D399', 500: '#10B981', 600: '#059669', 700: '#047857',
              800: '#065F46', 900: '#064E3B',
              DEFAULT: '#059669', foreground: '#FFFFFF',
            },
            success: { DEFAULT: '#059669', foreground: '#FFFFFF' },
            warning: { DEFAULT: '#F59E0B', foreground: '#18181B' },
            danger: { DEFAULT: '#E11D48', foreground: '#FFFFFF' },
          },
        },
        // ── Emerald fresh-market · dark ──────────────────────────────────────
        dark: {
          colors: {
            background: '#09090B',            // zinc-950 canvas
            foreground: '#F4F4F5',
            content1: '#18181B',              // zinc-900 cards
            content2: '#27272A',
            content3: '#3F3F46',
            content4: '#52525B',
            divider: 'rgba(244,244,245,0.10)',
            focus: '#10B981',
            primary: {
              50: '#064E3B', 100: '#065F46', 200: '#047857', 300: '#059669',
              400: '#10B981', 500: '#34D399', 600: '#6EE7B7', 700: '#A7F3D0',
              800: '#D1FAE5', 900: '#ECFDF5',
              DEFAULT: '#10B981', foreground: '#052E1B',
            },
            success: { DEFAULT: '#10B981', foreground: '#052E1B' },
            warning: { DEFAULT: '#FBBF24', foreground: '#1C1400' },
            danger: { DEFAULT: '#FB7185', foreground: '#340810' },
          },
        },
      },
    }),
  ],
};
