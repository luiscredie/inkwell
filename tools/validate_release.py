#!/usr/bin/env python3
"""Inkwell one-command release validator (M0R).

Verifies the published data contract AND the card-art contract before deploy.
Read-only: never modifies an artifact. Exits non-zero with a specific
filename/reason on any failure.

    python tools/validate_release.py [--root .] [--quick]

--quick skips per-image SHA-256 reads (keeps path/signature checks).
Card-art checks are skipped gracefully when the image tree/manifest are absent
(e.g. validating a docs-only checkout), reported as a warning, not an error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SUPPORTED = {
    "manifest": {1},
    "cards": {3},
    "cards_pt": {1},
    "prices": {2, 3, 4},
    "aliases": {1},
    "validation": {1},
    "price_history": {1, 2, 3, 4},
    "legality": {1},
}
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def load(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def sha256(path: Path) -> str:
    d = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            d.update(chunk)
    return d.hexdigest()


def safe_rel(base: Path, rel: str) -> Path | None:
    if not isinstance(rel, str) or not rel or ".." in rel or rel.startswith(("/", "\\")):
        return None
    if re.match(r"^[a-z]+://", rel):
        return None
    p = (base / rel).resolve()
    try:
        p.relative_to(base.resolve())
    except ValueError:
        return None
    return p


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.info: dict[str, Any] = {}

    def err(self, m: str) -> None:
        self.errors.append(m)

    def warn(self, m: str) -> None:
        self.warnings.append(m)

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_contract(root: Path, r: Report, *, check_hashes: bool) -> None:
    site = root / "site" if (root / "site" / "data-manifest.json").is_file() else root
    man_path = site / "data-manifest.json"
    if not man_path.is_file():
        man_path = site / "data" / "data-manifest.json"
    if not man_path.is_file():
        r.err("data-manifest.json: not found")
        return
    man = load(man_path)
    base = man_path.parent
    if man.get("manifest_version") not in SUPPORTED["manifest"]:
        r.err(f"data-manifest.json: unsupported manifest_version {man.get('manifest_version')}")
    if not man.get("generated_at"):
        r.warn("data-manifest.json: missing generated_at")
    files = man.get("artifacts") or man.get("files") or {}
    schema = man.get("schema") or {}
    r.info["artifacts"] = sorted(files)

    parsed: dict[str, Any] = {}
    for kind, entry in files.items():
        rel = entry.get("path") if isinstance(entry, dict) else None
        p = safe_rel(base, rel or "")
        if p is None:
            r.err(f"{kind}: unsafe or missing path {rel!r}")
            continue
        if not p.is_file():
            (r.warn if entry.get("optional") else r.err)(
                f"{kind}: {'optional ' if entry.get('optional') else ''}artifact "
                f"{'absent' if entry.get('optional') else 'missing'} ({rel})"
            )
            continue
        raw = p.read_bytes()
        if entry.get("sha256"):
            got = sha256(p)
            if got != str(entry["sha256"]).lower():
                r.err(f"{kind}: sha256 mismatch (manifest {str(entry['sha256'])[:12]}… file {got[:12]}…)")
        if entry.get("bytes") is not None and p.stat().st_size != entry["bytes"]:
            r.err(f"{kind}: byte size mismatch (manifest {entry['bytes']} file {p.stat().st_size})")
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            r.err(f"{kind}: not valid JSON")
            continue
        parsed[kind] = data
        want = schema.get(kind)
        if isinstance(want, int) and data.get("schema_version") != want:
            r.err(f"{kind}: schema_version {data.get('schema_version')} != manifest.schema {want}")
        if kind in SUPPORTED and data.get("schema_version") not in SUPPORTED[kind]:
            r.err(f"{kind}: schema_version {data.get('schema_version')} unsupported by app")
        if not data.get("generated_at"):
            r.warn(f"{kind}: missing generated_at")

    cards = parsed.get("cards", {}).get("cards") if parsed.get("cards") else None
    by_id: dict[str, Any] = {}
    if isinstance(cards, list):
        for c in cards:
            cid = c.get("card_id")
            if cid in by_id:
                r.err(f"cards: duplicate card_id {cid}")
            by_id[cid] = c
        r.info["cards"] = len(by_id)
    elif "cards" in files:
        r.err("cards: no cards[] array")

    pm = parsed.get("prices", {})
    price_map = pm.get("prices") or pm.get("prices_by_liga_id")
    if isinstance(price_map, dict) and by_id:
        orphans = [k for k in price_map if k not in by_id]
        r.info["priced"] = len(price_map)
        if orphans:
            r.warn(f"prices: {len(orphans)} priced ids absent from cards.json")

    pt = parsed.get("cards_pt", {}).get("cards") if parsed.get("cards_pt") else None
    if isinstance(pt, dict) and by_id:
        miss = sum(1 for cid in pt if cid not in by_id)
        if miss:
            r.warn(f"cards_pt: {miss} overlay ids absent from cards.json (EN fallback)")

    ph = parsed.get("price_history")
    if ph:
        series = ph.get("series") or ph.get("history")
        if not isinstance(series, list):
            r.err("price_history: no series[]/history[]")
        else:
            bad = sum(
                1
                for s in series
                if not (isinstance(s, dict) and ISO_DATE.match(str(s.get("date", ""))) and (s.get("prices") or s.get("prices_by_liga_id")))
            )
            if bad:
                r.err(f"price_history: {bad} malformed snapshots")
            r.info["history_points"] = len(series)


def validate_card_art(root: Path, r: Report, *, check_hashes: bool) -> None:
    manifest = root / "lorcana-card-images" / "image_manifest.json"
    cards_path = root / "data" / "cards.json"
    if not cards_path.is_file():
        cards_path = root / "site" / "data" / "cards.json"
    if not manifest.is_file() or not cards_path.is_file():
        r.warn("card-art: image tree or manifest absent — skipped (run in the image repo)")
        return
    try:
        from validate_card_art import validate as art_validate  # type: ignore
    except Exception:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from validate_card_art import validate as art_validate  # type: ignore
    res = art_validate(root.resolve(), check_hashes=check_hashes)
    r.info["card_art"] = {
        "mapped": res.mapped_cards,
        "pipeline_missing": res.pipeline_missing,
        "local_ok": res.local_files_ok,
    }
    for w in res.warnings:
        r.warn(f"card-art: {w}")
    for e in res.errors:
        r.err(f"card-art: {e}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args(argv)
    root = args.root.resolve()
    r = Report()
    try:
        validate_contract(root, r, check_hashes=not args.quick)
        validate_card_art(root, r, check_hashes=not args.quick)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: validator could not read inputs: {e}", file=sys.stderr)
        return 2
    print("release summary:", json.dumps(r.info))
    for w in r.warnings:
        print(f"WARN: {w}")
    for e in r.errors:
        print(f"ERROR: {e}")
    print("PASS" if r.ok else f"FAIL ({len(r.errors)} error(s))")
    return 0 if r.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
