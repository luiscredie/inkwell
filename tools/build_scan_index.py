#!/usr/bin/env python3
"""Build the card-scanner index used by Coleção → Escanear.

    python tools/build_scan_index.py     (after new card images arrive; takes ~2 minutes)

For every card image in site/lorcana-card-images/images it stores a small "fingerprint" of the art:
the card is scaled to 250×350, the art box (x 13–237, y 26–194) is split into 16×12 cells of 14 px,
each cell's average colour goes to CIELAB, each channel is standardised, the vector is unit-length
and stored as int8. The page computes the same fingerprint from the camera
(src/site/colecao/colecao.template.html, `scanDesc`), so any change here must be made there too.

Output: site/data/scan-index.bin (int8, cards × 576) and site/data/scan-index.json (ids in the same order).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "site" / "lorcana-card-images" / "images"
DATA = ROOT / "site" / "data"
GX, GY, CELL, AX, AY, GAIN = 16, 12, 14, 13, 26, 4.0


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    x = (c[..., 0] * 0.4124 + c[..., 1] * 0.3576 + c[..., 2] * 0.1805) / 0.95047
    y = c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722
    z = (c[..., 0] * 0.0193 + c[..., 1] * 0.1192 + c[..., 2] * 0.9505) / 1.08883
    f = lambda t: np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16 / 116)  # noqa: E731
    fx, fy, fz = f(x), f(y), f(z)
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], -1)


def fingerprint(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGB").resize((250, 350), Image.BOX), dtype=np.float64)
    art = a[AY:AY + GY * CELL, AX:AX + GX * CELL]
    cells = art.reshape(GY, CELL, GX, CELL, 3).mean(axis=(1, 3))
    v = srgb_to_lab(cells).reshape(-1, 3)
    v = (v - v.mean(0)) / (v.std(0) + 1e-6)
    v = v.ravel()
    return v / np.linalg.norm(v)


def main() -> None:
    catalog = json.loads((DATA / "cards.json").read_text(encoding="utf-8-sig"))
    known = {c["card_id"] for c in catalog["cards"]}
    ids, rows = [], []
    for f in sorted(IMAGES.iterdir()):
        m = re.search(r"__([A-Z0-9]+-[0-9A-Za-z-]+)\.(jpg|jpeg|png|webp)$", f.name)
        if not m or m.group(1) not in known:
            continue
        try:
            rows.append(fingerprint(Image.open(f)))
        except OSError:
            continue
        ids.append(m.group(1))
    q = np.clip(np.round(np.array(rows) * 127 * GAIN), -127, 127).astype(np.int8)
    (DATA / "scan-index.bin").write_bytes(q.tobytes())
    (DATA / "scan-index.json").write_text(json.dumps({
        "version": 1, "dims": GX * GY * 3, "grid": [GX, GY], "cell": CELL, "art": [AX, AY], "card": [250, 350],
        "generated_at": catalog.get("generated_at"), "ids": ids,
    }, separators=(",", ":")), encoding="utf-8")
    print(f"{len(ids)} cards → site/data/scan-index.bin ({q.nbytes // 1024} KB)")


if __name__ == "__main__":
    main()
