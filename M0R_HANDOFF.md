# Inkwell M0R corrected handoff

This package is a corrected version of the Claude M0R archive reviewed on
2026-07-26.

## Corrections made during review

- Added the missing `tools/validate-release.mjs` required by
  `tools/validate.test.mjs`.
- Added full `card_id + local + remote` identity and `onLoad` reset handling to
  printing/variant thumbnails.
- Expanded the image-fallback regression to cover all three template image
  surfaces and variant thumbnails.
- Changed the smoke workflow to stage `site/index.html` at repository-root
  `index.html` and serve the production tree. Serving `site/` alone cannot load
  root `data/`, `users/`, `ink/`, or card images.
- Removed false-green conditional skips from the automated smoke spec. The
  smoke now requires the seeded deck, builder range, invalid-add rejection,
  collection card modal, full art, price label, and Escape close behavior.

## Verified in review

- Python release fixtures: 8 passed.
- Python card-art fixtures: 3 passed.
- JavaScript release fixtures: 9 passed.
- Image fallback/identity regression: 7 passed.
- All inline site scripts and `support.js`: parse OK.
- GitHub Actions workflow: YAML parse OK.
- Uploaded production data-manifest checksums match all six published data
  artifacts.
- Production data coverage: 3442 cards, 3250 priced, 3442 PT overlays, 3160
  mapped art, 282 genuine no-art records.

## Release blockers

1. `LOR9-242` is the only cards/image-manifest mismatch. `cards.json` maps its
   image, but `lorcana-card-images/image_manifest.json` still reports
   `official_not_found`. Regenerate the image manifest and its CSV/checksum
   outputs; do not weaken the validator.
2. `price-history.json` currently contains one snapshot (`2026-07-26`). It is
   valid, but a trend needs at least two dated runs.
3. The Playwright browser binary could not be downloaded in the review
   environment. GitHub Actions or a local machine must produce the first green
   browser run.

Do not deploy until the image-manifest mismatch is reconciled and both GitHub
Actions jobs are green.

## Merge map

Copy these package paths into the repository:

- `site/index.html` → `index.html`
- `site/support.js` → `support.js` (content is unchanged; copying is optional)
- `tools/` → `tools/`
- `.github/workflows/validate.yml` → `.github/workflows/validate.yml`
- `package.json` and `playwright.config.mjs` → repository root

Do not replace `data/`, `users/`, `ink/`, `images/`, or
`lorcana-card-images/` with anything from this package.

## Commands from the repository root

PowerShell:

```powershell
python -m unittest discover -s tools -p "test_*.py"
node tools/validate.test.mjs
node tools/imgfallback.test.mjs
python tools/validate_release.py --root . --quick
```

If `node` is not installed:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

Close and reopen PowerShell after installation.

The collection dropdown contrast fix, `Card number` / `Número da carta` sort,
and modal Previous/Next arrows remain in the later M2UX milestone. They are not
part of M0R.
