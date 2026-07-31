# Install M3V V5

From the repository root, copy the package paths to the same relative paths.
Do not use `git add .`.

Run:

```powershell
node .\tools\match-center-v5.test.mjs
npm.cmd run test:all
python .\tools\validate_release.py --root .\site --quick
npx.cmd playwright test "tools/smoke.spec.mjs"
```

Expected:

- Match Center V5: `20 passed, 0 failed`
- release validator: `PASS`
- Playwright: `7 passed`

Stage only:

```powershell
git add site/index.html `
  Inkwell.dc.html `
  tools/match-center-v5.test.mjs `
  tools/smoke.spec.mjs `
  package.json `
  .github/workflows/validate.yml `
  ROADMAP.md
```

Then:

```powershell
git commit -m "add V5 match center coaching experience"
git push origin main
```
