# V5 replay fullscreen hotfix

Apply from the repository root (`C:\Users\luisc\OneDrive\Desktop\inkwell`).

## Install from the downloaded ZIP

Close any editor that may be writing `site/index.html`, then run in PowerShell:

```powershell
cd "C:\Users\luisc\OneDrive\Desktop\inkwell"

$zip = "$env:USERPROFILE\Downloads\Inkwell-V5-replay-fullscreen-hotfix.zip"
$tmp = Join-Path $env:TEMP "inkwell-v5-hotfix"

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$src = Join-Path $tmp "v5-replay-fullscreen-hotfix"

Copy-Item "$src\site\index.html" ".\site\index.html" -Force
Copy-Item "$src\Inkwell.dc.html" ".\Inkwell.dc.html" -Force
Copy-Item "$src\tools\match-center-v5.test.mjs" ".\tools\match-center-v5.test.mjs" -Force
Copy-Item "$src\tools\smoke.spec.mjs" ".\tools\smoke.spec.mjs" -Force
```

## Files to replace

- `site/index.html`
- `Inkwell.dc.html`
- `tools/match-center-v5.test.mjs`
- `tools/smoke.spec.mjs`

Do not copy or stage `site/data/**`. The price agent may continue running.

## What changed

- Fullscreen replay opens at event 1 instead of inheriting an end-of-replay position.
- Close, previous, play/pause, next, and hidden-information controls use stable top-level handlers.
- Controls have explicit `type="button"`, stable test IDs, and foreground stacking.
- Keyboard controls reuse the project's single guarded document listener: Left, Right, Space, and Escape.
- No second global keyboard path is created; the listener is removed when the overlay closes or the component unmounts.
- The Playwright V5 fixture now has two events and must prove next, previous, hidden-info, and close work.

## Verify

```powershell
node .\tools\ui-contract.test.mjs
node .\tools\match-center-v5.test.mjs
npx.cmd playwright test "tools/smoke.spec.mjs"
python .\tools\validate_release.py --root .\site --quick
```

Expected:

- Match Center V5: `30 passed, 0 failed`
- UI contract: `29 passed, 0 failed`
- Playwright: all smoke tests pass (the V5 scenario now exercises fullscreen replay controls)
- Release validator: `PASS`

## Stage only this hotfix

```powershell
# This only clears the staging area; it does not delete local modifications.
git restore --staged .

git add site/index.html `
  Inkwell.dc.html `
  tools/match-center-v5.test.mjs `
  tools/smoke.spec.mjs

git diff --cached --check
git diff --cached --name-only
git status --short
```

The staged file list must contain exactly the four files above. Do not stage the
running price-agent outputs under `site/data/**`.

## Commit and push

Only after every check is green:

```powershell
git commit -m "fix replay fullscreen controls and modal keyboard contract"
git push origin main
```

Then open GitHub Actions and confirm the `python`, `js`, and `smoke` jobs are green.
