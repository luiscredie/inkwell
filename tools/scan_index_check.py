#!/usr/bin/env python3
"""Coleção › Escanear: is the recognition index (site/data/scan-index.*) up to date with the catalog?

    python3 tools/scan_index_check.py            # report; in GitHub Actions also a ::warning:: annotation
    python3 tools/scan_index_check.py --strict   # exit 1 when the index is behind the catalog

CI uses the report mode on purpose: new card images arrive on main through the image routine, and an outdated index
must not turn the release checks red and hold a deploy. It makes the gap visible instead.

A card can only be recognised if it has an image (site/lorcana-card-images/images/…__<ID>.<ext>) when the index is
built (tools/build_scan_index.py). This compares by file names only (no image decoding), so it runs anywhere.
Cards without any image are reported, not failed: there is nothing to recognise them by yet.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA, IMAGES = ROOT / "site" / "data", ROOT / "site" / "lorcana-card-images" / "images"


def main() -> int:
    catalog = {c["card_id"] for c in json.loads((DATA / "cards.json").read_text(encoding="utf-8-sig"))["cards"]}
    index = json.loads((DATA / "scan-index.json").read_text(encoding="utf-8"))
    ids = index["ids"]
    size = (DATA / "scan-index.bin").stat().st_size
    with_image = set()
    for f in IMAGES.iterdir():
        m = re.search(r"__([A-Z0-9]+-[0-9A-Za-z-]+)\.(jpg|jpeg|png|webp|avif)$", f.name)
        if m and m.group(1) in catalog:
            with_image.add(m.group(1))
    problems = []
    if size != len(ids) * index["dims"]:
        problems.append(f"scan-index.bin has {size} bytes, expected {len(ids)} × {index['dims']}")
    if len(set(ids)) != len(ids):
        problems.append("duplicate ids in the index")
    stale = sorted(set(ids) - catalog)
    if stale:
        problems.append(f"{len(stale)} indexed cards are no longer in the catalog: {stale[:8]}")
    missing = sorted(with_image - set(ids))
    if missing:
        problems.append(f"{len(missing)} cards have an image but are not in the index (run tools/build_scan_index.py): {missing[:8]}")
    no_image = sorted(catalog - with_image)
    print(f"catalog {len(catalog)} · with image {len(with_image)} · indexed {len(ids)} "
          f"({100 * len(ids) / len(catalog):.1f}% of the catalog) · without any image {len(no_image)}")
    for p in problems:
        print(("::warning title=Scanner index::" if "GITHUB_ACTIONS" in __import__("os").environ else "WARN ") + p)
    return 1 if problems and "--strict" in sys.argv else 0


if __name__ == "__main__":
    sys.exit(main())
