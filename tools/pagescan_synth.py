#!/usr/bin/env python3
"""Synthetic binder-page photos for measuring Scanner 2.0 ("Escanear página").

    python3 tools/pagescan_synth.py OUT_DIR [--pages 8] [--seed 1]

Builds 3×3 binder pages from the real card images (site/lorcana-card-images/images), photographs them virtually
under several conditions and writes OUT_DIR/<cond>-<n>.jpg plus OUT_DIR/truth.json:
  {"pages": [{"file", "cond", "cards": [id | null × 9], "corners": [[x,y]×4], "user": [[x,y]×4]}]}
corners: where the pocket area really is in the photo; user: those corners moved a little, as a person lining the
page up with the on-screen frame would (the scanner gets "user", never the true corners).

These are not real photos. They measure the recognition engine under controlled damage (tilt, glare, low light,
blur, foil shine, empty pockets, JPEG); real photos are still needed before any accuracy claim about the product.
Nothing here is committed as data: the images go to OUT_DIR only.
"""
from __future__ import annotations

import io
import json
import random
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "site" / "lorcana-card-images" / "images"
PW, PH = 210, 294          # one pocket in the flat page, before scaling (card 63 × 88 mm at ~3.3 px/mm)
CW, CH = 196, 274          # the card inside it
CONDS = ["clean", "tilt", "rotate", "glare", "dark", "blur", "foil", "hard"]


def perspective_coeffs(dst, src):
    """PIL wants the map output(x,y) -> input(u,v): 8 coefficients from 4 point pairs."""
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(A, float), np.array(b, float)).tolist()


def card_files():
    out = {}
    for f in IMAGES.iterdir():
        m = re.search(r"__([A-Z0-9]+-[0-9A-Za-z-]+)\.(jpg|jpeg|png|webp)$", f.name)
        if m:
            out[m.group(1)] = f
    return out


def flat_page(cards, files, rng, foil):
    S = 3   # draw at 3× and shrink: smoother edges
    page = Image.new("RGB", (PW * 3 * S, PH * 3 * S), (28, 29, 36))
    d = ImageDraw.Draw(page)
    for r in range(3):
        for c in range(3):
            x, y = c * PW * S, r * PH * S
            d.rectangle([x + 2 * S, y + 2 * S, x + (PW - 2) * S, y + (PH - 2) * S], outline=(60, 62, 72), width=2 * S)   # pocket seam
            cid = cards[r * 3 + c]
            if not cid:
                continue
            im = Image.open(files[cid]).convert("RGB").resize((CW * S, CH * S), Image.LANCZOS)
            if foil and rng.random() < 0.7:   # foil: a rainbow sheen over the card
                g = np.linspace(0, 1, CW * S)[None, :] + np.linspace(0, 0.6, CH * S)[:, None]
                rain = np.stack([np.sin(6.28 * g) * 0.5 + 0.5, np.sin(6.28 * g + 2.1) * 0.5 + 0.5, np.sin(6.28 * g + 4.2) * 0.5 + 0.5], -1) * 255
                a = rng.uniform(0.18, 0.32)
                im = Image.fromarray((np.asarray(im, float) * (1 - a) + rain * a).clip(0, 255).astype(np.uint8))
            im = im.rotate(rng.uniform(-2, 2), resample=Image.BICUBIC, expand=False, fillcolor=(28, 29, 36))
            ox = int((PW - CW) / 2 * S + rng.uniform(-4, 4) * S)
            oy = int((PH - CH) / 2 * S + rng.uniform(-4, 4) * S)
            page.paste(im, (x + ox, y + oy))
    sleeve = Image.new("RGB", page.size, (255, 255, 255))   # sleeve plastic: a faint even haze
    page = Image.blend(page, sleeve, 0.04)
    return page.resize((PW * 3, PH * 3), Image.LANCZOS)


def photo(page, cond, rng):
    W, H = 1500, 2000
    bg = np.full((H, W, 3), (92, 70, 52), float) + rng.normal(0, 6, (H, W, 1))   # a wooden table
    bg = Image.fromarray(bg.clip(0, 255).astype(np.uint8))
    pw = rng.uniform(0.72, 0.84) * W
    ph = pw * page.height / page.width
    cx, cy = W / 2 + rng.uniform(-0.03, 0.03) * W, H / 2 + rng.uniform(-0.03, 0.03) * H
    q = np.array([[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]])
    if cond in ("rotate", "hard"):
        a = np.radians(rng.uniform(-8, 8) if cond == "rotate" else rng.uniform(-5, 5))
        q = q @ np.array([[np.cos(a), np.sin(a)], [-np.sin(a), np.cos(a)]])
    if cond in ("tilt", "hard"):   # phone not parallel to the page: the far edge looks shorter
        k = rng.uniform(0.07, 0.12)
        if rng.random() < 0.5:
            q[0, 0] += k * pw / 2; q[1, 0] -= k * pw / 2
        else:
            q[0, 1] += k * ph / 2; q[3, 1] -= k * ph / 2
    q = q + [cx, cy]
    coeffs = perspective_coeffs(q.tolist(), [[0, 0], [page.width, 0], [page.width, page.height], [0, page.height]])
    warped = page.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", page.size, 255).transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    img = Image.composite(warped, bg, mask)
    a = np.asarray(img, float)
    if cond in ("glare", "hard"):   # light reflected by the sleeves
        yy, xx = np.mgrid[0:H, 0:W]
        for _ in range(rng.choice([1, 2])):
            gx, gy, rad = rng.uniform(0.25, 0.75) * W, rng.uniform(0.25, 0.75) * H, rng.uniform(0.08, 0.16) * W
            s = np.exp(-(((xx - gx) ** 2 + ((yy - gy) * 1.4) ** 2) / (2 * rad ** 2)))[..., None] * rng.uniform(0.6, 0.85)
            a = a * (1 - s) + 255 * s
    if cond in ("dark", "hard"):   # dim room, warm bulb, sensor noise
        a = a * rng.uniform(0.3, 0.45) * np.array([1.08, 1.0, 0.85]) + rng.normal(0, 7, a.shape)
    img = Image.fromarray(a.clip(0, 255).astype(np.uint8))
    if cond == "blur":
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(2.0, 3.2)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=int(rng.uniform(72, 88)))
    user = (q + rng.uniform(-0.02, 0.02, q.shape) * [pw, ph]).tolist()   # lined up by hand: off by up to 2%
    return buf.getvalue(), q.tolist(), user


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    pages = int(sys.argv[sys.argv.index("--pages") + 1]) if "--pages" in sys.argv else 8
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 1
    ids = set(json.loads((ROOT / "site" / "data" / "scan-index.json").read_text())["ids"])
    files = {k: v for k, v in card_files().items() if k in ids}
    pool = sorted(files)
    rng = random.Random(seed)
    nrng = np.random.default_rng(seed)
    truth = []
    for cond in CONDS:
        for n in range(pages):
            cards = rng.sample(pool, 9)
            if rng.random() < 0.35:   # an empty pocket now and then
                cards[rng.randrange(9)] = None
            page = flat_page(cards, files, nrng, cond in ("foil", "hard"))
            jpg, corners, user = photo(page, cond, nrng)
            name = f"{cond}-{n}.jpg"
            (out / name).write_bytes(jpg)
            truth.append({"file": name, "cond": cond, "cards": cards, "corners": corners, "user": user})
    (out / "truth.json").write_text(json.dumps({"seed": seed, "pages": truth}, indent=1))
    print(f"{len(truth)} pages, {sum(c is not None for p in truth for c in p['cards'])} cards -> {out}")


if __name__ == "__main__":
    main()
