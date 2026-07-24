# Developer Guardrails Checklist

Before any developer changes the shell, certify the following:

## Architecture

- [ ] I did not add unauthorized screens.
- [ ] I did not reintroduce forbidden standalone screens.
- [ ] I preserved the 12-screen structure.
- [ ] I kept Domain 6 separate from Domain 4 listing intelligence.
- [ ] I kept Domain 6 separate from Domain 3 shipping intelligence, except for handoff placeholders.

## UI/UX

- [ ] I preserved the TCDS black/gold/white design system.
- [ ] I used large mobile touch targets.
- [ ] I avoided unnecessary text and clutter.
- [ ] I used status, empty, error, loading, offline, and toast patterns consistently.
- [ ] I used bottom sheets or modals instead of extra pages.

## Code

- [ ] I did not put business logic in React components.
- [ ] I did not add direct database calls to the frontend.
- [ ] I did not hard-code real credentials.
- [ ] I did not remove the placeholder adapters.
- [ ] `npm run build` succeeds.

## Deployment

- [ ] Environment variables are documented.
- [ ] Docker files still exist.
- [ ] Nginx config still exists.
- [ ] PWA manifest still exists.
- [ ] Service worker still exists.
