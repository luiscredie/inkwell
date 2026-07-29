#!/usr/bin/env python3
"""Refresh Inkwell artifact hashes, sizes, counts and timestamp.

The command validates every published artifact before replacing the manifest.
It does not modify cards, translations, prices, history or images.

    python tools/refresh_data_manifest.py --root site
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def safe_artifact_path(base: Path, relative: str) -> Path:
    if not relative or ".." in relative or relative.startswith(("/", "\\")):
        raise ValueError(f"unsafe artifact path: {relative!r}")
    path = (base / relative).resolve()
    path.relative_to(base.resolve())
    return path


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            result.update(chunk)
    return result.hexdigest()


def count_cards(data: dict[str, Any]) -> int:
    cards = data.get("cards")
    return len(cards) if isinstance(cards, (list, dict)) else 0


def count_prices(data: dict[str, Any]) -> int:
    prices = data.get("prices") or data.get("prices_by_liga_id")
    return len(prices) if isinstance(prices, dict) else 0


def build_refreshed_manifest(
    root: Path,
    *,
    generated_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest_path = root / "data-manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"{manifest_path}: not found")
    manifest = load_json(manifest_path)
    artifacts = manifest.get("artifacts") or manifest.get("files")
    schemas = manifest.get("schema") or {}
    if not isinstance(artifacts, dict) or not artifacts:
        raise ValueError("data-manifest.json: missing artifacts/files map")

    parsed: dict[str, dict[str, Any]] = {}
    refreshed: dict[str, dict[str, Any]] = {}
    for kind, entry in artifacts.items():
        if not isinstance(entry, dict):
            raise ValueError(f"{kind}: manifest entry must be an object")
        path = safe_artifact_path(manifest_path.parent, str(entry.get("path") or ""))
        if not path.is_file():
            if entry.get("optional"):
                refreshed[kind] = dict(entry)
                continue
            raise FileNotFoundError(f"{kind}: missing {path}")
        data = load_json(path)
        expected_schema = schemas.get(kind)
        if isinstance(expected_schema, int) and data.get("schema_version") != expected_schema:
            raise ValueError(
                f"{kind}: schema_version {data.get('schema_version')} "
                f"!= manifest.schema {expected_schema}"
            )
        parsed[kind] = data
        updated = dict(entry)
        updated["sha256"] = digest(path)
        updated["bytes"] = path.stat().st_size
        refreshed[kind] = updated

    result = dict(manifest)
    result["generated_at"] = generated_at or datetime.now(timezone.utc).isoformat()
    if "artifacts" in manifest:
        result["artifacts"] = refreshed
    else:
        result["files"] = refreshed

    counts = dict(manifest.get("counts") or {})
    if "cards" in parsed:
        counts["cards"] = count_cards(parsed["cards"])
    if "cards_pt" in parsed:
        counts["pt_overlay_cards"] = count_cards(parsed["cards_pt"])
    if "prices" in parsed:
        counts["priced_cards"] = count_prices(parsed["prices"])
    result["counts"] = counts

    summary = {
        "manifest": str(manifest_path),
        "generated_at": result["generated_at"],
        "artifacts": sorted(refreshed),
        "counts": counts,
    }
    return result, summary


def atomic_write_json(path: Path, value: dict[str, Any], retries: int = 5) -> None:
    temp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    temp.write_text(payload, encoding="utf-8")
    for attempt in range(retries):
        try:
            os.replace(temp, path)
            return
        except PermissionError:
            if attempt + 1 >= retries:
                raise
            time.sleep(0.2 * (attempt + 1))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("site"))
    parser.add_argument("--check", action="store_true", help="validate and print without writing")
    args = parser.parse_args()
    root = args.root.resolve()
    manifest, summary = build_refreshed_manifest(root)
    if not args.check:
        atomic_write_json(root / "data-manifest.json", manifest)
    print(json.dumps({**summary, "written": not args.check}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
