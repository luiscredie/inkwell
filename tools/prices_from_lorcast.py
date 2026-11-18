#!/usr/bin/env python3
"""TCGplayer market prices (USD, via the Lorcast API) converted to BRL.

    python tools/prices_from_lorcast.py --rate 5.0171 [--input DIR_WITH_set_*.json]
    python tools/prices_from_lorcast.py --rate auto --history      # what the daily workflow runs

--rate auto takes today's USD/BRL (AwesomeAPI, falling back to open.er-api.com and Frankfurter).
--history also saves today's prices as site/data/price-history-tcg/<date>.json, listed in
price-history-tcg.json (the Preços page movers and value chart): every day for 35 days, then one a week for a year.

Writes site/data/prices.json in the same shape as the Liga Lorcana agent (n/nl/nh, f/fl/fh in BRL),
so every page keeps working. Cards Lorcast has no price for keep their current (Liga) price.
The Liga agent (tools/run_daily_price_refresh.ps1) overwrites this file when it runs again.
"""
from __future__ import annotations

import argparse
import http.client
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRICES = ROOT / "site" / "data" / "prices.json"
HISTORY = ROOT / "site" / "data" / "price-history-tcg.json"   # index of the days kept
HISTORY_DIR = ROOT / "site" / "data" / "price-history-tcg"
RETRIES = 4       # tries per set when Lorcast cuts the answer or the connection drops
RETRY_WAIT = 3.0   # seconds before the 2nd try; 6 before the 3rd, 9 before the 4th
MIN_TCG = 3000   # fewer priced cards than this means Lorcast answered only in part: keep yesterday's file
SETS = [str(n) for n in range(1, 15)] + ["P1", "P2", "P3", "P4", "D23", "cp", "DIS", "C2", "CC1", "Q3", "PD1", "RPH"]


def card_id(set_code: str, number: str) -> str | None:
    if set_code.isdigit():
        return f"LOR{set_code}-{number}"
    if set_code in {"P1", "P2", "P3"}:
        return f"DLPC1-{number}-{set_code}"
    if set_code in {"C2", "DIS", "CC1", "PD1", "RPH"}:
        return f"DLPC1-{number}-{set_code}"
    if set_code == "Q3":
        return f"Q3-{number}"
    if set_code == "D23":   # Lorcast's "D23 Collection" (2024 on) is our D23C; our D23-1..7 are the older D23 Expo promos
        return f"D23C-{number}"
    return None


def name_key(n: str) -> str:
    n = unicodedata.normalize("NFD", re.sub(r"\s*\(.*?\)\s*", "", n or "").lower())
    return re.sub(r"[^a-z0-9]", "", "".join(ch for ch in n if not unicodedata.combining(ch)))


def load_set(code: str, folder: Path | None) -> list[dict]:
    if folder:
        p = folder / f"set_{code}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    req = urllib.request.Request(f"https://api.lorcast.com/v0/sets/{code}/cards", headers={"User-Agent": "inkwell-prices (github.com/luiscredie/inkwell)", "Accept": "application/json"})
    # Lorcast sometimes cuts the answer short (http.client.IncompleteRead) or drops the connection: the daily run
    # failed on 14 and 15/11/2026 for that alone. Ask again a few times before giving up; a 4xx is not retried.
    last: Exception | None = None
    for attempt in range(RETRIES):
        if attempt:
            time.sleep(RETRY_WAIT * attempt)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(0.15)
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except (http.client.HTTPException, urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            last = e
        print(f"set {code}: attempt {attempt + 1}/{RETRIES} failed ({type(last).__name__}: {last})", flush=True)
    raise RuntimeError(f"Lorcast did not answer set {code} after {RETRIES} attempts") from last


def today_sp() -> str:   # the date in São Paulo (UTC-3), so a morning run is "today" there
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date().isoformat()


def usd_brl() -> float:
    def get(url: str):
        req = urllib.request.Request(url, headers={"User-Agent": "inkwell-prices"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    tries = [
        ("https://economia.awesomeapi.com.br/json/last/USD-BRL", lambda d: d["USDBRL"]["bid"]),
        ("https://open.er-api.com/v6/latest/USD", lambda d: d["rates"]["BRL"]),
        ("https://api.frankfurter.app/latest?from=USD&to=BRL", lambda d: d["rates"]["BRL"]),
    ]
    for url, pick in tries:
        try:
            v = round(float(pick(get(url))), 4)
            if 2 < v < 20:
                print(f"USD/BRL {v} from {url}")
                return v
        except Exception as e:  # noqa: BLE001 - try the next source
            print(f"rate source failed: {url}: {e}")
    raise SystemExit("no USD/BRL rate available")


def add_history(day: str, rate: float, tcg: dict[str, dict]) -> int:
    """One file per day (data/price-history-tcg/<date>.json) and an index of the days kept, so the
    repo grows by one small file a day and the Preços page downloads only the days it shows."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    snap = {"date": day, "usd_brl": rate, "prices": {cid: [e.get("n"), e.get("f")] for cid, e in sorted(tcg.items())}}
    (HISTORY_DIR / f"{day}.json").write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    days = sorted(p.stem for p in HISTORY_DIR.glob("????-??-??.json"))
    last = datetime.fromisoformat(day)
    keep, weeks = [], set()
    for d in reversed(days):   # newest first: every day for 35 days, then the newest of each week, for a year
        age = (last - datetime.fromisoformat(d)).days
        if age <= 35:
            keep.append(d)
        elif age <= 366:
            wk = datetime.fromisoformat(d).isocalendar()[:2]
            if wk not in weeks:
                weeks.add(wk); keep.append(d)
    for d in set(days) - set(keep):
        (HISTORY_DIR / f"{d}.json").unlink()
    keep.sort()
    rates = {}
    for d in keep:
        try:
            rates[d] = json.loads((HISTORY_DIR / f"{d}.json").read_text(encoding="utf-8")).get("usd_brl")
        except (OSError, ValueError):
            pass
    doc = {"schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(), "source": "TCGplayer market price via Lorcast",
           "currency": "BRL", "path": "price-history-tcg/{date}.json", "note": "each day: prices[id] = [normal, foil] in BRL at that day's usd_brl",
           "days": [{"date": d, "usd_brl": rates.get(d)} for d in keep]}
    HISTORY.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return len(keep)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rate", required=True, help="BRL per USD, or 'auto' for today's rate")
    ap.add_argument("--history", action="store_true", help="also add today's prices to price-history-tcg.json")
    ap.add_argument("--input", type=Path, help="folder with set_<code>.json saved from the Lorcast API")
    a = ap.parse_args()
    a.rate = usd_brl() if a.rate == "auto" else float(a.rate)
    cards = {c["card_id"]: c["name_en"] for c in json.loads((ROOT / "site" / "data" / "cards.json").read_text(encoding="utf-8-sig"))["cards"]}
    old = json.loads(PRICES.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for code in SETS:
        for c in load_set(code, a.input):
            cid = card_id(code, str(c.get("collector_number") or ""))
            pr = c.get("prices") or {}
            if not cid or cid not in cards:
                continue
            name = c.get("name", "") + (" - " + c["version"] if c.get("version") else "")
            if name_key(name)[:12] != name_key(cards[cid])[:12]:   # numbering differs between sources (e.g. D23): skip rather than misprice
                continue
            e = {}
            if pr.get("usd"):
                v = round(float(pr["usd"]) * a.rate, 2); e.update(n=v, nl=v, nh=v)
            if pr.get("usd_foil"):
                v = round(float(pr["usd_foil"]) * a.rate, 2); e.update(f=v, fl=v, fh=v)
                if "n" not in e:   # foil-only printings (Enchanted, Epic, Iconic): the collection may count them as normal copies
                    e.update(n=v, nl=v, nh=v)
            if e:
                out[cid] = e
    tcg = len(out)
    if tcg < MIN_TCG:
        raise SystemExit(f"only {tcg} cards priced from TCGplayer (expected {MIN_TCG}+): keeping current prices")
    fresh = dict(out)
    # Keep independent datasets. Liga prices are the preferred *per-finish*
    # source until five full local days have elapsed since their last valid
    # capture. Expired Liga finishes fall back to fresh TCG prices if available.
    from datetime import date
    liga = old.get("liga_prices") or {}
    ages = old.get("ligalorcana_last_valid_at") or {}
    today = datetime.fromisoformat(today_sp()).date()
    combined = {cid: dict(v) for cid, v in fresh.items()}
    # Incomplete Lorcast updates must never delete previously displayed finishes.
    for cid, previous in old.get("prices", {}).items():
        if isinstance(previous, dict):
            dest = combined.setdefault(cid, {})
            for k, value in previous.items():
                if k in ("n", "nl", "nh", "f", "fl", "fh"):
                    dest.setdefault(k, value)
    active_liga = set()
    fallback_count = 0
    for cid, source_entry in liga.items():
        if not isinstance(source_entry, dict):
            continue
        dest = combined.setdefault(cid, {})
        for finish, keys in (("normal", ("nl", "n", "nh")), ("foil", ("fl", "f", "fh"))):
            if not all(k in source_entry for k in keys):
                continue
            last = ages.get(cid, {}).get(finish) or old.get("liga_date")
            try:
                last_date = datetime.fromisoformat(str(last).replace("Z", "+00:00")).date()
                active = 0 <= (today - last_date).days < 5
            except (ValueError, TypeError):
                active = False
            if active or not all(k in fresh.get(cid, {}) for k in keys):
                dest.update({k: source_entry[k] for k in keys})
                if active:
                    active_liga.add(cid)
            else:
                fallback_count += 1
    doc = {
        "schema_version": old.get("schema_version", 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "LigaLorcana (<5 days) preferred, TCGplayer via Lorcast fallback",
        "currency": "BRL",
        "usd_brl": a.rate,
        "sources": {"tcgplayer": tcg, "ligalorcana_active": len(active_liga),
                    "tcgplayer_fallback_finishes": fallback_count},
        "liga_date": old.get("liga_date"),
        "liga_prices": dict(sorted(liga.items())),
        "ligalorcana_last_valid_at": ages,
        "tcg_prices": dict(sorted(fresh.items())),
        "prices": dict(sorted(combined.items())),
    }
    PRICES.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\\n", encoding="utf-8")
    print(f"{tcg} TCGplayer cards, {len(active_liga)} recent Liga cards, {fallback_count} fallback finishes")
    if a.history:
        print(f"price-history-tcg.json: {add_history(today_sp(), a.rate, fresh)} snapshots")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
