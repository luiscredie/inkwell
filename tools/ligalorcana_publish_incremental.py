#!/usr/bin/env python3
"""Apply only verified, newly captured LigaLorcana finishes to Inkwell price data.

Reads the Chrome collector's immutable snapshots; never removes prices for missing
or incomplete cards, never publishes an incomplete edition, and never converts
a missing offer into zero. Intended to run in a PR worktree, not on main.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

FINISH_KEYS = {"normal": ("nl", "n", "nh"), "foil": ("fl", "f", "fh")}
MONEY_KEYS = frozenset(("n", "nl", "nh", "f", "fl", "fh"))


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write(path, doc):
    Path(path).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def normalise(value):
    text = html.unescape(html.unescape(str(value or ""))).replace("&", " and ")
    text = unicodedata.normalize("NFKD", text).casefold()
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in text if not unicodedata.combining(c)))


def valid_finish(row, finish):
    """Accept a reported mean above the highest current offer without altering it.

    The marketplace mean may be based on historical sales, while the low/high
    are current offers. Legacy collectors tag these cases invalid_order.
    """
    status = row.get(finish + "_status")
    if status not in ("ok", "invalid_order"):
        return None
    vals = [row.get(finish + "_" + k + "_centavos") for k in ("min", "med", "max")]
    if any(type(n) is not int or n <= 0 for n in vals):
        return None
    low, mean, high = vals
    if low > high or mean < low:
        return None
    # Accept legacy invalid_order only when the mean is above the high offer.
    if status == "invalid_order" and mean <= high:
        return None
    return {k: float(Decimal(n) / 100) for k, n in zip(FINISH_KEYS[finish], vals)}


def card_catalog(path):
    root = load(path)
    rows = root["cards"] if isinstance(root, dict) else root
    if isinstance(rows, dict):
        rows = [dict(row, id=cid) for cid, row in rows.items()]
    return {str(row.get("id") or row.get("card_id")): row for row in rows}


def completed_editions(snapshot):
    grouped = defaultdict(list)
    for row in snapshot.get("records", []):
        grouped[str(row.get("code"))].append(row)
    result, excluded = {}, {}
    for code, audit in snapshot.get("editionAudit", {}).items():
        expected, got = audit.get("queued_urls"), audit.get("captured_urls")
        rows = grouped.get(code, [])
        unique = {(str(r.get("edition_id")), str(r.get("idcard")), str(r.get("num"))) for r in rows}
        pending = [p for p in snapshot.get("pending", []) if p.get("edition") == code]
        if (type(expected) is int and expected > 0 and type(got) is int
                and got == expected == len(rows) == len(unique)
                and audit.get("failed_urls", 0) == 0
                and audit.get("skipped_urls", 0) == 0 and not pending):
            result[code] = rows
        else:
            excluded[code] = {"queued": expected, "captured": got, "records": len(rows),
                              "unique": len(unique), "failed": audit.get("failed_urls"),
                              "pending": len(pending)}
    return result, excluded


def select_latest(source):
    files = sorted(Path(source).glob("coleta_*.json"))
    if not files:
        raise ValueError("No Chrome checkpoints found")
    latest = load(files[-1])
    if latest.get("schema") != "inkwell-ligalorcana-local-v1":
        raise ValueError("Unknown source schema")
    if latest.get("total") != len(latest.get("records", [])):
        raise ValueError("Capture count does not equal records length")
    return latest, files[-1]


def apply(source, catalog_path, prices_path, history_path, report_path):
    raw, filename = select_latest(source)
    editions, excluded = completed_editions(raw)
    cards = card_catalog(catalog_path)
    prices = load(prices_path)
    old_liga = prices.get("liga_prices", {})
    merged = prices.setdefault("prices", {})
    liga = prices.setdefault("liga_prices", {})
    times = prices.setdefault("ligalorcana_last_valid_at", {})
    report = {"snapshot": str(filename), "exported_at": raw["exported_at"],
              "completed_editions": sorted(editions), "excluded_editions": excluded,
              "accepted": {}, "rejected": [], "preserved": 0, "changed_cards": 0}
    current = Counter()
    updates = defaultdict(dict)
    collisions = defaultdict(set)
    rows_to_apply = []
    for code, rows in sorted(editions.items()):
        for row in rows:
            number = str(row.get("num", ""))
            cid = code + "-" + number
            target = cards.get(cid)
            src = (str(row.get("edition_id")), str(row.get("idcard")), number)
            if not target:
                report["rejected"].append({"card_id": cid, "reason": "unknown_catalog_id"})
                continue
            name = next((target.get(k) for k in ("name_en", "name", "fullName", "full_name", "nEN", "title")
                         if target.get(k)), "")
            if not name or normalise(name) != normalise(row.get("name")):
                report["rejected"].append({"card_id": cid, "reason": "name_mismatch"})
                continue
            collisions[cid].add(src)
            rows_to_apply.append((cid, row))
    unsafe = {cid for cid, ids in collisions.items() if len(ids) != 1}
    for cid, row in rows_to_apply:
        if cid in unsafe:
            report["rejected"].append({"card_id": cid, "reason": "ambiguous_source_identity"})
            continue
        stamped = row.get("captured_at", "")
        try:
            dt = datetime.fromisoformat(stamped.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                raise ValueError("timezone required")
            dt = dt.astimezone(timezone.utc)
        except (TypeError, ValueError):
            report["rejected"].append({"card_id": cid, "reason": "invalid_timestamp"})
            continue
        for finish, keys in FINISH_KEYS.items():
            values = valid_finish(row, finish)
            if not values:
                current["rejected_" + finish] += 1
                if row.get(finish + "_status") not in ("missing", "no_offers"):
                    report["rejected"].append({"card_id": cid, "finish": finish,
                                               "reason": row.get(finish + "_status", "invalid")})
                continue
            previous_time = times.get(cid, {}).get(finish)
            if previous_time:
                try:
                    old_dt = datetime.fromisoformat(previous_time.replace("Z", "+00:00"))
                    if old_dt.tzinfo is not None and old_dt >= dt:
                        current["older_or_equal"] += 1
                        continue
                except (TypeError, ValueError):
                    pass
            liga.setdefault(cid, {}).update(values)
            times.setdefault(cid, {})[finish] = dt.isoformat()
            updates[cid].update(values)
            current["accepted_" + finish] += 1
    for cid, values in updates.items():
        merged.setdefault(cid, {}).update(values)
    report["accepted"] = dict(current)
    report["changed_cards"] = len(updates)
    report["preserved"] = len(set(merged) - set(updates))
    report["previous_liga_cards"] = len(old_liga)
    write(report_path, report)
    if not updates:
        return report
    # Preserve the TCGplayer values separately when the source was previously TCG.
    # The nightly Lorcast job will refresh the independent fallback dataset.
    prices["generated_at"] = datetime.now(timezone.utc).isoformat()
    prices["source"] = "LigaLorcana (verified incremental); TCGplayer fallback via Lorcast"
    prices["liga_date"] = max(datetime.fromisoformat(
        row["captured_at"].replace("Z", "+00:00")).date().isoformat()
        for _, row in rows_to_apply)
    prices["sources"] = {"ligalorcana": len(liga), "tcgplayer_fallback": max(0, len(merged) - len(liga))}
    write(prices_path, prices)
    history = load(history_path)
    if history.get("schema_version") != 1 or not isinstance(history.get("series"), list):
        raise ValueError("Unsupported Liga price-history schema")
    day = prices["liga_date"]
    existing = next((x for x in history["series"] if x.get("date") == day), None)
    if existing is None:
        existing = {"date": day, "prices": {}}
        history["series"].append(existing)
    existing.setdefault("prices", {}).update(updates)
    history["series"].sort(key=lambda x: x["date"])
    history["generated_at"] = prices["generated_at"]
    history["source"] = "LigaLorcana incremental"
    write(history_path, history)
    return report


def main():
    ap = argparse.ArgumentParser()
    for name in ("source", "cards", "prices", "history", "report"):
        ap.add_argument("--" + name, required=True)
    a = ap.parse_args()
    report = apply(a.source, a.cards, a.prices, a.history, a.report)
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
