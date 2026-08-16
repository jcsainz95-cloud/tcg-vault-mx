import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        text: 'var(--color-text)',
        muted: 'var(--color-text-muted)',
        subtle: 'var(--color-text-subtle)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          fg: 'var(--color-primary-fg)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          fg: 'var(--color-accent-fg)',
        },
        success: { DEFAULT: 'var(--color-success)', bg: 'var(--color-success-bg)' },
        warning: { DEFAULT: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
        danger: { DEFAULT: 'var(--color-danger)', bg: 'var(--color-danger-bg)' },
        info: { DEFAULT: 'var(--color-info)', bg: 'var(--color-info-bg)' },
        'neutral-warm': 'var(--color-neutral-warm)',
        // Paneles de tinta (hero de auth, sidebar del back-office).
        ink: 'var(--color-ink)',
        'on-ink': 'var(--color-on-ink)',
        'on-ink-muted': 'var(--color-on-ink-muted)',
        'on-ink-nav': 'var(--color-on-ink-nav)',
        'on-ink-rule': 'var(--color-on-ink-rule)',
      },
      // Sin esquinas redondeadas: el sistema se apoya en reglas, no en cajas.
      borderRadius: {
        none: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '0px',
        DEFAULT: '0px',
      },
      fontFamily: {
        // Títulos: mincho. Da el aire y la voz editorial de la dirección 5a.
        serif: ['var(--font-serif)', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Mono: toda cifra, folio, estado y etiqueta.
        mono: ['var(--font-mono)', 'ui-monospace', 'Menlo', 'monospace'],
      },
      // Sin sombras: la profundidad la da el aire, no el relieve.
      boxShadow: {
        xs: 'none',
        sm: 'none',
        md: 'none',
        lg: 'none',
        none: 'none',
        focus: '0 0 0 2px var(--color-focus-ring)',
      },
      letterSpacing: {
        label: '0.14em',
        eyebrow: '0.18em',
        wordmark: '0.2em',
      },
      fontSize: {
        display: ['2.5rem', { lineHeight: '1.1', fontWeight: '400' }],
        h1: ['2rem', { lineHeight: '1.1', fontWeight: '400' }],
        h2: ['1.5rem', { lineHeight: '1.2', fontWeight: '400' }],
        h3: ['1.25rem', { lineHeight: '1.25', fontWeight: '400' }],
      },
    },
  },
  plugins: [],
};

export default config;
