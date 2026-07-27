# Inkwell browser smoke test (M0R)

Minimal load-and-navigate checks to run before deploy. The automated subset is
in `tools/smoke.spec.mjs`. It must be served from the repository root after the
candidate `site/index.html` is staged as root `index.html`; otherwise relative
`data/`, `users/`, `ink/`, `images/`, and `support.js` paths do not match
production.

## Load
1. App boots with no console errors; no red "Data could not be loaded" screen.
2. In manifest mode, no amber data-warning banner (or only an expected one).

## Player loop
3. Home shows the "Now Playing" hero with a legality badge and one next action.
4. Decks → open a deck → legality badge matches card count / copy rules.
5. Deck builder: adding an off-color/over-limit card is REJECTED (not briefly added).
6. Matches: log a game; it appears and updates the deck record.
7. Learn: open a lesson; complete it; progress persists after reload.

## Data surfaces
8. Prices view: value-history chart renders (>=2 valid snapshots) or an honest empty state.
9. Card modal: full card image, price labelled "Lowest · Liga", per-card price curve.
10. Settings → Data Health: shows cards, errors, warnings, missing prices/images,
    translations, stale/checksum rows, last data update.

## Cross-cutting
11. Switch EN/PT — no layout overflow; strings translated.
12. Mobile width (375px): bottom nav, profile switcher, log match, no horizontal scroll.
13. Keyboard: Tab reaches card tiles + wishlist; Escape closes modals; focus visible.

## Pass criteria
All 13 pass; the release validator (`python3 tools/validate_release.py`) exits 0.
