#!/usr/bin/env python3
"""Validate Inkwell's cards ↔ image manifest ↔ repository file contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Result:
    total_cards: int = 0
    mapped_cards: int = 0
    pipeline_missing: int = 0
    local_files_ok: int = 0
    remote_only: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def looks_like_image(path: Path) -> bool:
    with path.open("rb") as handle:
        head = handle.read(16)
    return (
        head.startswith(b"\xff\xd8\xff")
        or head.startswith(b"\x89PNG\r\n\x1a\n")
        or (head.startswith(b"RIFF") and head[8:12] == b"WEBP")
        or head[4:12] in {b"ftypavif", b"ftypavis"}
    )


def safe_image_path(root: Path, image_file: str) -> Path | None:
    image_root = (root / "lorcana-card-images").resolve()
    candidate = (image_root / image_file).resolve()
    try:
        candidate.relative_to(image_root)
    except ValueError:
        return None
    return candidate


def validate(root: Path, *, check_hashes: bool = True) -> Result:
    result = Result()
    cards_doc = load_json(root / "data" / "cards.json")
    manifest_doc = load_json(root / "lorcana-card-images" / "image_manifest.json")

    cards = cards_doc.get("cards") if isinstance(cards_doc, dict) else None
    if not isinstance(cards, list):
        result.errors.append("data/cards.json: expected a top-level cards array")
        return result
    if not isinstance(manifest_doc, dict):
        result.errors.append(
            "lorcana-card-images/image_manifest.json: expected an object keyed by card_id"
        )
        return result

    by_id: dict[str, dict[str, Any]] = {}
    for index, card in enumerate(cards):
        if not isinstance(card, dict):
            result.errors.append(f"cards[{index}]: expected an object")
            continue
        card_id = str(card.get("card_id") or "").strip()
        if not card_id:
            result.errors.append(f"cards[{index}]: missing card_id")
            continue
        if card_id in by_id:
            result.errors.append(f"{card_id}: duplicate card_id in cards.json")
            continue
        by_id[card_id] = card

    result.total_cards = len(by_id)

    for card_id, card in by_id.items():
        card_file = str(card.get("image_file") or "").strip()
        card_url = str(card.get("image_url") or "").strip()
        manifest = manifest_doc.get(card_id)

        if not card_file and not card_url:
            result.pipeline_missing += 1
            if isinstance(manifest, dict) and (
                manifest.get("image_file") or manifest.get("image_url")
            ):
                result.errors.append(
                    f"{card_id}: manifest has art but cards.json reports none"
                )
            continue

        result.mapped_cards += 1
        if not isinstance(manifest, dict):
            result.errors.append(f"{card_id}: mapped card is absent from image manifest")
            continue

        manifest_file = str(manifest.get("image_file") or "").strip()
        manifest_url = str(manifest.get("image_url") or "").strip()
        if manifest_file != card_file:
            result.errors.append(
                f"{card_id}: image_file mismatch "
                f"(cards={card_file!r}, manifest={manifest_file!r})"
            )
        if card_url and manifest_url and card_url != manifest_url:
            result.warnings.append(
                f"{card_id}: image_url differs between cards and manifest"
            )

        if not card_file:
            result.remote_only += 1
            continue

        file_path = safe_image_path(root, card_file)
        if file_path is None:
            result.errors.append(f"{card_id}: unsafe image path {card_file!r}")
            continue
        if not file_path.is_file():
            result.errors.append(f"{card_id}: repository file missing: {card_file}")
            continue
        if file_path.stat().st_size <= 0:
            result.errors.append(f"{card_id}: repository file is empty: {card_file}")
            continue
        if not looks_like_image(file_path):
            result.errors.append(
                f"{card_id}: repository file has an unsupported image signature: {card_file}"
            )
            continue

        expected_hash = str(manifest.get("sha256") or "").strip().lower()
        if check_hashes and expected_hash:
            actual_hash = sha256(file_path)
            if actual_hash != expected_hash:
                result.errors.append(
                    f"{card_id}: image checksum mismatch "
                    f"(expected={expected_hash}, actual={actual_hash})"
                )
                continue
        result.local_files_ok += 1

    for card_id, entry in manifest_doc.items():
        if card_id not in by_id and isinstance(entry, dict):
            result.errors.append(f"{card_id}: image manifest references an unknown card_id")

    return result


def print_result(result: Result) -> None:
    print(
        "card-art summary: "
        f"total={result.total_cards} "
        f"mapped={result.mapped_cards} "
        f"pipeline_missing={result.pipeline_missing} "
        f"local_files_ok={result.local_files_ok} "
        f"remote_only={result.remote_only} "
        f"errors={len(result.errors)} "
        f"warnings={len(result.warnings)}"
    )
    for warning in result.warnings:
        print(f"WARN: {warning}")
    for error in result.errors:
        print(f"ERROR: {error}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="repository root",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="skip image checksum reads while retaining path/signature checks",
    )
    args = parser.parse_args(argv)

    try:
        result = validate(args.root.resolve(), check_hashes=not args.quick)
    except (OSError, json.JSONDecodeError) as error:
        print(f"ERROR: validator could not read its inputs: {error}", file=sys.stderr)
        return 2

    print_result(result)
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
