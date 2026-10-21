#!/usr/bin/env python3
"""Build site/decks/index.html (the Decks page of the new site).

Sources live in this repo, so the page can always be rebuilt:
  src/site/decks/decks.template.html   markup, styles and page code
  src/site/cloud.js                    sign-in + REST adapter shared by the site pages
  src/site/shell.js                    top bar / tab bar / account menu / sign-in sheet
  site/data/cards.json                 card catalog (a compact index is embedded)

Run after a catalog update:  python tools/build_site_decks.py
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "site"
SITE = ROOT / "site"
SKIP_TYPES = {"Non-Playable Insert", "Quest Component"}
CLOUD = {"url": "https://sorefaetiaebmjploanp.supabase.co", "key": "sb_publishable_RkAWW-ENz70CXA6_QV7aHw_MpfD7Gn2"}


def song(card: dict) -> bool:
    return card.get("card_type") == "Song" or (card.get("card_type") == "Action" and "song" in str(card.get("classification") or "").lower())


def card_index(catalog: dict) -> dict:
    """[id, name, cost, type, ink, rarity, set, number, image, inkable, lore, song]"""
    cards = []
    for c in catalog.get("cards", []):
        if c.get("card_type") in SKIP_TYPES or not c.get("card_id"):
            continue
        cards.append([c["card_id"], c.get("name_en") or "", c.get("ink_cost"), c.get("card_type") or "", c.get("ink_color") or "",
                      c.get("rarity") or "", c.get("set_code") or "", str(c.get("card_number") or ""), c.get("image_file") or "",
                      1 if c.get("inkable") else 0, c.get("lore") or 0, 1 if song(c) else 0])
    sets = [{"code": s.get("code"), "name_en": s.get("name_en"), "name_pt": s.get("name_pt")} for s in catalog.get("sets", []) if isinstance(s, dict)]
    return {"generated_at": catalog.get("generated_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sets": sets, "cards": cards}


def script_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def build(out: Path = SITE / "decks" / "index.html") -> Path:
    catalog = json.loads((SITE / "data" / "cards.json").read_text(encoding="utf-8-sig"))
    tpl = (SRC / "decks" / "decks.template.html").read_text(encoding="utf-8")
    cloud = (SRC / "cloud.js").read_text(encoding="utf-8")
    shell = (SRC / "shell.js").read_text(encoding="utf-8")
    cfg = {**CLOUD, "redirect": "https://luiscredie.github.io/inkwell/decks/"}
    html = (tpl
            .replace("/*@CLOUD@*/", f"window.INKWELL_CLOUD_CONFIG = {json.dumps(cfg)};\n{cloud}")
            .replace("/*@CARD_INDEX@*/", f"const CARD_INDEX = {script_json(card_index(catalog))};")
            .replace("/*@SHELL@*/", f"window.INKWELL_SHELL = {json.dumps({'page': 'decks'})};\n{shell}"))
    for marker in ("/*@CLOUD@*/", "/*@CARD_INDEX@*/", "/*@SHELL@*/"):
        assert marker not in html, marker
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out


if __name__ == "__main__":
    print(build())
