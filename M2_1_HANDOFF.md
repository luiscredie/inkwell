# M2.1 handoff — Account Sync & Safe Import

Baseline: commit `1b8d0b851ee1a92a75afb1ffabfb0ad166fede49` (`m20`)

## Delivered

- Supabase schema, RLS owner policies, and atomic revision-checked write RPC.
- Cross-device sync now reads/stores server revisions.
- Concurrent edits preserve a local conflict snapshot instead of overwriting.
- Actionable database/RLS diagnostics and complete EN/PT sync copy.
- Collection import opens a preview before any mutation.
- Safe merge is the default; add and replace modes are explicit.
- Every applied import creates a local pre-import rollback snapshot.
- CI and package scripts include the new contract test.

## Required administrator step

Run `supabase/inkwell_profiles.sql` in the Supabase SQL Editor and follow
`SUPABASE_SETUP.md`. This cannot be completed by a code-only deployment.

## Files changed

- `site/index.html`
- `Inkwell.dc.html` (byte-identical mirror)
- `package.json`
- `.github/workflows/validate.yml`
- `ROADMAP.md`
- `supabase/inkwell_profiles.sql` (new)
- `SUPABASE_SETUP.md` (new)
- `tools/sync-import-contract.test.mjs` (new)

No generated files under `site/data/`, card art, prices, user seed data, or
`site/sync-config.json` were modified.

## Executed

- `npm run test:all` — PASS
- Python unittest matrix — 26 PASS
- `python3 tools/validate_release.py --root site --quick` — PASS
- `site/index.html` and `Inkwell.dc.html` — byte-identical

Playwright was not rerun in this environment. Run it after the SQL installation
and deployment, then test a real two-browser sync with the same account.

