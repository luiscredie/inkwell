#!/usr/bin/env python3
"""Build site/data/prices-br.json: Brazilian reference prices from MYP Cards, shown next to TCGplayer.

Input: precos-inkwell-referencia-brl.json from a MYP Cards collection run (one entry per Inkwell card_id,
with minimum_listing_brl and the product URL). The price is the lowest listing MYP shows for the product;
it does not separate normal/foil, language or condition, so the site shows it as "a partir de" and never
mixes it into prices.json.

  python tools/prices_from_mypcards.py --input path/to/precos-inkwell-referencia-brl.json
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
URL_RE = re.compile(r"^https://mypcards\.com/lorcana/produto/(\d+/[a-z0-9-]+)$")


def build(src: Path, out: Path = SITE / "data" / "prices-br.json") -> dict:
    ref = json.loads(src.read_text(encoding="utf-8-sig"))
    if ref.get("currency") != "BRL" or not isinstance(ref.get("prices"), dict):
        raise SystemExit("not a MYP Cards reference file (currency BRL, prices{})")
    catalog = json.loads((SITE / "data" / "cards.json").read_text(encoding="utf-8-sig"))
    known = {c["card_id"] for c in catalog["cards"]}
    cards, skipped = {}, []
    for cid, e in sorted(ref["prices"].items()):
        p = e.get("minimum_listing_brl")
        m = URL_RE.match(e.get("source_url") or "")
        if cid not in known or not isinstance(p, (int, float)) or p <= 0 or not m:
            skipped.append(cid)
            continue
        cards[cid] = [round(float(p), 2), m.group(1)]
    data = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "MYP Cards",
        "source_url": "https://mypcards.com/lorcana",
        "product_url": "https://mypcards.com/lorcana/produto/{path}",
        "currency": "BRL",
        "price_type": "minimum_advertised_listing",
        "note": "Menor anúncio na MYP Cards; não separa normal/foil, idioma nem condição.",
        "retrieved_at": ref.get("retrieved_at"),
        "count": len(cards),
        "cards": cards,
    }
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{out}: {len(cards)} cards, {len(skipped)} skipped")
    return data


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, type=Path)
    build(ap.parse_args().input)
