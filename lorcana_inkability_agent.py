#!/usr/bin/env python3
"""
Safely synchronize Disney Lorcana card inkability.

Source precedence
-----------------
1. An optional export from the official Disney/Ravensburger card catalog
   (JSON, HAR, or saved HTML).
2. Lorcast's documented API as a fallback.

The agent matches exact printings by set number + collector number. It never
turns a missing value into "uninkable", never uses fuzzy name-only matching,
and refuses to publish implausible set-wide results.

Examples
--------
Preview changes using Lorcast:
    python lorcana_inkability_agent.py cards.json --dry-run

Update cards.json and keep cards.json.bak:
    python lorcana_inkability_agent.py cards.json

Prefer an official catalog export, using Lorcast only for missing values:
    python lorcana_inkability_agent.py cards.json \
        --official-source disney-lorcana-catalog.har

Use an already downloaded Lorcast response without network access:
    python lorcana_inkability_agent.py cards.json \
        --lorcast-cache lorcast_cards.json --offline
"""

from __future__ import annotations

import argparse
import base64
import copy
import datetime as dt
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


AGENT_VERSION = "1.0.0"
LORCAST_API = "https://api.lorcast.com/v0"
USER_AGENT = "InkwellInkabilityAgent/1.0 (+https://github.com/luiscredie/inkwell)"

# Official exports have changed field names over time. Only explicit boolean-like
# values under these known aliases are accepted.
INKABLE_KEYS = (
    "inkable",
    "inkwell",
    "isInkable",
    "is_inkable",
    "canInk",
    "can_ink",
    "canBeInkwell",
    "can_be_inkwell",
    "inkConvertible",
    "ink_convertible",
)
SET_NUMBER_KEYS = ("setNumber", "set_number", "setNum", "set_num")
NUMBER_KEYS = (
    "collectorNumber",
    "collector_number",
    "cardNumber",
    "card_number",
    "number",
)
NAME_KEYS = ("fullName", "full_name", "displayName", "name_en", "name", "title")
VERSION_KEYS = ("subtitle", "version", "epithet")

# Regular constructed sets should contain a meaningful mix of both values.
# These guards are intentionally broad, but catch the observed 0/242 corruption.
MIN_STANDARD_SET_CARDS = 100
MIN_STANDARD_INKABLE_RATIO = 0.20
MAX_STANDARD_INKABLE_RATIO = 0.95
MIN_STANDARD_COVERAGE = 0.75


class AgentError(RuntimeError):
    """A controlled failure that must not modify the target database."""


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def name_key(value: Any) -> str:
    value = compact_text(value).translate(
        str.maketrans(
            {
                "‐": "-",  # U+2010 hyphen (used by Jack‐Jack in the database)
                "‑": "-",  # U+2011 non-breaking hyphen
                "‒": "-",
                "–": "-",
                "—": "-",
                "―": "-",
                "−": "-",
                "﹘": "-",
                "﹣": "-",
                "－": "-",
                "’": "'",
                "‘": "'",
            }
        )
    )
    value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode()
        .lower()
    )
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


VARIANT_SUFFIX = re.compile(
    r"\s*\((?:"
    r"alternate\s+art|enchanted|epic|iconic|foil|promo|"
    r"disney\s+lorcana\s+challenge|participation\s+card|top\s+\d+"
    r")\)\s*$",
    flags=re.I,
)


def gameplay_name_key(value: Any) -> str:
    """Normalize a gameplay card name while ignoring printing-only suffixes."""
    cleaned = compact_text(value)
    while VARIANT_SUFFIX.search(cleaned):
        cleaned = VARIANT_SUFFIX.sub("", cleaned).strip()
    return name_key(cleaned)


def collector_number(value: Any) -> str:
    value = compact_text(value).upper().replace(" ", "")
    # APIs sometimes serialize an integer collector number as "55.0".
    return value[:-2] if re.fullmatch(r"\d+\.0", value) else value


def parse_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "y", "1", "inkable", "inkwell"}:
            return True
        if normalized in {"false", "no", "n", "0", "uninkable", "not_inkable"}:
            return False
    return None


def first_present(row: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in row and row[key] is not None and row[key] != "":
            return row[key]
    return None


def full_name(row: dict[str, Any]) -> str:
    explicit = compact_text(first_present(row, NAME_KEYS))
    version = compact_text(first_present(row, VERSION_KEYS))
    if explicit and version and name_key(version) not in name_key(explicit):
        return f"{explicit} - {version}"
    return explicit or version


def nested_set(row: dict[str, Any]) -> dict[str, Any]:
    return row.get("set") if isinstance(row.get("set"), dict) else {}


def parse_set_number(value: Any) -> int | None:
    match = re.fullmatch(r"(?:LOR)?0*(\d+)", compact_text(value), flags=re.I)
    return int(match.group(1)) if match else None


def row_set_number(row: dict[str, Any]) -> int | None:
    set_obj = nested_set(row)
    candidates = [
        first_present(row, SET_NUMBER_KEYS),
        row.get("set_code"),
        row.get("setCode"),
        set_obj.get("code"),
        set_obj.get("number"),
    ]
    for value in candidates:
        parsed = parse_set_number(value)
        if parsed is not None:
            return parsed
    return None


def row_collector_number(row: dict[str, Any]) -> str:
    return collector_number(first_present(row, NUMBER_KEYS))


def extract_explicit_inkable(row: dict[str, Any]) -> bool | None:
    for key in INKABLE_KEYS:
        if key in row:
            parsed = parse_bool(row[key])
            if parsed is not None:
                return parsed
    return None


def iter_dicts(value: Any) -> Iterable[dict[str, Any]]:
    """Yield dictionaries recursively, without assuming a particular payload shell."""
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from iter_dicts(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from iter_dicts(nested)


def candidate_from_row(row: dict[str, Any], source: str) -> dict[str, Any] | None:
    set_number = row_set_number(row)
    number = row_collector_number(row)
    inkable = extract_explicit_inkable(row)
    if set_number is None or not number or inkable is None:
        return None
    return {
        "set_number": set_number,
        "number": number,
        "name": full_name(row),
        "name_key": name_key(full_name(row)),
        "inkable": inkable,
        "source": source,
    }


def decode_har_bodies(payload: dict[str, Any]) -> list[str]:
    bodies: list[str] = []
    for entry in payload.get("log", {}).get("entries", []):
        content = entry.get("response", {}).get("content", {})
        body = content.get("text")
        if not isinstance(body, str) or not body:
            continue
        if content.get("encoding") == "base64":
            try:
                body = base64.b64decode(body).decode("utf-8", errors="replace")
            except (ValueError, UnicodeError):
                continue
        bodies.append(body)
    return bodies


def parse_js_scalar(raw: str) -> Any:
    raw = raw.strip()
    if raw in {"true", "false", "null"}:
        return {"true": True, "false": False, "null": None}[raw]
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if raw.startswith('"') and raw.endswith('"'):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw[1:-1]
    return raw


def js_field(chunk: str, keys: Iterable[str]) -> Any:
    for key in keys:
        match = re.search(
            rf"(?:^|[,{{]]){re.escape(key)}:"
            r'("(?:\\.|[^"\\])*"|true|false|null|-?\d+)',
            chunk,
        )
        if match:
            return parse_js_scalar(match.group(1))
    return None


def parse_official_html(html: str) -> list[dict[str, Any]]:
    """
    Extract explicit inkability from the official catalog's embedded card objects.

    This parser deliberately refuses to infer inkability from cost, artwork,
    rarity, or absence of a field.
    """
    results: list[dict[str, Any]] = []
    starts = [m.start() for m in re.finditer(r"card_identifier:", html)]
    for index, start in enumerate(starts):
        lower = max(0, start - 5000)
        upper = starts[index + 1] if index + 1 < len(starts) else min(len(html), start + 25000)
        chunk = html[lower:upper]
        identifier = js_field(chunk, ("card_identifier",))
        if not isinstance(identifier, str):
            continue
        match = re.search(r"([^/]+)/([^ ]+)\s+[A-Z]{2}\s+(\d+)", identifier)
        if not match:
            continue
        numerator, denominator, set_number = match.groups()
        number = numerator if denominator.isdigit() else f"{numerator}-{denominator}"
        inkable = js_field(chunk, INKABLE_KEYS)
        inkable = parse_bool(inkable)
        if inkable is None:
            continue
        name = js_field(chunk, ("name", "title")) or ""
        subtitle = js_field(chunk, VERSION_KEYS) or ""
        results.append(
            {
                "set_number": int(set_number),
                "number": collector_number(number),
                "name": compact_text(f"{name} - {subtitle}".strip(" -")),
                "name_key": name_key(f"{name} - {subtitle}".strip(" -")),
                "inkable": inkable,
                "source": "official_disney_catalog",
            }
        )
    return results


def parse_official_source(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8-sig")
    suffix = path.suffix.lower()
    candidates: list[dict[str, Any]] = []

    if suffix in {".json", ".har"}:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AgentError(f"Invalid official JSON/HAR: {exc}") from exc

        for row in iter_dicts(payload):
            candidate = candidate_from_row(row, "official_disney_catalog")
            if candidate:
                candidates.append(candidate)

        if isinstance(payload, dict) and "log" in payload:
            for body in decode_har_bodies(payload):
                try:
                    nested_payload = json.loads(body)
                except json.JSONDecodeError:
                    candidates.extend(parse_official_html(body))
                else:
                    for row in iter_dicts(nested_payload):
                        candidate = candidate_from_row(
                            row, "official_disney_catalog"
                        )
                        if candidate:
                            candidates.append(candidate)
    else:
        candidates.extend(parse_official_html(raw))

    return deduplicate_source(candidates, "official source")


def deduplicate_source(
    candidates: Iterable[dict[str, Any]], label: str
) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for card in candidates:
        grouped[(card["set_number"], card["number"])].append(card)

    output: list[dict[str, Any]] = []
    conflicts: list[str] = []
    for key, rows in grouped.items():
        values = {row["inkable"] for row in rows}
        if len(values) > 1:
            conflicts.append(f"{key[0]}/{key[1]}")
            continue
        output.append(max(rows, key=lambda row: bool(row.get("name"))))

    if conflicts:
        sample = ", ".join(conflicts[:10])
        raise AgentError(
            f"{label} contains conflicting inkability for {len(conflicts)} "
            f"printing(s), including {sample}."
        )
    return output


def http_json(url: str, retries: int = 3) -> Any:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
    raise AgentError(f"Could not download {url}: {last_error}")


def load_lorcast_cache(path: Path) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AgentError(f"Could not read Lorcast cache {path}: {exc}") from exc
    candidates = [
        candidate
        for row in iter_dicts(payload)
        if (candidate := candidate_from_row(row, "lorcast"))
    ]
    return deduplicate_source(candidates, "Lorcast cache")


def fetch_lorcast_sets(set_numbers: Iterable[int]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for set_number in sorted(set(set_numbers)):
        query = urllib.parse.urlencode(
            {"q": f"set:{set_number}", "unique": "prints"}
        )
        payload = http_json(f"{LORCAST_API}/cards/search?{query}")
        rows = payload.get("results", []) if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            raise AgentError(f"Unexpected Lorcast response for set {set_number}.")
        for row in rows:
            if not isinstance(row, dict):
                continue
            candidate = candidate_from_row(row, "lorcast")
            if candidate:
                candidates.append(candidate)
        time.sleep(0.10)
    return deduplicate_source(candidates, "Lorcast API")


def database_cards(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("cards"), list):
        return [row for row in payload["cards"] if isinstance(row, dict)]
    raise AgentError("Input must be a card array or an object containing a cards array.")


def database_identity(card: dict[str, Any]) -> tuple[int, str] | None:
    set_number = row_set_number(card)
    number = row_collector_number(card)
    if set_number is None or not number:
        card_id = compact_text(card.get("card_id"))
        match = re.fullmatch(r"LOR0*(\d+)-(.+)", card_id, flags=re.I)
        if match:
            set_number = int(match.group(1))
            number = collector_number(match.group(2))
    if set_number is None or not number:
        return None
    return set_number, number


def source_index(cards: Iterable[dict[str, Any]]) -> dict[tuple[int, str], dict[str, Any]]:
    return {(row["set_number"], row["number"]): row for row in cards}


def source_name_consensus(
    cards: Iterable[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """
    Return only gameplay names whose exact source printings unanimously agree.

    This safely covers promo/alternate-art records whose local identifiers do
    not map to a numbered LOR set. A disagreement disables inheritance for that
    name instead of guessing.
    """
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in cards:
        key = gameplay_name_key(row.get("name"))
        if key:
            grouped[key].append(row)

    consensus: dict[str, dict[str, Any]] = {}
    for key, rows in grouped.items():
        values = {bool(row["inkable"]) for row in rows}
        if len(values) != 1:
            continue
        preferred = max(
            rows,
            key=lambda row: (
                row.get("source") == "official_disney_catalog",
                bool(row.get("name")),
            ),
        )
        consensus[key] = {
            **preferred,
            "source": f"{preferred['source']}:same_gameplay_card",
        }
    return consensus


def merge_sources(
    official: Iterable[dict[str, Any]],
    fallback: Iterable[dict[str, Any]],
) -> dict[tuple[int, str], dict[str, Any]]:
    # Official rows overwrite fallback rows for the same exact printing.
    merged = source_index(fallback)
    merged.update(source_index(official))
    return merged


def name_compatible(database_name: str, source_name: str) -> bool:
    if not source_name:
        return True
    left, right = gameplay_name_key(database_name), gameplay_name_key(source_name)
    if not left or not right:
        return True
    # Exact printing identity remains primary, but this catches mismatched set
    # numbering and malformed collector numbers before changing data.
    return left == right or left in right or right in left


def build_plan(
    cards: list[dict[str, Any]],
    sources: dict[tuple[int, str], dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    plan: list[dict[str, Any]] = []
    unmatched: list[str] = []
    mismatched_names: list[str] = []
    source_counts: Counter[str] = Counter()
    eligible_by_set: Counter[int] = Counter()
    matched_by_set: Counter[int] = Counter()
    by_gameplay_name = source_name_consensus(sources.values())

    for card in cards:
        identity = database_identity(card)
        if identity is not None:
            set_number, _ = identity
            eligible_by_set[set_number] += 1

        source = sources.get(identity) if identity is not None else None
        direct_match = source is not None
        if source is not None and not name_compatible(
            full_name(card), source.get("name", "")
        ):
            source = None

        # Promo, Epic, Enchanted and other alternate printings may not have a
        # directly queryable numbered-set identity. Inherit only from unanimous
        # exact-name source data.
        if source is None:
            source = by_gameplay_name.get(gameplay_name_key(full_name(card)))
            direct_match = False

        if source is None:
            if identity is not None:
                unmatched.append(
                    compact_text(card.get("card_id"))
                    or f"{identity[0]}/{identity[1]}"
                )
            continue

        if not name_compatible(full_name(card), source.get("name", "")):
            mismatched_names.append(
                f"{compact_text(card.get('card_id'))}: "
                f"{full_name(card)!r} != {source.get('name')!r}"
            )
            continue
        if identity is not None and direct_match:
            matched_by_set[identity[0]] += 1
        source_counts[source["source"]] += 1
        old_raw = card.get("inkable")
        old = parse_bool(old_raw)
        new = bool(source["inkable"])
        if old is new and old_raw in (0, 1, False, True):
            continue
        plan.append(
            {
                "card": card,
                "card_id": compact_text(card.get("card_id"))
                or (
                    f"LOR{identity[0]}-{identity[1]}"
                    if identity is not None
                    else full_name(card)
                ),
                "name": full_name(card),
                "set_number": identity[0] if identity is not None else None,
                "number": (
                    identity[1]
                    if identity is not None
                    else row_collector_number(card)
                ),
                "old": old_raw,
                "new": int(new),
                "source": source["source"],
            }
        )

    report = {
        "eligible": sum(eligible_by_set.values()),
        "matched": sum(matched_by_set.values()),
        "unmatched": unmatched,
        "name_mismatches": mismatched_names,
        "source_counts": dict(source_counts),
        "eligible_by_set": dict(eligible_by_set),
        "matched_by_set": dict(matched_by_set),
    }
    return plan, report


def validate_before_apply(
    cards: list[dict[str, Any]],
    plan: list[dict[str, Any]],
    report: dict[str, Any],
    allow_partial: bool,
) -> None:
    if not plan and report["matched"] == 0:
        raise AgentError("No exact card printings were matched; refusing to write.")

    for set_number, eligible in report["eligible_by_set"].items():
        if eligible < MIN_STANDARD_SET_CARDS:
            continue
        matched = report["matched_by_set"].get(set_number, 0)
        coverage = matched / eligible
        if coverage < MIN_STANDARD_COVERAGE and not allow_partial:
            raise AgentError(
                f"Set LOR{set_number} source coverage is only {coverage:.1%} "
                f"({matched}/{eligible}); refusing a partial update. "
                "Use --allow-partial only after reviewing the report."
            )

    simulated = {id(item["card"]): item["new"] for item in plan}
    by_set: dict[int, list[bool]] = defaultdict(list)
    for card in cards:
        identity = database_identity(card)
        if identity is None:
            continue
        value = simulated.get(id(card), parse_bool(card.get("inkable")))
        if value is not None:
            by_set[identity[0]].append(bool(value))

    for set_number, values in by_set.items():
        if len(values) < MIN_STANDARD_SET_CARDS:
            continue
        ratio = sum(values) / len(values)
        if not (MIN_STANDARD_INKABLE_RATIO <= ratio <= MAX_STANDARD_INKABLE_RATIO):
            raise AgentError(
                f"Set LOR{set_number} would contain {ratio:.1%} inkable cards "
                f"({sum(values)}/{len(values)}). This is implausible; no file was changed."
            )


def apply_plan(plan: Iterable[dict[str, Any]]) -> None:
    for item in plan:
        item["card"]["inkable"] = item["new"]


def atomic_json_write(path: Path, payload: Any, backup: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if backup and path.exists():
        backup_path = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup_path)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def save_cache(path: Path, candidates: list[dict[str, Any]]) -> None:
    serializable = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": LORCAST_API,
        "cards": candidates,
    }
    atomic_json_write(path, serializable, backup=False)


def write_report(
    path: Path,
    plan: list[dict[str, Any]],
    report: dict[str, Any],
    dry_run: bool,
) -> None:
    changes = [
        {key: item[key] for key in ("card_id", "name", "old", "new", "source")}
        for item in plan
    ]
    output = {
        "agent_version": AGENT_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "dry_run": dry_run,
        "summary": {
            "eligible": report["eligible"],
            "matched": report["matched"],
            "changed": len(plan),
            "unmatched": len(report["unmatched"]),
            "name_mismatches": len(report["name_mismatches"]),
            "source_counts": report["source_counts"],
        },
        "changes": changes,
        "unmatched": report["unmatched"],
        "name_mismatches": report["name_mismatches"],
    }
    atomic_json_write(path, output, backup=False)


def update_sync_metadata(
    payload: Any,
    plan: list[dict[str, Any]],
    report: dict[str, Any],
) -> None:
    if not isinstance(payload, dict):
        return
    sync = payload.setdefault("official_data_sync", {})
    sync["inkable"] = {
        "primary_source": "Disney/Ravensburger official card catalog export",
        "fallback_source": LORCAST_API,
        "synced_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "agent_version": AGENT_VERSION,
        "matched": report["matched"],
        "corrected": len(plan),
        "unmatched_count": len(report["unmatched"]),
        "name_mismatch_count": len(report["name_mismatches"]),
        "source_counts": report["source_counts"],
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Safely synchronize Lorcana inkability by exact printing."
    )
    parser.add_argument("cards_json", type=Path, help="cards.json to inspect/update")
    parser.add_argument(
        "--official-source",
        type=Path,
        help="Official Disney catalog JSON, HAR, or saved HTML",
    )
    parser.add_argument(
        "--lorcast-cache",
        type=Path,
        help="Read/write a local Lorcast cache file",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Do not call Lorcast; requires usable official data or --lorcast-cache",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Generate report without changing cards.json"
    )
    parser.add_argument(
        "--report",
        type=Path,
        help="Report path (default: <cards>.inkability-report.json)",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Allow source coverage below 75%%; distribution guards remain active",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not create <cards>.bak before a successful write",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        payload = json.loads(args.cards_json.read_text(encoding="utf-8-sig"))
        cards = database_cards(payload)
        working = copy.deepcopy(payload)
        working_cards = database_cards(working)

        official: list[dict[str, Any]] = []
        if args.official_source:
            official = parse_official_source(args.official_source)
            if not official:
                print(
                    "Warning: official export contained no explicit inkability fields; "
                    "it will not be treated as evidence.",
                    file=sys.stderr,
                )

        set_numbers = {
            identity[0]
            for card in cards
            if (identity := database_identity(card)) is not None
        }
        fallback: list[dict[str, Any]] = []
        if args.lorcast_cache and args.lorcast_cache.exists():
            fallback = load_lorcast_cache(args.lorcast_cache)
        if not args.offline:
            downloaded = fetch_lorcast_sets(set_numbers)
            fallback = downloaded
            if args.lorcast_cache:
                save_cache(args.lorcast_cache, downloaded)

        if not official and not fallback:
            raise AgentError(
                "No usable source data. Supply an official export, allow Lorcast "
                "network access, or provide --lorcast-cache."
            )

        sources = merge_sources(official, fallback)
        plan, report = build_plan(working_cards, sources)
        validate_before_apply(working_cards, plan, report, args.allow_partial)
        apply_plan(plan)
        update_sync_metadata(working, plan, report)

        report_path = args.report or args.cards_json.with_suffix(
            args.cards_json.suffix + ".inkability-report.json"
        )
        write_report(report_path, plan, report, args.dry_run)

        if not args.dry_run:
            atomic_json_write(args.cards_json, working, backup=not args.no_backup)

        print(
            f"Matched {report['matched']}/{report['eligible']} standard-set printings; "
            f"{len(plan)} inkability value(s) would change."
            if args.dry_run
            else f"Matched {report['matched']}/{report['eligible']} standard-set "
            f"printings; updated {len(plan)} inkability value(s)."
        )
        print(f"Report: {report_path}")
        if not args.dry_run and not args.no_backup:
            print(f"Backup: {args.cards_json.with_suffix(args.cards_json.suffix + '.bak')}")
        return 0
    except (AgentError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
