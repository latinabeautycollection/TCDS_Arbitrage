# Ascendia / TCDS Brand Alignment Notes

This shell now uses a centralized brand-token layer instead of hard-coded colors.

## Token Location

- `src/styles/index.css`
- `tailwind.config.js`
- `src/config/brand.ts`

## Current Shell Enhancements

- Removed `Forgot Password` from Login.
- Removed `Remember Me` from Login.
- Added internal administrator help language.
- Added registered-device authentication posture.
- Added Face ID / Touch ID placeholder button.
- Added system readiness panel:
  - Online
  - Server Connected
  - Printer Connected
  - Scanner Ready
- Added persistent compact status strip.
- Rebuilt Receive Item as a scan-first screen with no recent scan distraction.
- Added offline queue / last-sync placeholders.
- Added Ascendia/TCDS design tokens for color and fonts.
- Preserved the approved 12-screen structure.
- Preserved shell-only boundary: no business logic, no real API writes, no Scandit license logic.

## Developer Rule

Do not hard-code brand colors in components. Use Tailwind tokens:

- `tcds-black`
- `tcds-panel`
- `tcds-card`
- `tcds-line`
- `tcds-gold`
- `tcds-blue`
- `tcds-green`
- `tcds-red`

If the official Ascendia design system provides exact hex codes later, update only the variables in `src/styles/index.css`.
