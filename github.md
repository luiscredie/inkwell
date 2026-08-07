repo: luiscredie/inkwell
branch: main
path: site

## Last sync
date: 2026-08-06T12:00:00Z
branch head: main (post-deploy; visual-contract suite committed, CI green)

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
- Supplied the missing `tools/visual-contract.test.mjs`; confirmed on main. CI green, M0-M2.1 deployed.
- M2.7 V6: brand + PT-first nav, Overview and Collection relayout; found and fixed hardcoded English literals in Collection.
- M2.7 V5: retrofitted 828 hardcoded hex to design tokens (723 var() refs) and applied the "Immortal Precision" palette/type from the Stitch mockups + DESIGN.md.
- Built M2.5 (decision markers, 3 moments, matchup notebook, mulligan scoring, weekly goals) + 36/36 suite.
- Built M2.4 (meta list coverage, cost-to-complete, substitutions, deck overlap) + 32/32 suite; no tier language, since the data has no tournament results.
- Built M2.3 (deck-first shared card matrix, reverse path, allocation recommendation) + 23/23 contract suite; fixed the overview deck switcher truncating at 4.
- Decoupled Pages deploy from the checks workflow (reversible; gate commented in-file) and removed the stale `test:js` script.
- M2.2 pushed and deployed; both HTML files aligned at identical line offsets on main.
- Built M2.2 (import audit, rejected-row report, Data Health, prices no longer fatal) + `tools/data-health-contract.test.mjs` (26/26).
- Supabase schema installed; M2.1 cloud sync live (conflict path not yet exercised).
- Re-read `sync-import-contract.test.mjs`: its `0 failed` line is cosmetic only, not a broken gate (node:assert throws, exit is non-zero).

## Screen map
| Area | Repo files |
|---|---|
| Whole app (single-file DC) | `site/index.html`, `Inkwell.dc.html` (byte-identical mirror) |
| Match Center analysis engine | `site/match-center-engine.js` |
| Runtime support | `site/support.js` |
| Cloud sync schema | `supabase/inkwell_profiles.sql`, `site/sync-config.json` |
| Price collection | `tools/ligalorcana_price_agent_daily_v4.py`, `tools/ligalorcana_price_agent_daily_v5.py`, `site/data/prices.json`, `site/data-manifest.json` |
| Meta lists | `site/data/meta-decks.json` (optional, not in data-manifest) |
| Roadmap / audit | `ROADMAP.md`, `docs/INKWELL_PRODUCT_AUDIT_M2_1.md`, `M2_1_HANDOFF.md` |
