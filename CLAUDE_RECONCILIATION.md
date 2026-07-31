# Deck Consultant reconciliation

Adopt this package as a focused code-only delta on the current authoritative
repository. Do not restore an older package or replace generated artifacts.

## Required merge

Copy the five paths listed in `FILES_CHANGED.txt` to their matching
repository-relative paths. Keep `site/` as the sole GitHub Pages deployment
root and keep `site/index.html` byte-identical to `Inkwell.dc.html`.

## Behavioral contract

The advisor must communicate three different values separately:

1. deck copies simultaneously buildable;
2. missing cards for the single next-best deck instance;
3. total missing units across the whole selected portfolio.

`purchasesToUnlockNext` must refer only to the exact `nextBestDeck` instance.
Shared-card status must come from `cardAllocations`, not from whole-deck
buildability. An allocation equal to need is complete for that card even if
another card prevents the deck from being built.

Duplicate user deck names must remain distinct by `deck_id`; the view adds
numbered labels only for clarity.

## Do not change

- Saved decks continue to come only from the active user's saved `state.decks`.
- Normal and foil inventory remain pooled according to the existing contract.
- Reprint identity, legality, sync, import, matches, replay, pricing, and card
  data contracts are unchanged.
- Do not modify `site/data/**`, `site/data-manifest.json`,
  `site/lorcana-card-images/**`, or `site/users/**`.

## Verification

Run:

```powershell
node .\tools\deck-portfolio-v4.test.mjs
npm.cmd run test:all
npx.cmd playwright test "tools/smoke.spec.mjs"
python .\tools\validate_release.py --root .\site --quick
```

Expected advisor regression result: `30 passed, 0 failed`.
