# LigaLorcana daily price agent v5

This release is a safe replacement for the daily v4 collector. It does not
bypass access controls.

## What v5 fixes

- HTTP 401/403 is never retried repeatedly for the same card.
- Three consecutive 401/403 responses open a circuit breaker, save the raw
  checkpoint, close the browser, and stop with exit code 3.
- A failed refresh never overwrites a previously valid price band.
- Attempts made today are remembered separately from the last valid price.
- `--resume-today` does not retry today's failed records unless
  `--retry-errors-today` is explicitly supplied.
- Derived `prices.json`, history, analytics, and manifest are not republished
  automatically while the raw cache contains errors.
- Safer defaults: 8–30 second adaptive interval, two transient retries, and a
  15-minute HTTP 429 cooldown.

## Install

Stop v4 with `Ctrl+C` before replacing or running an agent. From the repository
root in PowerShell:

```powershell
cd "C:\Users\luisc\OneDrive\Desktop\inkwell"

Copy-Item .\site\data\ligalorcana-prices.json `
  .\site\data\ligalorcana-prices.before-v5.json -Force

Copy-Item "$env:USERPROFILE\Downloads\ligalorcana_price_agent_daily_v5.py" `
  .\tools\ligalorcana_price_agent_daily_v5.py -Force
Copy-Item "$env:USERPROFILE\Downloads\test_ligalorcana_price_agent_daily_v5.py" `
  .\tools\test_ligalorcana_price_agent_daily_v5.py -Force
```

If installing from the ZIP, copy the two `.py` files from its extracted folder
instead of the Downloads root.

## Verify the agent

```powershell
python .\tools\test_ligalorcana_price_agent_daily_v5.py
python .\tools\ligalorcana_price_agent_daily_v5.py --show-paths
python .\tools\ligalorcana_price_agent_daily_v5.py --resume-status
```

Expected unit-test result: `Ran 11 tests` and `OK`.

## Resume today's refresh

```powershell
python .\tools\ligalorcana_price_agent_daily_v5.py --resume-today
```

If the site returns three consecutive 401/403 responses, v5 stops safely. Do
not loop the command immediately. Wait before retrying. Existing valid prices
remain in the raw cache and no deploy artifact is published.

After access has recovered, retry only the failures that were already attempted
today:

```powershell
python .\tools\ligalorcana_price_agent_daily_v5.py `
  --resume-today `
  --retry-errors-today
```

## Publish only after a clean run

Check status:

```powershell
python .\tools\ligalorcana_price_agent_daily_v5.py --resume-status
```

Do not publish while `remaining_today` is above zero or while the durable cache
still reports `error` records. A clean collection automatically rebuilds the
derived artifacts and writes the manifest last.

Then validate:

```powershell
python .\tools\validate_release.py --root .\site --quick
```

Expected result: `PASS`.

Review the exact changed files before staging:

```powershell
git status --short
git diff -- site/data-manifest.json site/data/prices.json site/data/price-history.json
```

Never use `git add .` for a price refresh. Stage only the artifacts you have
reviewed. Keep `ligalorcana-prices.before-v5.json` as a local backup and do not
commit it.

