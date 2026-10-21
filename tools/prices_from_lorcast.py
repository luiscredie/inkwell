#!/usr/bin/env python3
"""Stop-gap prices: TCGplayer market prices (USD, via the Lorcast API) converted to BRL.

    python tools/prices_from_lorcast.py --rate 5.0171 [--input DIR_WITH_set_*.json]

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
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRICES = ROOT / "site" / "data" / "prices.json"
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
    with urllib.request.urlopen(f"https://api.lorcast.com/v0/sets/{code}/cards", timeout=60) as r:
        time.sleep(0.15)
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rate", type=float, required=True, help="BRL per USD")
    ap.add_argument("--input", type=Path, help="folder with set_<code>.json saved from the Lorcast API")
    a = ap.parse_args()
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
    for cid, e in old["prices"].items():
        out.setdefault(cid, e)
    doc = {
        "schema_version": old.get("schema_version", 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": f"TCGplayer market price via Lorcast (USD x {a.rate} = BRL); Liga Lorcana {str(old.get('generated_at'))[:10]} where TCGplayer has no price",
        "currency": "BRL",
        "usd_brl": a.rate,
        "sources": {"tcgplayer": tcg, "ligalorcana": len(out) - tcg},
        "prices": dict(sorted(out.items())),
    }
    PRICES.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{tcg} cards priced from TCGplayer, {len(out) - tcg} kept from Liga Lorcana, {len(out)} in total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
