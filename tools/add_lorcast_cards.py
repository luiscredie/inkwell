#!/usr/bin/env python3
"""Add printings that are missing from site/data/cards.json, from the Lorcast API (api.lorcast.com).

    python tools/add_lorcast_cards.py --set D23 --prefix D23C --name "D23 Collection"

For each card of the Lorcast set whose id (<prefix>-<collector number>) is not in cards.json yet:
  * the rules text, cost, stats, classification and tags come from a printing of the same card that is already in the
    catalog (so a promo plays exactly like its normal version); without one, from Lorcast;
  * the picture is downloaded to site/lorcana-card-images/images/ (Lorcast's "large" image, kept as .avif);
  * rarity "P" (promo) unless Lorcast says Enchanted/Epic/Iconic.
Existing cards are never changed. Run tools/build_site_pages.py afterwards (the pages embed the card index).
The daily price job (tools/prices_from_lorcast.py) prices them from then on: its SET_PREFIX map must know the prefix.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / "site" / "data" / "cards.json"
MANIFEST = ROOT / "site" / "lorcana-card-images" / "image_manifest.json"
IMAGES = ROOT / "site" / "lorcana-card-images" / "images"
UA = {"User-Agent": "inkwell-catalog (github.com/luiscredie/inkwell)", "Accept": "application/json"}
RARITY = {"Enchanted": "E", "Epic": "EP", "Iconic": "I", "Legendary": "L", "Super_rare": "SR", "Super Rare": "SR",
          "Rare": "R", "Uncommon": "U", "Common": "C", "Promo": "P"}
INK_LETTER = {"Amber": "A", "Amethyst": "M", "Emerald": "E", "Ruby": "R", "Sapphire": "S", "Steel": "T"}


def key(name: str) -> str:
    n = unicodedata.normalize("NFD", re.sub(r"\s*\(.*?\)\s*", " ", name or "").lower())
    n = "".join(ch for ch in n if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9'!.,&()_-]+", "_", name.replace(" - ", "_-_")).strip("_")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True, help="Lorcast set code, e.g. D23")
    ap.add_argument("--prefix", required=True, help="our id prefix, e.g. D23C (ids become D23C-1, D23C-2, ...)")
    ap.add_argument("--name", help="set name for cards.json (default: Lorcast's)")
    ap.add_argument("--input", type=Path, help="a saved copy of https://api.lorcast.com/v0/sets/<set>/cards")
    ap.add_argument("--no-images", action="store_true")
    a = ap.parse_args()

    data = json.loads(CARDS.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.is_file() else {}
    have = {c["card_id"] for c in data["cards"]}
    by_name: dict[str, dict] = {}
    for c in data["cards"]:
        if re.match(r"^LOR\d+-\d+$", c["card_id"]):   # a main-set printing is the reference for the rules
            by_name.setdefault(key(c["name_en"]), c)
    for c in data["cards"]:
        by_name.setdefault(key(c["name_en"]), c)

    src = json.loads(a.input.read_text(encoding="utf-8")) if a.input else json.loads(get(f"https://api.lorcast.com/v0/sets/{a.set}/cards"))
    added = []
    for lc in src:
        num = str(lc.get("collector_number") or "").strip()
        if not num:
            continue
        cid = f"{a.prefix}-{num}"
        if cid in have:
            continue
        name = f"{lc['name']} - {lc['version']}" if lc.get("version") else lc["name"]
        base = by_name.get(key(name))
        img_url = ((lc.get("image_uris") or {}).get("digital") or {}).get("large") or ""
        fname = f"images/{safe(name)}__{cid}.avif"
        card = dict(base) if base else {}
        ink = (lc.get("inks") or [lc.get("ink")] or [None])[0]
        card.update({
            "card_id": cid, "set_code": a.prefix, "card_number": num, "name_en": name,
            "rarity": RARITY.get(lc.get("rarity") or "", "P"),
            "image_file": fname, "image_url": img_url, "image_source": "lorcast",
        })
        if not base:   # nothing to copy from: Lorcast's own fields
            card.update({
                "color": "".join(INK_LETTER.get(i, "") for i in (lc.get("inks") or [])), "ink_color": "/".join(lc.get("inks") or [ink or ""]),
                "ink_cost": lc.get("cost"), "card_type": (lc.get("type") or [""])[0], "inkable": 1 if lc.get("inkwell") else 0,
                "classification": ", ".join(lc.get("classifications") or []), "strength": lc.get("strength"),
                "willpower": lc.get("willpower"), "lore": lc.get("lore"), "ability_text": lc.get("text") or "",
                "ability_text_raw": lc.get("text") or "", "tags": "", "abilities": [],
            })
        else:   # the copied abilities carry the old id
            card["abilities"] = [{**ab, "ability_id": re.sub(r"^[^-]+-[^-]+", cid, ab.get("ability_id", ""))} for ab in base.get("abilities") or []]
        if a.no_images or not img_url:   # no picture: the pages show the card without art
            card["image_file"] = ""; card["image_url"] = ""
        else:
            IMAGES.mkdir(parents=True, exist_ok=True)
            blob = get(img_url)
            (IMAGES / Path(fname).name).write_bytes(blob)
            manifest[cid] = {"display_name": name, "image_file": fname, "image_url": img_url, "status": "downloaded",
                             "sha256": hashlib.sha256(blob).hexdigest(), "source": "lorcast"}
        data["cards"].append(card)
        added.append((cid, name, "rules from " + base["card_id"] if base else "rules from Lorcast"))

    if not added:
        print("Nothing to add."); return 0
    if not any(s.get("code") == a.prefix for s in data["sets"]):
        data["sets"].append({"code": a.prefix, "name_en": a.name or (src[0].get("set") or {}).get("name") or a.prefix, "name_pt": None})
    CARDS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if MANIFEST.is_file() or manifest:
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for x in added:
        print("added", *x)
    return 0


if __name__ == "__main__":
    sys.exit(main())
