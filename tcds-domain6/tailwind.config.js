/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        tcds: ['var(--font-tcds-body)'],
        display: ['var(--font-tcds-display)']
      },
      colors: {
        tcds: {
          black: 'var(--color-tcds-black)',
          obsidian: 'var(--color-tcds-obsidian)',
          charcoal: 'var(--color-tcds-charcoal)',
          panel: 'var(--color-tcds-panel)',
          surface: 'var(--color-tcds-surface)',
          card: 'var(--color-tcds-card)',
          line: 'var(--color-tcds-line)',
          strongLine: 'var(--color-tcds-strong-line)',
          gold: 'var(--color-tcds-gold)',
          amber: 'var(--color-tcds-gold-soft)',
          goldDeep: 'var(--color-tcds-gold-deep)',
          ink: 'var(--color-tcds-ink)',
          muted: 'var(--color-tcds-muted)',
          green: 'var(--color-tcds-green)',
          red: 'var(--color-tcds-red)',
          warning: 'var(--color-tcds-warning)',
          blue: 'var(--color-tcds-blue)'
        }
      },
      boxShadow: {
        executive: '0 24px 70px rgba(30,24,14,.14), 0 2px 10px rgba(30,24,14,.05)',
        gold: '0 16px 42px rgba(201,154,53,.30)',
        soft: '0 10px 30px rgba(16,16,16,.08)'
      },
      borderRadius: {
        executive: '1.75rem'
      }
    }
  },
  plugins: []
};
