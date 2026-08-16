# LigaLorcana price-agent v4 — recovery guide

This package fixes the Windows/OneDrive lock that interrupted
`price-analytics.json` publication. Raw scraping progress is now checkpointed
separately from derived files, so an analytics, history, or manifest lock does
not erase completed requests.

## What was recovered

The supplied recovery snapshot contains 1,098 unique records checked on
2026-07-27 in `America/Sao_Paulo`:

- 1,009 records with prices
- 89 records with no marketplace price
- 0 scraper-error records

The snapshot is an emergency backup. Keep your current
`site\data\ligalorcana-prices.json` if it contains 1,098 or more records; it may
be newer than the supplied snapshot.

## Install

From the extracted package, copy:

`ligalorcana_price_agent_daily_v4.py`

to:

`C:\Users\luisc\OneDrive\Desktop\inkwell\tools\`

Do not copy the recovery snapshot over your live cache unless the live file is
missing, invalid JSON, or has fewer records.

## Inspect saved progress

Open PowerShell in the `inkwell` folder:

```powershell
cd "C:\Users\luisc\OneDrive\Desktop\inkwell"
python .\tools\ligalorcana_price_agent_daily_v4.py --resume-status
```

Check these fields:

- `cache_records`: all durable cached records
- `checked_today`: records already checked today
- `catalog_records`: cards in the local LigaLorcana catalog
- `remaining_today`: cards still needing today's refresh

## Continue today's refresh

```powershell
python .\tools\ligalorcana_price_agent_daily_v4.py --resume-today
```

The first request may display as `Checking remaining 1/N`. That means request 1
of the remaining queue, not card 1 of the full refresh. The preceding log line
reports how many durable cache records were loaded and skipped.

Do not use `--refresh-all` or `--no-resume` for this recovery. Either option
intentionally defeats the daily resume behavior.

## If OneDrive locks a generated file again

The raw cache remains safe at:

`site\data\ligalorcana-prices.json`

Close editors or preview windows using the JSON files, pause OneDrive sync
temporarily, and run:

```powershell
python .\tools\ligalorcana_price_agent_daily_v4.py --finalize-cache
```

This rebuilds these files without reopening the browser or repeating the scrape:

- `site\data\ligalorcana-price-map.v4.json`
- `site\data\prices.json`
- `site\data\price-history.json`
- `site\data\price-analytics.json`
- `site\data-manifest.json` (written last)

The writer retries short Windows locks. If a lock persists, it preserves a
complete uniquely named `.tmp` recovery copy and reports its exact path.

## Emergency restore from Git history

Only use this if the live raw cache is missing or corrupt. The repository no
longer carries a second snapshot beside the live cache; duplicate recovery
payloads became stale and were easy to publish accidentally.

First back up any existing cache:

```powershell
Copy-Item .\site\data\ligalorcana-prices.json `
  .\site\data\ligalorcana-prices.before-recovery.json
```

Restore `site/data/ligalorcana-prices.json` from a known-good commit into a
temporary file, inspect it, and only then replace the live cache. Git history is
the recovery source; do not add a second tracked JSON snapshot.

Run `--resume-status`, then `--resume-today`.

## Tests

From the extracted package directory:

```powershell
python .\test_ligalorcana_price_agent_daily_v4.py
```

Expected: `Ran 6 tests ... OK`.

The tests cover short and persistent file locks, durable resume counts,
today-only refresh selection, manifest-last publication, and failure isolation.

## Release gate

After the refresh and finalization finish:

```powershell
python .\tools\validate_release.py --root .\site
```

Deploy only after this passes and both GitHub Actions jobs are green.
