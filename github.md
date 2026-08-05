repo: luiscredie/inkwell
branch: main
path: site

## Last sync
date: 2026-08-05T00:52:30Z
branch head: main (1 commit after tree f2a61d93be4d)

### Updated in this project
- Audited remote `main` against the local working copy (read-only; no files imported).
- Confirmed remote `site/index.html` (391,879 B) already contains M2.1 safe import + cloud sync revision CAS.
- Confirmed local working copy (349,559 B) is the pre-M2.1 V4-COMPLETE state and is behind remote.
- Read `docs/INKWELL_PRODUCT_AUDIT_M2_1.md` and remote `ROADMAP.md` for the pending-work review.
- Pulled main into the working copy (36 files) and fixed the `test:py` path typo.
- Verified `visual-contract.test.mjs` 18/18 against M2.1 and promoted it into `test:all` + `validate.yml`.
- Reviewed the push that landed those changes: the 4 intended files are correct; the same commit also carried the price-agent v5 package.
- Wired the v5 python suite into `test:py` and CI, and added the repo's first `.gitignore`.
- Flagged 3 files committed by `git add .` that need `git rm --cached`.

## Screen map
| Area | Repo files |
|---|---|
| Whole app (single-file DC) | `site/index.html`, `Inkwell.dc.html` (byte-identical mirror) |
| Match Center analysis engine | `site/match-center-engine.js` |
| Runtime support | `site/support.js` |
| Cloud sync schema | `supabase/inkwell_profiles.sql`, `site/sync-config.json` |
| Price collection | `tools/ligalorcana_price_agent_daily_v4.py`, `tools/ligalorcana_price_agent_daily_v5.py`, `site/data/prices.json`, `site/data-manifest.json` |
| Roadmap / audit | `ROADMAP.md`, `docs/INKWELL_PRODUCT_AUDIT_M2_1.md`, `M2_1_HANDOFF.md` |
