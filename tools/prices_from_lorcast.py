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
import json
import re
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRICES = ROOT / "site" / "data" / "prices.json"
HISTORY = ROOT / "site" / "data" / "price-history-tcg.json"   # index of the days kept
HISTORY_DIR = ROOT / "site" / "data" / "price-history-tcg"
MIN_TCG = 3000   # fewer priced cards than this means Lorcast answered only in part: keep yesterday's file
SETS = [str(n) for n in range(1, 15)] + ["P1", "P2", "P3", "P4", "D23", "cp", "DIS", "C2", "CC1", "Q3"]


def card_id(set_code: str, number: str) -> str | None:
    if set_code.isdigit():
        return f"LOR{set_code}-{number}"
    if set_code in {"P1", "P2", "P3"}:
        return f"DLPC1-{number}-{set_code}"
    if set_code in {"C2", "DIS", "CC1"}:
        return f"DLPC1-{number}-{set_code}"
    if set_code == "D23":
        return f"D23-{number}"
    return None


def name_key(n: str) -> str:
    n = unicodedata.normalize("NFD", re.sub(r"\s*\(.*?\)\s*", "", n or "").lower())
    return re.sub(r"[^a-z0-9]", "", "".join(ch for ch in n if not unicodedata.combining(ch)))


def load_set(code: str, folder: Path | None) -> list[dict]:
    if folder:
        p = folder / f"set_{code}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    req = urllib.request.Request(f"https://api.lorcast.com/v0/sets/{code}/cards", headers={"User-Agent": "inkwell-prices (github.com/luiscredie/inkwell)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        time.sleep(0.15)
        return json.loads(r.read().decode("utf-8"))


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
        raise SystemExit(f"only {tcg} cards priced from TCGplayer (expected {MIN_TCG}+): keeping the current prices")
    fresh = dict(out)
    liga = old.get("liga_prices")   # the last Liga Lorcana prices, for cards TCGplayer does not price
    if not isinstance(liga, dict):
        liga = {cid: e for cid, e in old["prices"].items() if cid not in out}   # first run after the switch: what TCGplayer did not price
    m = re.search(r"Liga Lorcana (\d{4}-\d{2}-\d{2})", str(old.get("source") or ""))
    liga_date = old.get("liga_date") or (m.group(1) if m else str(old.get("generated_at"))[:10])
    for cid, e in liga.items():
        out.setdefault(cid, e)
    doc = {
        "schema_version": old.get("schema_version", 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": f"TCGplayer market price via Lorcast (USD x {a.rate} = BRL); Liga Lorcana {liga_date} where TCGplayer has no price",
        "currency": "BRL",
        "usd_brl": a.rate,
        "sources": {"tcgplayer": tcg, "ligalorcana": len(out) - tcg},
        "liga_date": liga_date,
        "liga_prices": dict(sorted((cid, e) for cid, e in liga.items() if cid not in fresh)),
        "prices": dict(sorted(out.items())),
    }
    PRICES.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{tcg} cards priced from TCGplayer, {len(out) - tcg} kept from Liga Lorcana, {len(out)} in total")
    if a.history:
        print(f"price-history-tcg.json: {add_history(today_sp(), a.rate, fresh)} snapshots")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
