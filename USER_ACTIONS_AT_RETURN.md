# User actions at return

## Release data gate (blocks deploy only)
1. Upload final 2026-07-27 site/data/prices.json (schema 2).
2. Upload final site/data/price-history.json (schema 1, incl. 2026-07-27 snapshot).
3. Upload corrected data-manifest.json: declares prices=2, price_history=1; sha256+bytes match both files; price_history has a checksum entry.
4. Provide final price-agent completion/status (--resume-status) output.

## Verify locally (no runner in authoring env)
5. node tools/validate.test.mjs; node tools/imgfallback.test.mjs; node tools/ui-contract.test.mjs; node tools/price-movers.test.mjs; node tools/deck-allocation.test.mjs; node tools/match-center.test.mjs
6. python tools/test_validate_release.py; python tools/test_card_art_validator.py; python tools/test_ligalorcana_price_agent_daily_v4.py; python tools/validate_release.py --root site
7. Playwright: npm run smoke (needs Chromium).
8. Visually inspect desktop + mobile.
9. Deploy site/ ONLY after data gate clears and CI is green. Do not create root index.html.
