#!/usr/bin/env python3
"""LigaLorcana full-catalog marketplace price collector.

Modes:
  * Discover every card printing linked by LigaLorcana and write cards.json.
  * Collect Normal/Foil low, average and high prices for every catalog item.
  * Build Inkwell's v2 prices and dated history from an existing v2, v4 or v8 file.
  * Resume only records not yet checked today with --resume-today.
  * Rebuild derived artifacts without scraping with --finalize-cache.

The collector uses public pages only and does not bypass CAPTCHAs or access controls.
Raw progress is checkpointed independently from derived analytics and manifest
files so a Windows/OneDrive lock cannot erase completed collection work.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import random
import stat
import time
import sys
import unicodedata
from html import unescape
from difflib import SequenceMatcher
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from zoneinfo import ZoneInfo

BASE_URL = "https://www.ligalorcana.com.br/"
LOCAL_TIMEZONE = ZoneInfo("America/Sao_Paulo")
DISCOVERY_SEEDS = (
    f"{BASE_URL}?card=tipo%3DCard&view=cards%2Fsearch",
    f"{BASE_URL}?view=cards%2Fedicoes",
)
BRL_RE = re.compile(
    r"R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})|[0-9]+(?:,[0-9]{1,2})?)",
    re.I,
)
MARKETPLACE_HEADING_RE = re.compile(r"Preço\s+Médio\s+de\s+Venda\s+no\s+Marketplace", re.I)
RARITY_RE = re.compile(r"Raridade\s+(.+?)(?=(?:Preço\s+Médio|Lista\s+de\s+Compras|$))", re.I)
CARD_SUFFIX_RE = re.compile(r"\s*\([^()]+\)\s*$")
ALT_ART_SUFFIX_RE = re.compile(r"\s*\((?:alternate art|enchanted|promo|foil)\)\s*$", re.I)
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def detect_project_root(explicit: Path | None = None) -> Path:
    """Find the Inkwell root whose deployable files live under site/."""
    if explicit is not None:
        return explicit.expanduser().resolve()

    starts = (Path.cwd().resolve(), Path(__file__).resolve().parent)
    visited: set[Path] = set()
    for start in starts:
        for candidate in (start, *start.parents):
            if candidate in visited:
                continue
            visited.add(candidate)
            if (candidate / "site").is_dir() and (candidate / "tools").is_dir():
                return candidate
    return Path.cwd().resolve()


def resolve_cli_path(value: Path | None, default: Path) -> Path:
    """Resolve an explicit CLI path from cwd, or use a repository default."""
    return (value.expanduser() if value is not None else default).resolve()


def first_existing(*candidates: Path) -> Path:
    """Use the first existing compatibility input, else the new-layout path."""
    return next((path for path in candidates if path.exists()), candidates[0])


def load_scraper_dependencies() -> None:
    """Load browser-only packages after history-only mode has been handled."""
    global BeautifulSoup, Tag, BrowserContext, Page, async_playwright
    from bs4 import BeautifulSoup, Tag
    from playwright.async_api import BrowserContext, Page, async_playwright


@dataclass
class PriceBand:
    low: float
    average: float
    high: float


@dataclass
class CardResult:
    id: str
    name: str
    edition: str
    number: str
    url: str
    canonical_id: str | None
    card_db_key: str | None
    match_status: str
    match_method: str | None
    match_note: str | None
    printing_type: str
    printing_label: str
    rarity: str | None
    normal: PriceBand | None
    foil: PriceBand | None
    minimum_price_brl: float | None
    status: str
    checked_at: str
    extraction_method: str | None = None
    error: str | None = None
    database_id: str | None = None
    catalog_name: str | None = None
    catalog_match_status: str | None = None
    catalog_match_note: str | None = None


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_number(value: Any) -> str:
    return normalize_space(str(value))



def normalize_name(value: str) -> str:
    value = ALT_ART_SUFFIX_RE.sub("", normalize_space(value)).casefold()
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.replace("’", "'").replace("–", "-").replace("—", "-").replace("&", " and ")
    return NON_ALNUM_RE.sub(" ", value).strip()


def load_card_db(path: Path) -> dict[str, dict[str, Any]]:
    text = path.read_text(encoding="utf-8-sig").strip()
    prefix = "window.LORCANA_CARD_DB="
    if text.startswith(prefix):
        text = text[len(prefix):]
    if text.endswith(";"):
        text = text[:-1]
    data = json.loads(text)
    if not isinstance(data, dict) or not data:
        raise ValueError(f"{path} must contain window.LORCANA_CARD_DB with a non-empty object")
    return data


def load_master_catalog(path: Path) -> dict[str, dict[str, Any]]:
    """Load the shared, printing-level catalogue keyed by Database ID."""
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        master: dict[str, dict[str, Any]] = {}
        for card in data["cards"]:
            if not isinstance(card, dict):
                continue
            database_id = normalize_space(str(card.get("card_id", ""))).upper()
            if not database_id:
                continue
            master[database_id] = {
                **card,
                "ligaId": database_id,
                "displayName": card.get("name_en") or database_id,
                "editionCode": (
                    card.get("set_code") or database_id.rsplit("-", 1)[0]
                ),
                "cardNumber": (
                    card.get("card_number") or database_id.rsplit("-", 1)[-1]
                ),
            }
        if not master:
            raise ValueError(f"{path} contains no cards with card_id")
        return master
    if not isinstance(data, dict) or not data:
        raise ValueError(f"{path} must contain a non-empty card catalogue object")
    return {
        str(database_id): card
        for database_id, card in data.items()
        if isinstance(card, dict)
    }


def master_names(card: dict[str, Any]) -> list[str]:
    values = [
        unescape(str(card.get("ligaNameRaw", ""))),
        unescape(str(card.get("displayName", ""))),
    ]
    return [normalize_space(value) for value in values if normalize_space(value)]


def apply_master_catalog_mapping(
    cards: list[dict[str, Any]],
    master_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Attach an exact Database ID without collapsing cards that share a name.

    LigaLorcana's edition+number identifier is the primary lookup. If the master
    contains more than one row for that identifier, the name selects the row.
    """
    master = load_master_catalog(master_path)
    by_liga_id: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for database_id, item in master.items():
        liga_id = normalize_space(str(item.get("ligaId", ""))).upper()
        if liga_id:
            by_liga_id.setdefault(liga_id, []).append((database_id, item))

    enriched_cards: list[dict[str, Any]] = []
    summary: dict[str, int] = {}
    rows: list[dict[str, Any]] = []

    for source in cards:
        card = dict(source)
        liga_id = normalize_space(str(card.get("id", ""))).upper()
        source_name = normalize_space(str(card.get("name", "")))
        normalized_source = normalize_name(source_name)
        candidates = by_liga_id.get(liga_id, [])
        ranked: list[tuple[float, str, dict[str, Any], str]] = []
        for database_id, item in candidates:
            names = master_names(item)
            best_name = max(names, key=lambda name: name_similarity(source_name, name), default="")
            score = name_similarity(source_name, best_name) if best_name else 0.0
            ranked.append((score, database_id, item, best_name))
        ranked.sort(key=lambda row: (-row[0], row[1]))

        exact = [
            row for row in ranked
            if any(normalize_name(name) == normalized_source for name in master_names(row[2]))
        ]
        chosen: tuple[float, str, dict[str, Any], str] | None = None
        if len(exact) == 1:
            chosen = exact[0]
            status = "matched"
            note = None
        elif len(exact) > 1:
            chosen = sorted(exact, key=lambda row: row[1])[0]
            status = "ambiguous_database_id"
            note = f"{len(exact)} master rows share this ligaId and normalized name"
        elif len(ranked) == 1 and ranked[0][0] >= 0.82:
            chosen = ranked[0]
            status = "matched_name_variant"
            note = f"Name variation ({ranked[0][0]:.0%} similarity)"
        elif ranked:
            chosen = ranked[0]
            status = "name_mismatch"
            note = (
                f"Liga name {source_name!r} differs from master "
                f"{ranked[0][3]!r} ({ranked[0][0]:.0%} similarity)"
            )
        else:
            status = "not_in_master"
            note = "ligaId is absent from card-catalog-master.json"

        if chosen:
            _, database_id, master_card, expected_name = chosen
            card.update({
                "database_id": database_id,
                "catalog_name": expected_name,
                "catalog_match_status": status,
                "catalog_match_note": note,
            })
        else:
            card.update({
                "database_id": None,
                "catalog_name": None,
                "catalog_match_status": status,
                "catalog_match_note": note,
            })

        summary[status] = summary.get(status, 0) + 1
        enriched_cards.append(card)
        rows.append({
            "liga_id": liga_id,
            "database_id": card.get("database_id"),
            "liga_name": source_name,
            "catalog_name": card.get("catalog_name"),
            "status": status,
            "note": note,
        })

    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "catalog_rows": len(master),
        "liga_cards": len(cards),
        "summary": summary,
        "cards": rows,
    }
    return enriched_cards, report


def supplement_cards_from_master(
    cards: list[dict[str, Any]],
    master_path: Path,
) -> tuple[list[dict[str, Any]], int]:
    """Add unique master ligaIds missing from a stale discovery cache."""
    master = load_master_catalog(master_path)
    existing = {normalize_space(str(card.get("id", ""))).upper() for card in cards}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in master.values():
        liga_id = normalize_space(str(item.get("ligaId", ""))).upper()
        if liga_id:
            grouped.setdefault(liga_id, []).append(item)

    output = [dict(card) for card in cards]
    added = 0
    for liga_id, candidates in grouped.items():
        if liga_id in existing:
            continue
        if len(candidates) != 1:
            logging.warning(
                "Cannot supplement ambiguous master ligaId %s (%s rows)",
                liga_id, len(candidates),
            )
            continue
        item = candidates[0]
        name = unescape(str(item.get("ligaNameRaw") or item.get("displayName") or liga_id))
        edition = normalize_space(str(item.get("editionCode", "")))
        number = normalize_number(item.get("cardNumber", ""))
        if not edition or not number:
            logging.warning("Cannot supplement incomplete master row %s", liga_id)
            continue
        output.append({
            "id": liga_id,
            "name": name,
            "edition": edition,
            "number": number,
            "url": card_url({
                "name": name,
                "edition": edition,
                "number": number,
            }),
        })
        existing.add(liga_id)
        added += 1

    output.sort(
        key=lambda card: (
            str(card["edition"]).casefold(),
            natural_number_key(str(card["number"])),
            str(card["name"]).casefold(),
        )
    )
    return output, added


def edition_set_number(edition: str) -> int | None:
    match = re.fullmatch(r"(?:LOR)?0*(\d+)", normalize_space(edition), re.I)
    return int(match.group(1)) if match else None


def canonical_id_for(card: dict[str, Any], fallback_edition: str = "") -> str | None:
    number = card.get("num")
    set_num = card.get("setNum")
    if isinstance(set_num, int) and number is not None and str(number).isdigit():
        return f"{set_num:03d}-{str(number).zfill(3)}"
    set_code = normalize_space(str(card.get("set", fallback_edition)))
    if set_code and number is not None:
        return f"{set_code}-{normalize_number(number)}"
    return None


def detect_printing_type(name: str, edition: str, exact_set_match: bool = False) -> tuple[str, str]:
    raw = normalize_space(name)
    folded = raw.casefold()
    ed = normalize_space(edition).upper()
    if "alternate art" in folded:
        return "alternate_art", "Alternate Art"
    if "enchanted" in folded:
        return "enchanted", "Enchanted"
    if ed.startswith("Q") and ed[1:].isdigit():
        return "challenge", f"Challenge Deck {ed[1:]}"
    if ed.startswith(("D23", "D100")):
        return "promo", ed
    if "promo" in folded or ed.startswith(("P", "CP", "PR", "LEAGUE")):
        return "promo", "Promo"
    if edition_set_number(ed) is None and not exact_set_match:
        return "special", ed or "Special printing"
    return "regular", "Regular"


def build_card_db_indexes(card_db: dict[str, dict[str, Any]]) -> dict[str, Any]:
    by_set_num: dict[tuple[int, str], list[tuple[str, dict[str, Any]]]] = {}
    by_code_num: dict[tuple[str, str], list[tuple[str, dict[str, Any]]]] = {}
    by_name: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for key, card in card_db.items():
        if not isinstance(card, dict):
            continue
        number = card.get("num")
        if number is not None:
            number_s = normalize_number(number)
            set_num = card.get("setNum")
            if isinstance(set_num, int):
                by_set_num.setdefault((set_num, number_s), []).append((key, card))
            set_code = normalize_space(str(card.get("set", ""))).casefold()
            if set_code:
                by_code_num.setdefault((set_code, number_s), []).append((key, card))
        name = normalize_name(str(card.get("n", key)))
        if name:
            by_name.setdefault(name, []).append((key, card))
    return {"by_set_num": by_set_num, "by_code_num": by_code_num, "by_name": by_name}


def name_similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, normalize_name(left), normalize_name(right)).ratio()


def mapped_result(key: str, db_card: dict[str, Any], status: str, method: str, note: str | None,
                  printing_type: str, printing_label: str, edition: str) -> dict[str, Any]:
    return {
        "canonical_id": canonical_id_for(db_card, edition),
        "card_db_key": key,
        "match_status": status,
        "match_method": method,
        "match_note": note,
        "printing_type": printing_type,
        "printing_label": printing_label,
    }


def map_catalog_card(card: dict[str, Any], indexes: dict[str, Any]) -> dict[str, Any]:
    edition = normalize_space(str(card["edition"]))
    number = normalize_number(card["number"])
    raw_name = str(card["name"])
    liga_name = normalize_name(raw_name)
    candidates: list[tuple[str, dict[str, Any]]] = []
    method: str | None = None

    set_num = edition_set_number(edition)
    if set_num is not None:
        candidates = indexes["by_set_num"].get((set_num, number), [])
        method = "setNum+num"
    if not candidates:
        candidates = indexes["by_code_num"].get((edition.casefold(), number), [])
        method = "setCode+num" if candidates else None

    printing_type, printing_label = detect_printing_type(raw_name, edition, exact_set_match=bool(candidates))

    if len(candidates) == 1:
        key, db_card = candidates[0]
        db_name = str(db_card.get("n", key))
        similarity = name_similarity(raw_name, db_name)
        if normalize_name(db_name) == liga_name:
            status, note = "matched", None
        elif similarity >= 0.82:
            status, note = "matched_name_variant", f"Name variation ({similarity:.0%} similarity): {db_name}"
        else:
            status, note = "matched_name_mismatch", f"Review name mismatch ({similarity:.0%} similarity): {db_name}"
        return mapped_result(key, db_card, status, method or "set+number", note,
                             printing_type, printing_label, edition)

    if len(candidates) > 1:
        exact = [(key, item) for key, item in candidates if normalize_name(str(item.get("n", key))) == liga_name]
        if len(exact) == 1:
            key, db_card = exact[0]
            return mapped_result(key, db_card, "matched", f"{method}+name", None,
                                 printing_type, printing_label, edition)
        ranked = sorted(
            ((name_similarity(raw_name, str(item.get("n", key))), key, item) for key, item in candidates),
            reverse=True,
        )
        if ranked and ranked[0][0] >= 0.90 and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= 0.08):
            score, key, db_card = ranked[0]
            return mapped_result(key, db_card, "matched_name_variant", f"{method}+fuzzy-name",
                                 f"Resolved among {len(candidates)} candidates ({score:.0%} similarity)",
                                 printing_type, printing_label, edition)
        return {
            "canonical_id": None, "card_db_key": None, "match_status": "ambiguous",
            "match_method": method, "match_note": f"{len(candidates)} card-db candidates",
            "printing_type": printing_type, "printing_label": printing_label,
        }

    name_candidates = indexes["by_name"].get(liga_name, [])
    if len(name_candidates) == 1:
        key, db_card = name_candidates[0]
        if printing_type == "regular":
            printing_type, printing_label = "reprint", f"Unmatched edition {edition}"
        status = printing_type if printing_type in {"alternate_art", "enchanted", "promo", "challenge", "special"} else "special_printing"
        return mapped_result(
            key, db_card, status, "normalized-name",
            "Mapped to base card by unique normalized name; printing retained separately",
            printing_type, printing_label, edition,
        )
    if len(name_candidates) > 1:
        # Prefer a unique candidate whose set number agrees with a numeric Liga edition.
        agreeing = [(key, item) for key, item in name_candidates if set_num is not None and item.get("setNum") == set_num]
        if len(agreeing) == 1:
            key, db_card = agreeing[0]
            return mapped_result(key, db_card, "matched_name_variant", "name+setNum", None,
                                 printing_type, printing_label, edition)
        return {
            "canonical_id": None, "card_db_key": None, "match_status": "ambiguous",
            "match_method": "normalized-name", "match_note": f"{len(name_candidates)} name matches",
            "printing_type": printing_type, "printing_label": printing_label,
        }
    return {
        "canonical_id": None, "card_db_key": None, "match_status": "unmatched",
        "match_method": None, "match_note": None,
        "printing_type": printing_type, "printing_label": printing_label,
    }


def apply_card_db_mapping(cards: list[dict[str, Any]], card_db_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    card_db = load_card_db(card_db_path)
    indexes = build_card_db_indexes(card_db)
    mapped: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    printing_counts: dict[str, int] = {}
    for card in cards:
        enriched = dict(card)
        enriched.update(map_catalog_card(card, indexes))
        mapped.append(enriched)
        status = enriched["match_status"]
        counts[status] = counts.get(status, 0) + 1
        ptype = enriched["printing_type"]
        printing_counts[ptype] = printing_counts.get(ptype, 0) + 1
    report = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "liga_catalog_total": len(cards),
        "card_db_entries": len(card_db),
        "summary": counts,
        "printing_summary": printing_counts,
        "cards": [
            {k: card.get(k) for k in (
                "id", "name", "edition", "number", "canonical_id", "card_db_key",
                "match_status", "match_method", "match_note", "printing_type", "printing_label"
            )}
            for card in mapped
        ],
    }
    return mapped, report


def apply_master_only_mapping(
    cards: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Build compatibility fields from the current printing-level card IDs."""
    mapped: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    printing_counts: dict[str, int] = {}
    for source in cards:
        card = dict(source)
        database_id = normalize_space(str(card.get("database_id", ""))).upper()
        catalog_status = str(card.get("catalog_match_status") or "not_in_master")
        exact_match = bool(database_id) and catalog_status in {
            "matched", "matched_name_variant",
        }
        printing_type, printing_label = detect_printing_type(
            str(card.get("name", "")),
            str(card.get("edition", "")),
            exact_set_match=exact_match,
        )
        match_status = (
            "matched"
            if exact_match
            else "matched_name_mismatch"
            if database_id
            else "unmatched"
        )
        card.update({
            "canonical_id": database_id or None,
            "card_db_key": database_id or None,
            "match_status": match_status,
            "match_method": "current-cards.card_id" if database_id else None,
            "match_note": card.get("catalog_match_note"),
            "printing_type": printing_type,
            "printing_label": printing_label,
        })
        mapped.append(card)
        counts[match_status] = counts.get(match_status, 0) + 1
        printing_counts[printing_type] = printing_counts.get(printing_type, 0) + 1
    return mapped, {
        "schema_version": 3,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "current-cards.card_id",
        "summary": counts,
        "printing_summary": printing_counts,
        "cards": [],
    }


def natural_number_key(value: str) -> tuple[Any, ...]:
    return tuple(int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value))


def brl_to_decimal(raw: str) -> Decimal:
    cleaned = raw.strip().replace(".", "").replace(",", ".")
    try:
        return Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid BRL value: {raw!r}") from exc


def prices_in_text(text: str) -> list[Decimal]:
    return [brl_to_decimal(match.group(1)) for match in BRL_RE.finditer(text)]


def to_band(values: Iterable[Decimal]) -> PriceBand:
    numbers = list(values)
    if len(numbers) != 3:
        raise ValueError(f"Expected exactly three marketplace values, got {len(numbers)}")
    return PriceBand(low=float(numbers[0]), average=float(numbers[1]), high=float(numbers[2]))


def card_url(card: dict[str, Any]) -> str:
    number = normalize_number(card["number"])
    if card.get("url"):
        return str(card["url"])
    query = urlencode(
        {
            "card": f"{card['name']}({number})",
            "ed": card["edition"],
            "num": number,
            "view": "cards/card",
        }
    )
    return f"{BASE_URL}?{query}"


def parse_card_link(href: str, anchor_text: str = "") -> dict[str, str] | None:
    absolute = urljoin(BASE_URL, href)
    parsed = urlparse(absolute)
    if parsed.netloc.casefold() not in {"ligalorcana.com.br", "www.ligalorcana.com.br"}:
        return None
    query = parse_qs(parsed.query)
    view = query.get("view", [""])[0].replace("%2F", "/")
    if view != "cards/card":
        return None
    edition = normalize_space(query.get("ed", [""])[0])
    number = normalize_number(query.get("num", [""])[0])
    if not edition or not number:
        return None
    raw_name = normalize_space(query.get("card", [""])[0])
    name = CARD_SUFFIX_RE.sub("", raw_name).strip() or normalize_space(anchor_text)
    if not name:
        name = f"{edition} #{number}"
    canonical = card_url({"name": name, "edition": edition, "number": number})
    return {
        "id": f"{edition}-{number}",
        "name": name,
        "edition": edition,
        "number": number,
        "url": canonical,
    }


def is_discovery_page(href: str) -> bool:
    absolute = urljoin(BASE_URL, href)
    parsed = urlparse(absolute)
    if parsed.netloc.casefold() not in {"ligalorcana.com.br", "www.ligalorcana.com.br"}:
        return False
    query = parse_qs(parsed.query)
    view = query.get("view", [""])[0].replace("%2F", "/")
    return view in {"cards/search", "cards/edicoes", "cards/edicao", "cards/lista"}


def find_row_values(soup: BeautifulSoup, label: str) -> list[Decimal] | None:
    """Find one marketplace row without leaking values from the sibling row.

    The old parser could climb to a shared parent containing both Normal and Foil.
    When only one treatment had prices, that same set of three values was then
    assigned to both treatments. This version rejects containers containing the
    opposite treatment label.
    """
    label_re = re.compile(rf"^\s*{re.escape(label)}\s*$", re.I)
    opposite = "Foil" if label.casefold() == "normal" else "Normal"
    candidates: list[tuple[int, int, list[Decimal]]] = []

    for node in soup.find_all(string=label_re):
        element = node.parent
        depth = 0
        while isinstance(element, Tag) and depth <= 7:
            text = normalize_space(element.get_text(" ", strip=True))
            values = prices_in_text(text)
            has_label = re.search(rf"\b{re.escape(label)}\b", text, re.I)
            has_opposite = re.search(rf"\b{re.escape(opposite)}\b", text, re.I)

            # A valid row must contain this treatment, exactly three BRL values,
            # and must not include the sibling treatment label.
            if has_label and not has_opposite and len(values) == 3:
                candidates.append((depth, len(text), values))
            element = element.parent
            depth += 1

    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[0], item[1]))[2]


def extract_marketplace_prices(html: str) -> tuple[PriceBand | None, PriceBand | None, str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.select("script, style, noscript, header, footer, nav"):
        tag.decompose()
    visible_text = normalize_space(soup.get_text(" ", strip=True))
    if not MARKETPLACE_HEADING_RE.search(visible_text):
        raise ValueError('Section "Preço Médio de Venda no Marketplace" was not found')

    normal_values = find_row_values(soup, "Normal")
    foil_values = find_row_values(soup, "Foil")
    if normal_values or foil_values:
        return (
            to_band(normal_values) if normal_values else None,
            to_band(foil_values) if foil_values else None,
            "marketplace-table-dom-strict",
        )

    # Text fallback is intentionally treatment-scoped. It never uses a block
    # containing both labels for one treatment.
    heading_match = MARKETPLACE_HEADING_RE.search(visible_text)
    section = visible_text[heading_match.end() :] if heading_match else visible_text
    normal_match = re.search(r"\bNormal\b(?P<body>.*?)(?=\bFoil\b|$)", section, re.I)
    foil_match = re.search(r"\bFoil\b(?P<body>.*?)(?=\b(?:Comprar|Lista|Bazar|Detalhes)\b|$)", section, re.I)
    normal_values = prices_in_text(normal_match.group("body"))[:3] if normal_match else []
    foil_values = prices_in_text(foil_match.group("body"))[:3] if foil_match else []

    normal = to_band(normal_values) if len(normal_values) == 3 else None
    foil = to_band(foil_values) if len(foil_values) == 3 else None
    if normal or foil:
        return normal, foil, "marketplace-table-text-scoped"

    # A valid card page may show the marketplace section but have no completed
    # sales/statistics yet. That is not a parser error.
    return None, None, "marketplace-no-data"

def extract_rarity(html: str, edition: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    visible_text = normalize_space(soup.get_text(" ", strip=True))
    match = RARITY_RE.search(visible_text)
    if not match:
        return None
    rarity = normalize_space(match.group(1))
    rarity = re.sub(rf"\s*[\[(]\s*{re.escape(edition)}\s*[\])]\s*$", "", rarity, flags=re.I)
    return rarity[:60] or None


async def discover_all_cards(
    context: BrowserContext,
    catalog_path: Path,
    timeout_ms: int,
    page_delay: float,
    max_pages: int,
) -> list[dict[str, str]]:
    """Crawl public card-search/edition pages and collect every unique printing URL."""
    page = await context.new_page()
    queue = list(DISCOVERY_SEEDS)
    queued = set(queue)
    visited: set[str] = set()
    cards: dict[str, dict[str, str]] = {}

    while queue and len(visited) < max_pages:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        logging.info("Discovering catalog page %s/%s: %s", len(visited), max_pages, url)
        try:
            response = await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            if response and response.status in {401, 403, 429}:
                logging.warning("Discovery page returned HTTP %s: %s", response.status, url)
                continue
            await page.wait_for_timeout(1200)
            # Lazy-loaded result pages may append cards while scrolling.
            previous_height = 0
            for _ in range(10):
                height = await page.evaluate("document.body.scrollHeight")
                if height == previous_height:
                    break
                previous_height = height
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(500)

            links = await page.locator("a[href]").evaluate_all(
                "els => els.map(a => ({href: a.href, text: (a.textContent || '').trim()}))"
            )
            before = len(cards)
            for link in links:
                href = str(link.get("href", ""))
                found = parse_card_link(href, str(link.get("text", "")))
                if found:
                    cards[found["id"]] = found
                    continue
                if is_discovery_page(href):
                    normalized = urljoin(BASE_URL, href)
                    if normalized not in queued and normalized not in visited:
                        queued.add(normalized)
                        queue.append(normalized)
            logging.info("Catalog: %s cards (+%s), %s pages queued", len(cards), len(cards) - before, len(queue))
        except Exception as exc:
            logging.warning("Discovery failed for %s: %s", url, exc)
        await asyncio.sleep(page_delay)

    await page.close()
    if not cards:
        raise RuntimeError("No card links were discovered. The site layout or access rules may have changed.")

    catalog = sorted(cards.values(), key=lambda c: (c["edition"].casefold(), natural_number_key(c["number"]), c["name"].casefold()))
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    logging.info("Wrote catalog %s with %s card printings from %s pages", catalog_path, len(catalog), len(visited))
    return catalog



class RateLimitError(RuntimeError):
    """Raised when LigaLorcana asks the collector to slow down."""


class AdaptiveRateLimiter:
    def __init__(self, min_delay: float, max_delay: float, initial_delay: float, cooldown: float) -> None:
        self.min_delay = max(0.5, min_delay)
        self.max_delay = max(self.min_delay, max_delay)
        self.current_delay = min(max(initial_delay, self.min_delay), self.max_delay)
        self.cooldown = max(30.0, cooldown)
        self.blocked_until = 0.0
        self.rate_limits = 0

    async def wait(self) -> None:
        now = time.monotonic()
        if self.blocked_until > now:
            remaining = self.blocked_until - now
            logging.warning("Rate-limit cooldown: sleeping %.0f seconds", remaining)
            await asyncio.sleep(remaining)
        # Small jitter smooths traffic and avoids bursts; it is not used to bypass access controls.
        await asyncio.sleep(random.uniform(self.current_delay * 0.85, self.current_delay * 1.15))

    def success(self) -> None:
        self.current_delay = max(self.min_delay, self.current_delay * 0.97)

    def rate_limited(self, attempt: int) -> float:
        self.rate_limits += 1
        self.current_delay = min(self.max_delay, max(self.current_delay * 1.8, self.min_delay))
        pause = min(900.0, self.cooldown * (2 ** min(attempt, 4)))
        pause += random.uniform(0, min(30.0, pause * 0.15))
        self.blocked_until = max(self.blocked_until, time.monotonic() + pause)
        return pause


def result_from_dict(item: dict[str, Any]) -> CardResult:
    def band(value: Any) -> PriceBand | None:
        return PriceBand(**value) if isinstance(value, dict) else None
    clean = dict(item)
    clean["normal"] = band(clean.get("normal"))
    clean["foil"] = band(clean.get("foil"))
    return CardResult(**clean)


def load_existing_results(path: Path) -> dict[str, CardResult]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return {
            str(item["id"]): result_from_dict(item)
            for item in payload.get("cards", [])
            if isinstance(item, dict) and item.get("id")
        }
    except Exception as exc:
        logging.warning("Could not read existing output %s; starting without cache: %s", path, exc)
        return {}


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def should_refresh(
    result: CardResult | None,
    refresh_days: int,
    refresh_all: bool,
    refresh_today: bool = False,
) -> bool:
    if refresh_all or result is None or result.status == "error":
        return True
    checked = parse_iso(result.checked_at)
    if checked is None:
        return True
    if checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    if refresh_today:
        return (
            checked.astimezone(LOCAL_TIMEZONE).date()
            < datetime.now(LOCAL_TIMEZONE).date()
        )
    return checked < datetime.now(timezone.utc) - timedelta(days=max(0, refresh_days))


async def fetch_card(
    page: Page,
    card: dict[str, Any],
    timeout_ms: int,
    retries: int,
    limiter: AdaptiveRateLimiter,
) -> CardResult:
    url = card_url(card)
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        now = datetime.now(timezone.utc).isoformat()
        try:
            await limiter.wait()
            response = await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            status_code = response.status if response else None
            if status_code == 429:
                pause = limiter.rate_limited(attempt)
                raise RateLimitError(f"HTTP 429; cooldown scheduled for {pause:.0f}s")
            if status_code in {401, 403}:
                raise RuntimeError(f"Website returned HTTP {status_code}")
            try:
                await page.get_by_text("Preço Médio de Venda no Marketplace", exact=False).wait_for(
                    state="visible", timeout=min(timeout_ms, 15000)
                )
            except Exception:
                pass
            await page.wait_for_timeout(750)
            html = await page.content()
            if "Too Many Requests" in html or re.search(r"\b429\b", (await page.title()), re.I):
                pause = limiter.rate_limited(attempt)
                raise RateLimitError(f"Rate-limit page detected; cooldown scheduled for {pause:.0f}s")
            normal, foil, method = extract_marketplace_prices(html)
            limiter.success()
            has_price = normal is not None or foil is not None
            return CardResult(
                id=str(card["id"]), name=str(card["name"]), edition=str(card["edition"]),
                number=normalize_number(card["number"]), url=url,
                canonical_id=card.get("canonical_id"), card_db_key=card.get("card_db_key"),
                match_status=str(card.get("match_status", "not_mapped")),
                match_method=card.get("match_method"), match_note=card.get("match_note"),
                printing_type=str(card.get("printing_type", "unknown")),
                printing_label=str(card.get("printing_label", "Unknown")),
                rarity=extract_rarity(html, str(card["edition"])), normal=normal, foil=foil,
                minimum_price_brl=normal.low if normal else None,
                status="ok" if has_price else "no_price", checked_at=now,
                extraction_method=method,
                database_id=card.get("database_id"),
                catalog_name=card.get("catalog_name"),
                catalog_match_status=card.get("catalog_match_status"),
                catalog_match_note=card.get("catalog_match_note"),
            )
        except RateLimitError as exc:
            last_error = exc
            if attempt < retries:
                continue
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                await asyncio.sleep(min(60.0, 2 ** (attempt + 1) + random.random() * 2))
    return CardResult(
        id=str(card.get("id", "unknown")), name=str(card.get("name", "unknown")),
        edition=str(card.get("edition", "unknown")), number=normalize_number(card.get("number", "")),
        url=url, canonical_id=card.get("canonical_id"), card_db_key=card.get("card_db_key"),
        match_status=str(card.get("match_status", "not_mapped")), match_method=card.get("match_method"),
        match_note=card.get("match_note"), printing_type=str(card.get("printing_type", "unknown")),
        printing_label=str(card.get("printing_label", "Unknown")), rarity=None,
        normal=None, foil=None, minimum_price_brl=None, status="error",
        checked_at=datetime.now(timezone.utc).isoformat(),
        error=f"{type(last_error).__name__}: {last_error}" if last_error else "Unknown error",
        database_id=card.get("database_id"),
        catalog_name=card.get("catalog_name"),
        catalog_match_status=card.get("catalog_match_status"),
        catalog_match_note=card.get("catalog_match_note"),
    )


def build_payload(results: list[CardResult], catalog_size: int, run_stats: dict[str, Any] | None = None) -> dict[str, Any]:
    ordered = sorted(results, key=lambda r: (r.edition.casefold(), natural_number_key(r.number), r.name.casefold()))
    summary = {
        "catalog_total": catalog_size,
        "stored": len(ordered),
        "ok": sum(r.status == "ok" for r in ordered),
        "no_price": sum(r.status == "no_price" for r in ordered),
        "errors": sum(r.status == "error" for r in ordered),
    }
    if run_stats:
        summary["run"] = run_stats
    return {
        "schema_version": 8, "source": "LigaLorcana.com.br",
        "price_type": "marketplace_sale_price", "generated_at": datetime.now(timezone.utc).isoformat(),
        "currency": "BRL", "summary": summary, "cards": [asdict(r) for r in ordered],
    }


def build_price_map(payload: dict[str, Any]) -> dict[str, Any]:
    # The exact Liga printing is the source of truth. The old canonical-name
    # groups remain below only for older clients that cannot consume ligaId.
    prices_by_liga_id: dict[str, Any] = {}
    prices: dict[str, Any] = {}
    unresolved: list[dict[str, Any]] = []
    legacy_accepted = {
        "matched", "matched_name_variant", "alternate_art", "enchanted",
        "promo", "challenge", "special", "special_printing",
    }

    for card in payload["cards"]:
        liga_id = normalize_space(str(card.get("id", ""))).upper()
        catalog_status = str(card.get("catalog_match_status") or "id_only")
        exact_status = (
            "matched_name_mismatch"
            if catalog_status in {"name_mismatch", "ambiguous_database_id"}
            else catalog_status
        )
        exact_row = {
            "liga_id": liga_id,
            "database_id": card.get("database_id"),
            "name": card.get("name"),
            "catalog_name": card.get("catalog_name"),
            "edition": card.get("edition"),
            "number": card.get("number"),
            "printing_type": card.get("printing_type"),
            "printing_label": card.get("printing_label"),
            "match_status": exact_status,
            "match_note": card.get("catalog_match_note"),
            "legacy_match_status": card.get("match_status"),
            "rarity": card.get("rarity"),
            "normal": card.get("normal"),
            "foil": card.get("foil"),
            "minimum_price_brl": card.get("minimum_price_brl"),
            "status": card.get("status"),
            "checked_at": card.get("checked_at"),
            "source_url": card.get("url"),
        }

        if liga_id:
            if liga_id in prices_by_liga_id:
                unresolved.append({
                    "liga_id": liga_id,
                    "name": card.get("name"),
                    "reason": "duplicate_liga_id",
                })
            else:
                prices_by_liga_id[liga_id] = exact_row
        else:
            unresolved.append({
                "liga_id": None,
                "name": card.get("name"),
                "reason": "missing_liga_id",
            })

        if catalog_status not in {"matched", "matched_name_variant"}:
            unresolved.append({
                "liga_id": liga_id,
                "database_id": card.get("database_id"),
                "name": card.get("name"),
                "catalog_name": card.get("catalog_name"),
                "reason": catalog_status,
                "note": card.get("catalog_match_note"),
            })

        # Compatibility layer. Crucially, a set/number -> wrong-name match is
        # never admitted here, so Huey LOR9-138 cannot become Anna's price.
        canonical_id = card.get("canonical_id")
        legacy_status = card.get("match_status")
        if not canonical_id or legacy_status not in legacy_accepted:
            if legacy_status in {"ambiguous", "unmatched", "matched_name_mismatch"}:
                unresolved.append({
                    "liga_id": liga_id,
                    "database_id": card.get("database_id"),
                    "name": card.get("name"),
                    "edition": card.get("edition"),
                    "number": card.get("number"),
                    "reason": f"legacy_{legacy_status}",
                    "note": card.get("match_note"),
                })
            continue

        group = prices.setdefault(canonical_id, {
            "card_db_key": card.get("card_db_key"),
            "base_name": card.get("catalog_name") or card.get("name"),
            "printings": [],
        })
        group["printings"].append({
            "liga_id": liga_id,
            "database_id": card.get("database_id"),
            "name": card.get("name"),
            "edition": card.get("edition"),
            "number": card.get("number"),
            "printing_type": card.get("printing_type"),
            "printing_label": card.get("printing_label"),
            "match_status": legacy_status,
            "normal": card.get("normal"),
            "foil": card.get("foil"),
            "minimum_price_brl": card.get("minimum_price_brl"),
            "status": card.get("status"),
            "checked_at": card.get("checked_at"),
            "source_url": card.get("url"),
        })

    for group in prices.values():
        group["printings"].sort(
            key=lambda item: (
                item.get("printing_type") != "regular",
                str(item.get("edition", "")),
                natural_number_key(str(item.get("number", ""))),
            )
        )
        group["regular"] = next(
            (printing for printing in group["printings"] if printing.get("printing_type") == "regular"),
            None,
        )

    return {
        "schema_version": 4,
        "source": "LigaLorcana.com.br",
        "generated_at": payload["generated_at"],
        "currency": "BRL",
        "summary": {
            "exact_printings": len(prices_by_liga_id),
            "exact_with_normal_price": sum(
                bool(row.get("normal") and row["normal"].get("low") is not None)
                for row in prices_by_liga_id.values()
            ),
            "exact_with_foil_price": sum(
                bool(row.get("foil") and row["foil"].get("low") is not None)
                for row in prices_by_liga_id.values()
            ),
            "base_cards_with_legacy_prices": len(prices),
            "legacy_mapped_printings": sum(len(group["printings"]) for group in prices.values()),
            "unresolved": len(unresolved),
        },
        "prices_by_liga_id": prices_by_liga_id,
        "prices": prices,
        "unresolved": unresolved,
    }


PRICE_HISTORY_SCHEMA = 1
PRICE_HISTORY_LIMIT = 400
COMPACT_PRICE_KEYS = ("n", "nl", "nh", "f", "fl", "fh")


def positive_price(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return None
    return value


def compact_history_price(raw: Any) -> dict[str, float | int]:
    """Normalize compact or verbose prices to Inkwell's history price record."""
    if not isinstance(raw, dict):
        return {}
    compact = {
        key: value
        for key in COMPACT_PRICE_KEYS
        if (value := positive_price(raw.get(key))) is not None
    }
    if compact:
        return compact

    result: dict[str, float | int] = {}
    for finish_name, keys in (
        ("normal", ("n", "nl", "nh")),
        ("foil", ("f", "fl", "fh")),
    ):
        finish = raw.get(finish_name)
        if not isinstance(finish, dict):
            continue
        market_key, low_key, high_key = keys
        market = positive_price(finish.get("average")) or positive_price(finish.get("market"))
        low = positive_price(finish.get("low"))
        high = positive_price(finish.get("high"))
        if market is not None:
            result[market_key] = market
        if low is not None:
            result[low_key] = low
        if high is not None:
            result[high_key] = high
    return result


def read_existing_history(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logging.warning("Could not read existing history %s; starting fresh: %s", path, exc)
        return {}
    return value if isinstance(value, dict) else {}


def history_by_date(existing: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Read current series format or migrate the agent's old card-centric format."""
    by_date: dict[str, dict[str, Any]] = {}
    if isinstance(existing.get("series"), list):
        for snapshot in existing["series"]:
            if not isinstance(snapshot, dict):
                continue
            snapshot_date = str(snapshot.get("date") or "")
            raw_prices = snapshot.get("prices")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", snapshot_date) or not isinstance(raw_prices, dict):
                continue
            prices: dict[str, Any] = {}
            for card_id, raw in raw_prices.items():
                compact = compact_history_price(raw)
                if compact:
                    prices[str(card_id)] = compact
            by_date[snapshot_date] = prices
        return by_date

    # Legacy v1 history used cards{liga_id:{history:[...]}}. Convert it
    # losslessly into the frontend's series[{date,prices}] layout.
    legacy_cards = existing.get("cards")
    if isinstance(legacy_cards, dict):
        for card_id, card_history in legacy_cards.items():
            if not isinstance(card_history, dict) or not isinstance(card_history.get("history"), list):
                continue
            for point in card_history["history"]:
                if not isinstance(point, dict):
                    continue
                snapshot_date = str(point.get("date") or "")
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", snapshot_date):
                    continue
                compact = compact_history_price(point)
                if compact:
                    by_date.setdefault(snapshot_date, {})[str(card_id)] = compact
    return by_date


def build_price_history(
    existing: dict[str, Any],
    current_prices: dict[str, dict[str, Any]],
    generated_at: str,
    *,
    limit: int = PRICE_HISTORY_LIMIT,
) -> dict[str, Any]:
    if limit < 1:
        raise ValueError("Price history limit must be at least 1")
    snapshot_date = str(generated_at)[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", snapshot_date):
        raise ValueError(f"Invalid generated_at for price history: {generated_at!r}")
    by_date = history_by_date(existing)
    by_date[snapshot_date] = current_prices
    dates = sorted(by_date)[-limit:]
    return {
        "schema_version": PRICE_HISTORY_SCHEMA,
        "generated_at": generated_at,
        "source": "LigaLorcana.com.br",
        "currency": "BRL",
        "series": [{"date": day, "prices": by_date[day]} for day in dates],
    }


def history_prices_from_results(results: Iterable[CardResult]) -> dict[str, dict[str, Any]]:
    prices: dict[str, dict[str, Any]] = {}
    for result in results:
        if result.status not in {"ok", "no_price"}:
            continue
        card_id = normalize_space(str(result.database_id or result.id))
        compact = compact_history_price({
            "normal": asdict(result.normal) if result.normal else None,
            "foil": asdict(result.foil) if result.foil else None,
        })
        if compact:
            if card_id in prices:
                raise ValueError(f"Duplicate history card identity: {card_id}")
            prices[card_id] = compact
    return prices


def add_history_price(
    prices: dict[str, dict[str, Any]],
    card_id: Any,
    raw: Any,
) -> None:
    identity = normalize_space(str(card_id or ""))
    if not identity:
        return
    compact = compact_history_price(raw)
    if not compact:
        return
    if identity in prices:
        raise ValueError(f"Duplicate history card identity: {identity}")
    prices[identity] = compact


def history_prices_from_artifact(price_artifact: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extract exact-printing compact prices from deploy v2, map v4, or raw v8."""
    if not isinstance(price_artifact, dict):
        raise ValueError("Price input must be a JSON object")
    prices: dict[str, dict[str, Any]] = {}

    # Detailed exact-printing map (schema v4). Detect by structure as well as
    # version so a harmless metadata-version typo does not block publication.
    exact_rows = price_artifact.get("prices_by_liga_id")
    if isinstance(exact_rows, dict):
        for liga_id, row in exact_rows.items():
            if isinstance(row, dict):
                add_history_price(
                    prices,
                    row.get("database_id") or liga_id,
                    row,
                )
        return prices

    # Deploy artifact (schema v2), including a previously generated prices.json.
    compact_rows = price_artifact.get("prices")
    if price_artifact.get("schema_version") == 2 and isinstance(compact_rows, dict):
        for card_id, raw in compact_rows.items():
            add_history_price(prices, card_id, raw)
        return prices

    # Raw collector cache (currently schema v8).
    raw_cards = price_artifact.get("cards")
    if isinstance(raw_cards, list):
        for row in raw_cards:
            if not isinstance(row, dict) or row.get("status") == "error":
                continue
            add_history_price(
                prices,
                row.get("database_id") or row.get("id"),
                row,
            )
        return prices

    schema = price_artifact.get("schema_version")
    keys = ", ".join(sorted(map(str, price_artifact.keys())))
    raise ValueError(
        f"Unsupported price input schema {schema!r}. Expected deploy v2, "
        f"detailed v4, or raw collector v8; found keys: {keys}"
    )


def build_deploy_prices_v2(price_map: dict[str, Any]) -> dict[str, Any]:
    """Build the compact, exact-printing artifact consumed by Inkwell."""
    return {
        "schema_version": 2,
        "generated_at": str(
            price_map.get("generated_at")
            or datetime.now(timezone.utc).isoformat()
        ),
        "source": str(price_map.get("source") or "LigaLorcana.com.br"),
        "currency": str(price_map.get("currency") or "BRL"),
        "prices": history_prices_from_artifact(price_map),
    }


def update_history(
    path: Path,
    results: Iterable[CardResult],
    generated_at: str | None = None,
) -> dict[str, Any]:
    timestamp = generated_at or datetime.now(timezone.utc).isoformat()
    return build_price_history(
        read_existing_history(path),
        history_prices_from_results(results),
        timestamp,
    )


def update_history_from_artifact(path: Path, price_map: dict[str, Any]) -> dict[str, Any]:
    generated_at = str(price_map.get("generated_at") or datetime.now(timezone.utc).isoformat())
    return build_price_history(
        read_existing_history(path),
        history_prices_from_artifact(price_map),
        generated_at,
    )


def build_analytics(history: dict[str, Any], current: dict[str, CardResult]) -> dict[str, Any]:
    expensive = sorted(
        ({"id": r.id, "name": r.name, "edition": r.edition, "number": r.number, "minimum_price_brl": r.minimum_price_brl} for r in current.values() if r.minimum_price_brl is not None),
        key=lambda x: x["minimum_price_brl"], reverse=True,
    )[:100]
    names = {
        str(result.database_id or result.id): result.name
        for result in current.values()
    }
    points_by_card: dict[str, list[tuple[str, float | int]]] = {}
    for snapshot in history.get("series", []):
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("prices"), dict):
            continue
        snapshot_date = str(snapshot.get("date") or "")
        for card_id, raw in snapshot["prices"].items():
            price = compact_history_price(raw)
            minimum = (
                price.get("nl")
                or price.get("n")
                or price.get("fl")
                or price.get("f")
            )
            if minimum is not None:
                points_by_card.setdefault(str(card_id), []).append((snapshot_date, minimum))

    movers = []
    for card_id, points in points_by_card.items():
        points.sort(key=lambda point: point[0])
        if len(points) < 2:
            continue
        old, new = points[-2][1], points[-1][1]
        if old == 0:
            continue
        change = new - old
        movers.append({
            "id": card_id,
            "name": names.get(card_id),
            "from": old,
            "to": new,
            "change_brl": round(change, 2),
            "change_pct": round(change / old * 100, 2),
        })
    return {
        "schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
        "top_100_most_expensive": expensive,
        "biggest_gainers": sorted(movers, key=lambda x: x["change_pct"], reverse=True)[:50],
        "biggest_losers": sorted(movers, key=lambda x: x["change_pct"])[:50],
    }


def atomic_write_json(
    path: Path,
    payload: Any,
    *,
    compact: bool = False,
    replace_attempts: int = 8,
    initial_retry_delay: float = 0.20,
) -> None:
    """Durably replace a JSON file, tolerating short Windows/OneDrive locks.

    A unique temporary filename prevents two runs or a stale ``.tmp`` file from
    colliding. If replacement never succeeds, the complete temporary JSON is
    deliberately preserved and its path is included in the raised error.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(
        f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp"
    )
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    # Force LF on Windows so Git/GitHub do not normalize CRLF after the
    # manifest checksum has already been calculated.
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())

    attempts = max(1, replace_attempts)
    for attempt in range(1, attempts + 1):
        try:
            if path.exists():
                try:
                    path.chmod(path.stat().st_mode | stat.S_IWRITE)
                except OSError:
                    pass
            os.replace(temp, path)
            return
        except PermissionError as exc:
            if attempt >= attempts:
                raise PermissionError(
                    f"Could not replace {path} after {attempts} attempts. "
                    f"A complete recovery copy remains at {temp}. Close any "
                    "program using the destination and pause OneDrive, then "
                    "rerun with --finalize-cache."
                ) from exc
            delay = min(5.0, initial_retry_delay * (2 ** (attempt - 1)))
            logging.warning(
                "File locked while replacing %s (attempt %s/%s); retrying in %.1fs",
                path,
                attempt,
                attempts,
                delay,
            )
            time.sleep(delay)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest_artifact(artifact_path: Path, manifest_path: Path) -> dict[str, Any]:
    try:
        relative = artifact_path.resolve().relative_to(manifest_path.parent.resolve())
    except ValueError as exc:
        raise ValueError(
            f"Artifact {artifact_path} must be inside the manifest directory "
            f"{manifest_path.parent}"
        ) from exc
    return {
        "path": relative.as_posix(),
        "sha256": sha256_file(artifact_path),
        "bytes": artifact_path.stat().st_size,
    }


def refresh_data_manifest(
    manifest_path: Path,
    deploy_prices_path: Path,
    history_path: Path,
    deploy_prices: dict[str, Any],
) -> bool:
    """Refresh price artifacts in an existing Inkwell manifest."""
    if not manifest_path.exists():
        return False
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError(f"{manifest_path} must contain a JSON object")

    artifacts_key = "artifacts" if isinstance(manifest.get("artifacts"), dict) else "files"
    artifacts = manifest.setdefault(artifacts_key, {})
    schema = manifest.setdefault("schema", {})
    counts = manifest.setdefault("counts", {})

    schema["prices"] = 2
    schema["price_history"] = PRICE_HISTORY_SCHEMA
    artifacts["prices"] = manifest_artifact(deploy_prices_path, manifest_path)
    artifacts["price_history"] = manifest_artifact(history_path, manifest_path)
    counts["priced_cards"] = len(deploy_prices["prices"])
    manifest["generated_at"] = deploy_prices["generated_at"]
    atomic_write_json(manifest_path, manifest)
    return True


def build_resume_status(output_path: Path, cards_path: Path) -> dict[str, Any]:
    """Summarize the durable raw cache without loading browser dependencies."""
    if not output_path.exists():
        return {
            "output": str(output_path),
            "cache_exists": False,
            "cache_records": 0,
            "checked_today": 0,
            "catalog_records": None,
            "remaining_today": None,
        }
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    raw_cards = [
        item
        for item in payload.get("cards", [])
        if isinstance(item, dict) and item.get("id")
    ]
    today = datetime.now(LOCAL_TIMEZONE).date()
    checked_today_ids: set[str] = set()
    status_counts: dict[str, int] = {}
    for item in raw_cards:
        status = str(item.get("status") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        checked = parse_iso(item.get("checked_at"))
        if checked is not None:
            if checked.tzinfo is None:
                checked = checked.replace(tzinfo=timezone.utc)
            if checked.astimezone(LOCAL_TIMEZONE).date() == today:
                checked_today_ids.add(str(item["id"]).upper())

    catalog_records: int | None = None
    remaining_today: int | None = None
    if cards_path.exists():
        catalog = json.loads(cards_path.read_text(encoding="utf-8"))
        if isinstance(catalog, list):
            catalog_ids = {
                str(item.get("id")).upper()
                for item in catalog
                if isinstance(item, dict) and item.get("id")
            }
            catalog_records = len(catalog_ids)
            remaining_today = len(catalog_ids - checked_today_ids)

    return {
        "output": str(output_path),
        "cache_exists": True,
        "schema_version": payload.get("schema_version"),
        "generated_at": payload.get("generated_at"),
        "cache_records": len({str(item["id"]).upper() for item in raw_cards}),
        "checked_today": len(checked_today_ids),
        "status_counts": status_counts,
        "catalog_records": catalog_records,
        "remaining_today": remaining_today,
        "timezone": str(LOCAL_TIMEZONE),
    }


def finalize_price_artifacts(
    raw_payload: dict[str, Any],
    existing: dict[str, CardResult],
    price_map_path: Path,
    deploy_prices_path: Path,
    history_path: Path,
    analytics_path: Path,
    manifest_path: Path,
) -> tuple[dict[str, Any], dict[str, Any], bool]:
    """Build all derived price files from the durable raw cache.

    The manifest is written last, so it never publishes checksums for a
    partially completed derived-artifact set.
    """
    price_map = build_price_map(raw_payload)
    atomic_write_json(price_map_path, price_map)
    deploy_prices = build_deploy_prices_v2(price_map)
    atomic_write_json(deploy_prices_path, deploy_prices, compact=True)
    history = build_price_history(
        read_existing_history(history_path),
        deploy_prices["prices"],
        deploy_prices["generated_at"],
    )
    atomic_write_json(history_path, history, compact=True)
    atomic_write_json(analytics_path, build_analytics(history, existing))
    manifest_updated = False
    if manifest_path.exists():
        manifest_updated = refresh_data_manifest(
            manifest_path,
            deploy_prices_path,
            history_path,
            deploy_prices,
        )
    return deploy_prices, history, manifest_updated


async def collect_prices(
    context: BrowserContext, cards: list[dict[str, Any]], output_path: Path,
    price_map_path: Path, deploy_prices_path: Path, history_path: Path,
    manifest_path: Path, analytics_path: Path, delay_min: float, delay_max: float,
    timeout_ms: int, retries: int, checkpoint_every: int, refresh_days: int,
    refresh_all: bool, refresh_today: bool, resume: bool,
    page_restart_every: int, cooldown: float,
    only_ids: set[str] | None = None,
) -> int:
    existing = load_existing_results(output_path) if resume else {}
    loaded_cache_records = len(existing)
    # Cached price bands remain reusable, but identity/mapping metadata must
    # always come from the current catalogue files.
    for card in cards:
        cached = existing.get(str(card["id"]))
        if not cached:
            continue
        cached.name = str(card["name"])
        cached.edition = str(card["edition"])
        cached.number = normalize_number(card["number"])
        cached.url = card_url(card)
        cached.canonical_id = card.get("canonical_id")
        cached.card_db_key = card.get("card_db_key")
        cached.match_status = str(card.get("match_status", "not_mapped"))
        cached.match_method = card.get("match_method")
        cached.match_note = card.get("match_note")
        cached.printing_type = str(card.get("printing_type", "unknown"))
        cached.printing_label = str(card.get("printing_label", "Unknown"))
        cached.database_id = card.get("database_id")
        cached.catalog_name = card.get("catalog_name")
        cached.catalog_match_status = card.get("catalog_match_status")
        cached.catalog_match_note = card.get("catalog_match_note")
    eligible = [
        card for card in cards
        if not only_ids or str(card["id"]).upper() in only_ids
    ]
    pending = [
        card for card in eligible
        if should_refresh(
            existing.get(str(card["id"])),
            refresh_days,
            refresh_all,
            refresh_today,
        )
    ]
    skipped = len(eligible) - len(pending)
    logging.info(
        "Incremental plan: %s to fetch, %s selected fresh cached records skipped",
        len(pending), skipped,
    )
    if resume:
        logging.info(
            "Resume cache: %s durable records loaded from %s. "
            "The request counter below starts at 1 for the remaining queue only.",
            loaded_cache_records,
            output_path,
        )
    limiter = AdaptiveRateLimiter(delay_min, delay_max, delay_min, cooldown)
    started = time.monotonic()
    fetched = errors = retries_count = 0
    page = await context.new_page()

    async def save_raw_checkpoint() -> dict[str, Any]:
        elapsed = max(0.001, time.monotonic() - started)
        stats = {"requested": len(pending), "fetched": fetched, "skipped_fresh": skipped, "errors_this_run": errors, "http_429": limiter.rate_limits, "elapsed_seconds": round(elapsed, 1)}
        payload = build_payload(list(existing.values()), len(cards), stats)
        atomic_write_json(output_path, payload)
        return payload

    for index, card in enumerate(pending, start=1):
        if page_restart_every > 0 and index > 1 and (index - 1) % page_restart_every == 0:
            await page.close()
            page = await context.new_page()
            logging.info("Restarted browser page after %s requests to release memory", index - 1)
        logging.info(
            "Checking remaining %s/%s: %s",
            index,
            len(pending),
            card["name"],
        )
        before_429 = limiter.rate_limits
        result = await fetch_card(page, card, timeout_ms, retries, limiter)
        retries_count += max(0, limiter.rate_limits - before_429)
        existing[result.id] = result
        fetched += 1
        if result.status == "error":
            errors += 1
            logging.error("%s failed: %s", result.id, result.error)
        elif result.status == "no_price":
            logging.info("%s: no marketplace statistics", result.id)
        else:
            logging.info("%s: normal=%s foil=%s", result.id, asdict(result.normal) if result.normal else None, asdict(result.foil) if result.foil else None)
        elapsed = max(0.001, time.monotonic() - started)
        rate = fetched / elapsed
        eta = (len(pending) - fetched) / rate if rate > 0 else 0
        logging.info("Progress %s/%s | 429=%s | delay=%.1fs | ETA=%.0f min", fetched, len(pending), limiter.rate_limits, limiter.current_delay, eta / 60)
        if checkpoint_every > 0 and fetched % checkpoint_every == 0:
            await save_raw_checkpoint()
    await page.close()
    payload = await save_raw_checkpoint()
    logging.info(
        "Collection complete. Finalizing derived price, history, analytics, "
        "and manifest artifacts from %s durable records.",
        len(existing),
    )
    try:
        finalize_price_artifacts(
            payload,
            existing,
            price_map_path,
            deploy_prices_path,
            history_path,
            analytics_path,
            manifest_path,
        )
    except Exception:
        logging.exception(
            "Derived-artifact finalization failed, but the raw cache remains "
            "complete at %s. Close programs using the generated JSON files, "
            "pause OneDrive if necessary, then rerun with --finalize-cache; "
            "no scraping is required.",
            output_path,
        )
        raise
    logging.info("Complete: %s fetched, %s skipped, %s errors, %s HTTP 429 responses", fetched, skipped, errors, limiter.rate_limits)
    return 0 if errors == 0 else 2


async def run(args: argparse.Namespace) -> int:
    args.cards.parent.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not args.headed)
        context = await browser.new_context(
            locale="pt-BR", timezone_id="America/Sao_Paulo",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            viewport={"width": 1600, "height": 1000},
        )
        if args.discover_all or not args.cards.exists():
            cards = await discover_all_cards(context, args.cards, args.timeout, args.discovery_delay, args.max_discovery_pages)
        else:
            cards = json.loads(args.cards.read_text(encoding="utf-8"))
        if not isinstance(cards, list) or not cards:
            raise ValueError("cards.json must contain a non-empty JSON array. Run with --discover-all --catalog-only first.")
        if not args.catalog_master.exists():
            raise FileNotFoundError(f"master catalogue not found: {args.catalog_master}")
        cards, supplemented = supplement_cards_from_master(cards, args.catalog_master)
        if supplemented:
            atomic_write_json(args.cards, cards)
            logging.info(
                "Added %s unique ligaIds from the master catalogue to %s",
                supplemented, args.cards,
            )
        required = {"id", "name", "edition", "number"}
        for index, card in enumerate(cards):
            if not isinstance(card, dict):
                raise ValueError(f"Card #{index + 1} must be a JSON object")
            missing = required - set(card)
            if missing:
                raise ValueError(f"Card #{index + 1} is missing: {sorted(missing)}")
        cards, master_report = apply_master_catalog_mapping(cards, args.catalog_master)
        if args.card_db.exists():
            cards, legacy_report = apply_card_db_mapping(cards, args.card_db)
        else:
            cards, legacy_report = apply_master_only_mapping(cards)
            logging.info(
                "Legacy card-db not found at %s; using current cards.json "
                "printing IDs only",
                args.card_db,
            )
        mapping_report = {
            "schema_version": 3,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "identity": "ligaId -> Database ID",
            "master_catalog": {
                key: value
                for key, value in master_report.items()
                if key != "cards"
            },
            "legacy_card_db": {
                key: value
                for key, value in legacy_report.items()
                if key != "cards"
            },
            "cards": [
                {
                    key: card.get(key)
                    for key in (
                        "id", "database_id", "name", "catalog_name",
                        "catalog_match_status", "catalog_match_note",
                        "edition", "number", "canonical_id", "card_db_key",
                        "match_status", "match_method", "match_note",
                        "printing_type", "printing_label",
                    )
                }
                for card in cards
            ],
        }
        atomic_write_json(args.mapping_output, mapping_report)
        logging.info("Mapping written to %s", args.mapping_output)
        if args.map_only or args.catalog_only:
            await context.close(); await browser.close(); return 0
        only_ids = {value.strip().upper() for value in args.only_id if value.strip()}
        if only_ids:
            known_ids = {str(card["id"]).upper() for card in cards}
            unknown_ids = sorted(only_ids - known_ids)
            if unknown_ids:
                raise ValueError(f"Unknown --only-id values: {unknown_ids}")
            if args.no_resume or not args.output.exists():
                raise ValueError(
                    "--only-id requires an existing raw --output cache and resume mode; "
                    "run a full collection first"
                )
        if args.limit:
            cards = cards[:args.limit]
        result = await collect_prices(
            context, cards, args.output, args.price_map_output, args.deploy_prices_output,
            args.history_output, args.manifest_output, args.analytics_output,
            args.delay_min, args.delay_max, args.timeout, max(0, args.retries), max(1, args.checkpoint_every),
            max(0, args.refresh_days), args.refresh_all, args.refresh_today,
            not args.no_resume,
            max(0, args.page_restart_every), args.rate_limit_cooldown,
            only_ids or None,
        )
        await context.close(); await browser.close(); return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Production LigaLorcana catalog and price collector")
    parser.add_argument(
        "--project-root", "--repo-root", dest="project_root", type=Path,
        help=(
            "Inkwell repository root. By default, detects the folder containing "
            "site/ and tools/"
        ),
    )
    parser.add_argument(
        "--cards", type=Path,
        help="LigaLorcana discovery catalogue (default: site/data/ligalorcana-catalog.json)",
    )
    parser.add_argument(
        "--output", type=Path,
        help="Raw resumable price cache (default: site/data/ligalorcana-prices.json)",
    )
    parser.add_argument(
        "--card-db", type=Path,
        help="Legacy card-db.js mapping input (default: site/card-db.js)",
    )
    parser.add_argument(
        "--catalog-master", type=Path,
        help="Printing-level mapping input (default: site/card-catalog-master.json)",
    )
    parser.add_argument(
        "--mapping-output", type=Path,
        help="Mapping report (default: site/data/card-price-map.json)",
    )
    parser.add_argument(
        "--price-map-output",
        type=Path,
        help="Detailed schema-v4 map (default: site/data/ligalorcana-price-map.v4.json)",
    )
    parser.add_argument(
        "--deploy-prices-output",
        type=Path,
        help="Compact schema-v2 artifact (default: site/data/prices.json)",
    )
    parser.add_argument(
        "--history-output", type=Path,
        help="Dated history artifact (default: site/data/price-history.json)",
    )
    parser.add_argument(
        "--manifest-output",
        type=Path,
        help="Manifest to refresh (default: site/data-manifest.json)",
    )
    parser.add_argument(
        "--history-from-prices",
        type=Path,
        help="Build schema-v2 deploy prices and append history from an existing v2, v4, or raw-v8 file without scraping",
    )
    parser.add_argument(
        "--analytics-output", type=Path,
        help="Price analytics output (default: site/data/price-analytics.json)",
    )
    parser.add_argument("--discover-all", action="store_true")
    parser.add_argument("--catalog-only", action="store_true")
    parser.add_argument("--map-only", action="store_true")
    parser.add_argument("--max-discovery-pages", type=int, default=1500)
    parser.add_argument("--discovery-delay", type=float, default=2.0)
    parser.add_argument("--delay-min", type=float, default=3.0, help="Minimum delay between requests")
    parser.add_argument("--delay-max", type=float, default=15.0, help="Maximum adaptive delay")
    parser.add_argument("--rate-limit-cooldown", type=float, default=90.0, help="Initial cooldown after HTTP 429")
    parser.add_argument("--timeout", type=int, default=45000)
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--checkpoint-every", type=int, default=1, help="Persist progress every N fetched cards")
    parser.add_argument("--refresh-days", type=int, default=7, help="Refresh cached records older than N days")
    parser.add_argument("--refresh-all", action="store_true", help="Ignore cache age and fetch every selected card")
    parser.add_argument(
        "--refresh-today", "--resume-today",
        dest="refresh_today",
        action="store_true",
        help=(
            "Fetch records not yet checked today in America/Sao_Paulo; "
            "safe to rerun after interruption"
        ),
    )
    parser.add_argument(
        "--only-id",
        action="append",
        default=[],
        help="Refresh only this ligaId (repeatable; requires an existing raw output cache)",
    )
    parser.add_argument("--no-resume", action="store_true", help="Ignore existing output cache")
    parser.add_argument("--page-restart-every", type=int, default=250, help="Restart page periodically to release memory")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--headed", action="store_true")
    parser.add_argument(
        "--show-paths", action="store_true",
        help="Print all resolved paths and exit without scraping or writing data",
    )
    parser.add_argument(
        "--resume-status", action="store_true",
        help=(
            "Show durable cache records, records checked today, and remaining "
            "catalog records; exit without scraping or writing"
        ),
    )
    parser.add_argument(
        "--finalize-cache", action="store_true",
        help=(
            "Rebuild price-map, deploy prices, history, analytics, and manifest "
            "from the durable raw output cache without scraping"
        ),
    )
    args = parser.parse_args()
    root = detect_project_root(args.project_root)
    site = root / "site"
    data = site / "data"
    args.project_root = root
    args.cards = resolve_cli_path(
        args.cards, data / "ligalorcana-catalog.json"
    )
    args.output = resolve_cli_path(
        args.output, data / "ligalorcana-prices.json"
    )
    args.card_db = resolve_cli_path(
        args.card_db,
        first_existing(
            site / "card-db.js",
            data / "card-db.js",
            root / "card-db.js",
        ),
    )
    args.catalog_master = resolve_cli_path(
        args.catalog_master,
        first_existing(
            site / "card-catalog-master.json",
            data / "card-catalog-master.json",
            data / "cards.json",
            root / "card-catalog-master.json",
        ),
    )
    args.mapping_output = resolve_cli_path(
        args.mapping_output, data / "card-price-map.json"
    )
    args.price_map_output = resolve_cli_path(
        args.price_map_output, data / "ligalorcana-price-map.v4.json"
    )
    args.deploy_prices_output = resolve_cli_path(
        args.deploy_prices_output, data / "prices.json"
    )
    args.history_output = resolve_cli_path(
        args.history_output, data / "price-history.json"
    )
    args.manifest_output = resolve_cli_path(
        args.manifest_output, site / "data-manifest.json"
    )
    args.analytics_output = resolve_cli_path(
        args.analytics_output, data / "price-analytics.json"
    )
    if args.history_from_prices is not None:
        args.history_from_prices = args.history_from_prices.expanduser().resolve()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.refresh_all and args.refresh_today:
        parser.error("--refresh-all and --resume-today cannot be used together")
    if args.no_resume and args.refresh_today:
        parser.error("--no-resume and --resume-today cannot be used together")
    if args.show_paths:
        print(json.dumps({
            "project_root": str(args.project_root),
            "cards": str(args.cards),
            "output": str(args.output),
            "card_db": str(args.card_db),
            "catalog_master": str(args.catalog_master),
            "mapping_output": str(args.mapping_output),
            "price_map_output": str(args.price_map_output),
            "deploy_prices_output": str(args.deploy_prices_output),
            "history_output": str(args.history_output),
            "manifest_output": str(args.manifest_output),
            "analytics_output": str(args.analytics_output),
            "history_from_prices": (
                str(args.history_from_prices) if args.history_from_prices else None
            ),
        }, ensure_ascii=False, indent=2))
        return 0
    if args.resume_status:
        try:
            print(json.dumps(
                build_resume_status(args.output, args.cards),
                ensure_ascii=False,
                indent=2,
            ))
            return 0
        except Exception as exc:
            logging.exception("Could not inspect resume cache: %s", exc)
            return 1
    if args.finalize_cache:
        try:
            if not args.output.exists():
                raise FileNotFoundError(
                    f"Raw resumable cache not found: {args.output}"
                )
            raw_payload = json.loads(args.output.read_text(encoding="utf-8"))
            existing = load_existing_results(args.output)
            if not existing:
                raise ValueError(
                    f"Raw resumable cache contains no card records: {args.output}"
                )
            deploy_prices, history, manifest_updated = finalize_price_artifacts(
                raw_payload,
                existing,
                args.price_map_output,
                args.deploy_prices_output,
                args.history_output,
                args.analytics_output,
                args.manifest_output,
            )
            logging.info(
                "Finalized %s raw records into %s deploy prices and %s history dates",
                len(existing),
                len(deploy_prices["prices"]),
                len(history["series"]),
            )
            if manifest_updated:
                logging.info("Manifest refreshed at %s", args.manifest_output)
            else:
                logging.warning(
                    "Manifest not found at %s; derived files were generated but "
                    "no deployment manifest was refreshed",
                    args.manifest_output,
                )
            return 0
        except Exception as exc:
            logging.exception("Cache finalization failed: %s", exc)
            return 1
    if args.history_from_prices:
        try:
            price_map = json.loads(args.history_from_prices.read_text(encoding="utf-8"))
            deploy_prices = build_deploy_prices_v2(price_map)
            atomic_write_json(args.deploy_prices_output, deploy_prices, compact=True)
            history = build_price_history(
                read_existing_history(args.history_output),
                deploy_prices["prices"],
                deploy_prices["generated_at"],
            )
            atomic_write_json(args.history_output, history, compact=True)
            manifest_updated = refresh_data_manifest(
                args.manifest_output,
                args.deploy_prices_output,
                args.history_output,
                deploy_prices,
            )
            logging.info(
                "Deploy prices written to %s; history written to %s "
                "(%s dates, %s current priced printings)",
                args.deploy_prices_output,
                args.history_output,
                len(history["series"]),
                len(history["series"][-1]["prices"]) if history["series"] else 0,
            )
            if manifest_updated:
                logging.info("Manifest refreshed at %s", args.manifest_output)
            else:
                logging.warning(
                    "Manifest not found at %s; pass --manifest-output with the "
                    "path to Inkwell's data-manifest.json",
                    args.manifest_output,
                )
            return 0
        except Exception as exc:
            logging.exception("History generation failed: %s", exc)
            return 1
    try:
        if not args.manifest_output.exists():
            logging.warning(
                "Manifest not found at %s; price files will be generated, but "
                "the deployment manifest will not be refreshed",
                args.manifest_output,
            )
        load_scraper_dependencies()
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        logging.warning("Interrupted by user. Progress up to the last checkpoint is preserved.")
        return 130
    except Exception as exc:
        logging.exception("Fatal error: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
