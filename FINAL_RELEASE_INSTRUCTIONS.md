# Inkwell 1.5.1 — final release instructions

This ZIP is an overlay for the existing repository. It preserves folders not
present in the package, including `site/lorcana-card-images`, `site/ink` and
`site/users`.

## 1. Extract over the repository

Open PowerShell in `C:\Users\luisc\OneDrive\Desktop\inkwell`:

```powershell
Expand-Archive `
  -Path ".\Inkwell-1.5.1-final.zip" `
  -DestinationPath "." `
  -Force
```

Confirm:

```powershell
Test-Path ".\site\index.html"
Test-Path ".\site\data-manifest.json"
Test-Path ".\.github\workflows\deploy-pages.yml"
Test-Path ".\tools\legality.test.mjs"
```

All four results must be `True`.

## 2. Validate

```powershell
python -m unittest `
  tools/test_validate_release.py `
  tools/test_card_art_validator.py `
  tools/test_ligalorcana_price_agent_daily_v4.py `
  tools/test_refine_cards_pt.py `
  tools/test_refresh_data_manifest.py

python .\tools\validate_release.py --root .\site --quick
```

If Node is installed:

```powershell
npm ci
npm run test:js
npx playwright install chromium
Start-Process python -ArgumentList "-m","http.server","8080","--directory","site"
$env:INKWELL_URL="http://localhost:8080/index.html"
npx playwright test .\tools\smoke.spec.mjs
```

## 3. Commit exact release paths

Do not use `git add .`.

```powershell
git add site/index.html site/support.js site/match-center-engine.js
git add site/data-manifest.json site/data
git add tools .github/workflows
git add package.json package-lock.json playwright.config.mjs
git add Inkwell.dc.html ROADMAP.md M1P_HANDOFF.md
git status
git commit -m "Release Inkwell 1.5.1 player-first update"
git push origin main
```

## 4. Enable the correct Pages root

On GitHub, select once:

`Settings → Pages → Build and deployment → Source → GitHub Actions`

The deploy workflow waits for the release-check workflow and uploads `site/`
as the Pages root.

## 5. Verify production

- `https://luiscredie.github.io/inkwell/` returns the app, not 404.
- `/inkwell/data-manifest.json` returns 200.
- Collection opens in EN and PT.
- A card modal loads art and navigates left/right.
- Deck advisor and Match Center show saved decks from the active user.
- Actions for JS, Python, Playwright and Pages are green.

Do not upload the Claude ZIP after this release package; its `index.html`
contains unrelated Replay code and restores regressions removed here.
