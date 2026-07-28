# M1P Handoff (final reconciliation)

Canonical entry: site/index.html (mirror Inkwell.dc.html, byte-identical, 284774 bytes). No deploy/push. Generated data never edited by code.

## Checkpoint status
- A Overview player-first + Price Movers: CODE DONE. Release BLOCKED on external data.
- B Deck Portfolio Optimizer: CODE DONE. Pure Component.computeDeckPortfolioPlan(inventory,decks,{budget}). Exact branch-and-bound when instances<=12 (optimal=true, "Optimized Plan"); greedy fallback otherwise (optimal=false, "Recommended Plan"). Normal user portfolios (<=12 physical instances) are EXACT; fallback triggers above 12 instances or >200000 ops.
- C Match Center: CODE DONE. Canonical log workflow in Matches (log form + deck selector + all/deck filter); deck detail keeps summary + Log/View-All opening Matches preselected by deck_id. Existing importer/replay/coach live in Matches deck-scoped detail; not duplicated in deck detail.
- D Learn + Player Home: CODE DONE. 5 bilingual Learn tracks + glossary + official links; Player Home now consumes the PORTFOLIO OPTIMIZER (PH.decksBuildable / PH.nearComplete), not independent readiness. activeDeckId profile-scoped.

## User/profile persistence contract (ADDITIVE)
- New persisted deck fields: targetCopies (0-10, default 1; 0 excludes without delete), portfolioPriority (default 0).
- activeDeckId persisted per profile under localStorage key inkwell_activedeck_<user> (separate from user JSON).
- Location: deck objects inside the per-profile user object (localStorage inkwell_user_<user> + Supabase row).
- Migration migrateUser(): idempotent — sets defaults only when missing; preserves unknown fields; existing decks/profiles never reset; runs to USER_SCHEMA and stamps _schema so it does not re-run.
- Import/export: fullExport/fullImport round-trip the new fields; importing an old profile applies defaults safely.
- Global generated-data contract: UNCHANGED.

## Canonical tests EXECUTED here (JS, sandbox)
ui-contract 24/24 · price-movers 12/12 · deck-allocation 18/18 · match-center 12/12 · imgfallback 7/7 · parse OK · mirror byte-identical.

## NOT EXECUTED (no runner)
node validate.test.mjs; python test_ligalorcana_price_agent_daily_v4.py (6); python test_validate_release.py (8); python test_card_art_validator.py (3); python validate_release.py --root site; Playwright smoke.

## Release blocker (external data, todo 44)
Deployed prices.json is schema 2 but manifest declares 4, with sha256/bytes mismatch; price-history.json unchecksummed; newest snapshot 07-26. Correct deploy contract: prices.json schema 2, price-history.json schema 1, manifest declares those, checksum+bytes match, history includes 2026-07-27. Do NOT hand-edit generated files.
