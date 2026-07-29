# Independent reconciliation review

## Received package verdict

The received `Inkwell — Lorcana Codex (9).zip` contained the substantive R2-R5
implementation, and its feature-specific suites passed. It was not ready to
merge unchanged because the aggregate JS command failed on a missing module and
R4 had persistence gaps not covered by those suites.

## Evidence

Initial aggregate result:

```text
ERR_MODULE_NOT_FOUND: tools/validate-release.mjs
```

Feature suites from the received package that passed before correction:

- image fallback 7/7
- UI contract 24/24
- price movers 12/12
- deck allocation 19/19
- Match Center 12/12
- Match Center R3 12/12
- legacy core 14 assertions
- Python unit suites 17/17

## Applied corrections

- Restored the missing JS validator from the previously accepted M0R package.
- Completed `activeDeckId` propagation across load, import, cloud pull and deck
  deletion.
- Removed the duplicate `delMatch()` method so selected-match/replay cleanup is
  no longer overwritten.
- Added regression checks for those contracts.
- Reconciled the handoff and file manifest with the actual package.

## Final executable results

`npm run test:js` and `npm run test:py` both pass on this exact directory.

The six currently published data artifacts were also downloaded from the
effective `/inkwell/site/` path and passed the quick release validator:
3,442 cards, 3,300 priced IDs and 3 history snapshots. Prices and price-history
sha256/bytes match the 2026-07-28 manifest.

## Deployment-root finding

The public `/inkwell/` path returned 404 while `/inkwell/site/` returned 200.
The reconciled package therefore adds a Pages workflow that uploads `site/`
itself as the deployment artifact. GitHub Pages must be set to use GitHub
Actions once before the workflow can publish the canonical URL.

The remaining production gates are the browser smoke, full card-art validation,
and manifest regeneration if the new PT-BR overlay is included.

## Legality delta review

`Inkwell — Lorcana Codex (10).zip` was not a clean legality-only delta. Its
`index.html` also contained an unrequested visual Replay implementation and
restored two previously fixed defects:

- deleting the active deck no longer normalized `activeDeckId`;
- a second `delMatch()` again overrode replay/timer cleanup.

The complete file was therefore rejected. Only the legality helpers were
ported by diff. The original 18-case test also did not execute the import
persistence claim, so the reconciled suite was expanded to 25 cases.

Final legality behavior:

- canonical `maximum_ink_colors`, with `maximum_inks` compatibility;
- structured issue codes and card IDs;
- hard-invalid imports block before persistence;
- incomplete deck drafts remain permitted;
- creation and builder color limits use the format rule.

## Translation and final data snapshot

The revised PT-BR overlay has the same 3,442 card IDs as the English database.
Its 6 tests pass. A generic validate-before-write manifest refresher was added
with 3 tests, and the final six-artifact snapshot passes the quick release
validator. Prices and history are unchanged from the validated published data.
