# Inkwell release smoke contract

`site/` is the deployed application root.

## Automated Playwright coverage

`tools/smoke.spec.mjs` must fail when a required surface is absent. It contains
no conditional existence skips and covers:

1. Boot without fatal JavaScript or data errors.
2. Navigation to Decks, Matches, and Learn.
3. Seeded deck availability.
4. Deck-builder `X–Y / Z` range.
5. Copy-limit rejection without changing card or deck totals.
6. Set-number sort selection.
7. Modal art loaded with `naturalWidth > 0`.
8. Price label `Lowest · Liga` / `Menor · Liga`.
9. Exact one-card ArrowRight/ArrowLeft movement.
10. Previous disabled at the first result.
11. Escape closes the modal.

Run from the repository root after serving `site/`:

```bash
INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/smoke.spec.mjs
```

## Manual release checks

1. Home shows Now Playing, legality, and a useful next action.
2. Adding an off-color or rotated card is rejected before mutation.
3. Matches can be logged and update deck results.
4. Learn completion persists after reload.
5. Price history renders with two or more dated runs, or shows an honest empty
   state.
6. Data Health reports checksums, staleness, price/art/PT coverage, and update
   timestamps.
7. EN/PT switching does not overflow.
8. At 375px, navigation and profile switching work without horizontal scroll.
9. Keyboard focus is visible and reaches cards and wishlist controls.
10. The Collection native sort popup is dark on Windows Edge/Chromium. If the
    browser ignores native option colors, replace it with an accessible custom
    menu in the later UX lane.

## Pass criteria

All automated checks, the relevant manual checks, and
`python3 tools/validate_release.py --root site --quick` must pass before deploy.
