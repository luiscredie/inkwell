#!/usr/bin/env python3
"""Build the minimal directory published by GitHub Pages.

Development caches, recovery files and pipeline-only metadata stay out of the
public artifact. Card images not referenced by cards.json are removed from the
copy as a final safety net. The source tree is never modified.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import shutil
from pathlib import Path
from typing import Any


EXCLUDED_FILES = {
    "LEIA.txt",
    "README.txt",
    "card-catalog-master.json",
    "index.html.bak",
    "data/card-price-map.json",
    "data/cards.backup.json",
    "data/cards.json.bak",
    "data/inkability-report.json",
    "data/ligalorcana-catalog.json",
    "data/ligalorcana-price-map.v4.json",
    "data/ligalorcana-prices.before-v5.json",
    "data/ligalorcana-prices.failed-403-2026-07-31.json",
    "data/ligalorcana-prices.json",
    "data/lorcast-inkability-cache.json",
    "data/price-analytics.json",
    "data/production-corrections.json",
    "lorcana-card-images/download_summary.json",
    "lorcana-card-images/image_manifest.csv",
    "lorcana-card-images/image_manifest.json",
}
EXCLUDED_NAMES = {".DS_Store", "__pycache__"}
CARD_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".avif"}


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def safe_output(source: Path, output: Path) -> tuple[Path, Path]:
    source = source.resolve()
    output = output.resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError("source and output must be separate, non-nested directories")
    if not (source / "index.html").is_file():
        raise FileNotFoundError(f"{source}: site/index.html not found")
    return source, output


def copy_public_tree(source: Path, output: Path) -> None:
    source, output = safe_output(source, output)

    def ignore(directory: str, names: list[str]) -> list[str]:
        relative_dir = Path(directory).resolve().relative_to(source).as_posix()
        ignored = []
        for name in names:
            relative = f"{relative_dir}/{name}" if relative_dir != "." else name
            if name in EXCLUDED_NAMES or relative in EXCLUDED_FILES:
                ignored.append(name)
        return ignored

    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(source, output, ignore=ignore, copy_function=shutil.copy2)


def remove_orphan_card_images(source: Path, output: Path) -> tuple[int, int]:
    cards_doc = load_json(source / "data" / "cards.json")
    cards = cards_doc.get("cards")
    if not isinstance(cards, list):
        raise ValueError("data/cards.json: expected cards[]")
    referenced = {
        Path(str(card.get("image_file"))).as_posix()
        for card in cards
        if isinstance(card, dict) and card.get("image_file")
    }
    image_root = output / "lorcana-card-images"
    removed = 0
    if image_root.is_dir():
        for path in image_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in CARD_IMAGE_SUFFIXES:
                continue
            if path.relative_to(image_root).as_posix() not in referenced:
                path.unlink()
                removed += 1
    missing = sum(1 for relative in referenced if not (image_root / relative).is_file())
    return removed, missing


def directory_bytes(root: Path) -> int:
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file())


def optimize_card_images(
    output: Path,
    *,
    max_size: tuple[int, int] = (734, 1024),
    quality: int = 82,
    workers: int = 4,
) -> dict[str, int]:
    try:
        from PIL import Image, ImageOps
    except ImportError as error:
        raise RuntimeError(
            "image optimization requires Pillow; install tools/requirements-pages.txt"
        ) from error

    image_root = output / "lorcana-card-images"
    paths = sorted(
        path for path in image_root.rglob("*")
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg"}
    ) if image_root.is_dir() else []

    def optimize(path: Path) -> tuple[int, int, bool]:
        before = path.stat().st_size
        temp = path.with_name(path.name + ".optimized")
        try:
            with Image.open(path) as opened:
                image = ImageOps.exif_transpose(opened)
                must_resize = image.width > max_size[0] or image.height > max_size[1]
                image.thumbnail(max_size, Image.Resampling.LANCZOS)
                if image.mode != "RGB":
                    image = image.convert("RGB")
                image.save(
                    temp,
                    format="JPEG",
                    quality=quality,
                    optimize=True,
                    progressive=True,
                    subsampling="4:2:0",
                )
            after = temp.stat().st_size
            if after < before or must_resize:
                temp.replace(path)
                return before, after, True
            temp.unlink()
            return before, before, False
        finally:
            if temp.exists():
                temp.unlink()

    before_total = 0
    after_total = 0
    changed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for before, after, was_changed in pool.map(optimize, paths):
            before_total += before
            after_total += after
            changed += int(was_changed)
    return {
        "images_seen": len(paths),
        "images_optimized": changed,
        "image_bytes_before": before_total,
        "image_bytes_after": after_total,
    }


def build_pages_artifact(
    source: Path,
    output: Path,
    *,
    optimize_images: bool = False,
) -> dict[str, Any]:
    source, output = safe_output(source, output)
    copy_public_tree(source, output)
    orphan_images_removed, referenced_images_missing = remove_orphan_card_images(
        source, output
    )
    image_summary = optimize_card_images(output) if optimize_images else {
        "images_seen": 0,
        "images_optimized": 0,
        "image_bytes_before": 0,
        "image_bytes_after": 0,
    }
    return {
        "source": str(source),
        "output": str(output),
        "bytes": directory_bytes(output),
        "excluded_files": len(EXCLUDED_FILES),
        "orphan_images_removed": orphan_images_removed,
        "referenced_images_missing": referenced_images_missing,
        **image_summary,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("site"))
    parser.add_argument("--output", type=Path, default=Path("_site"))
    parser.add_argument("--optimize-images", action="store_true")
    args = parser.parse_args()
    result = build_pages_artifact(
        args.source,
        args.output,
        optimize_images=args.optimize_images,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
