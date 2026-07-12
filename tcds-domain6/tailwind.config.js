/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        tcds: ['var(--font-tcds-body)'],
        display: ['var(--font-tcds-display)']
      },
      fontSize: {
        display: ['2.5rem', { lineHeight: '1.02', letterSpacing: '-0.04em' }],
        page: ['2rem', { lineHeight: '1.08', letterSpacing: '-0.035em' }],
        section: ['1.25rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        card: ['1.0625rem', { lineHeight: '1.25', letterSpacing: '-0.015em' }],
        body: ['0.9375rem', { lineHeight: '1.5' }],
        caption: ['0.75rem', { lineHeight: '1.4' }]
      },
      colors: {
        primary: {
          500: 'var(--color-primary-500)',
          600: 'var(--color-primary-600)',
          700: 'var(--color-primary-700)',
          hover: 'var(--color-primary-hover)',
          pressed: 'var(--color-primary-pressed)',
          disabled: 'var(--color-primary-disabled)'
        },
        neutral: {
          0: 'var(--color-neutral-0)',
          50: 'var(--color-neutral-50)',
          100: 'var(--color-neutral-100)',
          200: 'var(--color-neutral-200)',
          300: 'var(--color-neutral-300)',
          500: 'var(--color-neutral-500)',
          700: 'var(--color-neutral-700)',
          900: 'var(--color-neutral-900)'
        },
        tcds: {
          black: 'var(--color-tcds-black)', obsidian: 'var(--color-tcds-obsidian)', charcoal: 'var(--color-tcds-charcoal)',
          panel: 'var(--color-tcds-panel)', surface: 'var(--color-tcds-surface)', card: 'var(--color-tcds-card)',
          line: 'var(--color-tcds-line)', strongLine: 'var(--color-tcds-strong-line)', gold: 'var(--color-tcds-gold)',
          amber: 'var(--color-tcds-gold-soft)', goldDeep: 'var(--color-tcds-gold-deep)', ink: 'var(--color-tcds-ink)',
          muted: 'var(--color-tcds-muted)', green: 'var(--color-tcds-green)', red: 'var(--color-tcds-red)',
          warning: 'var(--color-tcds-warning)', blue: 'var(--color-tcds-blue)'
        }
      },
      boxShadow: {
        surface: '0 1px 2px rgba(16,16,16,.04)',
        card: '0 12px 34px rgba(30,24,14,.10), 0 2px 8px rgba(30,24,14,.04)',
        modal: '0 28px 80px rgba(16,16,16,.20)',
        floating: '0 22px 60px rgba(30,24,14,.18), 0 8px 20px rgba(30,24,14,.08)',
        executive: '0 18px 50px rgba(30,24,14,.12), 0 2px 10px rgba(30,24,14,.05)',
        gold: '0 14px 38px rgba(201,154,53,.22)',
        soft: '0 8px 24px rgba(16,16,16,.07)'
      },
      borderRadius: {
        enterprise: 'var(--radius-enterprise)'
      }
    }
  },
  plugins: []
};
