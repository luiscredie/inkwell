#!/usr/bin/env python3
"""Audita e sincroniza ink_cost com o catálogo oficial Disney Lorcana."""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


CATALOG_URL = "https://cards.disneylorcana.com/en-US/"
USER_AGENT = "InkwellCardAudit/1.0"


def fetch_catalog(timeout: float) -> str:
    request = Request(
        CATALOG_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def official_costs(html: str, set_number: int) -> dict[int, int]:
    pattern = re.compile(
        r'card_identifier:"(\d+)/207 EN (\d+)"'
        r'(?:(?!card_identifier:).){0,5000}?ink_cost:(\d+)',
        flags=re.DOTALL,
    )
    costs: dict[int, int] = {}
    conflicts: dict[int, set[int]] = {}
    for number, official_set, cost in pattern.findall(html):
        if int(official_set) != set_number:
            continue
        number_int = int(number)
        cost_int = int(cost)
        if number_int in costs and costs[number_int] != cost_int:
            conflicts.setdefault(number_int, {costs[number_int]}).add(cost_int)
        costs[number_int] = cost_int
    if conflicts:
        details = ", ".join(
            f"{number}={sorted(values)}" for number, values in sorted(conflicts.items())
        )
        raise ValueError(f"Custos oficiais conflitantes: {details}")
    if not costs:
        raise ValueError(f"Nenhuma carta oficial encontrada para o Set {set_number}")
    return costs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_json", type=Path)
    parser.add_argument("--set", type=int, required=True, dest="set_number")
    parser.add_argument("--html", type=Path, help="HTML oficial já baixado")
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()

    html = (
        args.html.read_text(encoding="utf-8", errors="replace")
        if args.html
        else fetch_catalog(args.timeout)
    )
    costs = official_costs(html, args.set_number)
    payload = json.loads(args.input_json.read_text(encoding="utf-8-sig"))
    cards = payload.get("cards")
    if not isinstance(cards, list):
        raise ValueError("JSON inválido: lista cards não encontrada")

    card_pattern = re.compile(
        rf"^LOR{args.set_number}-(\d+)(?:s|-OS)?$",
        flags=re.IGNORECASE,
    )
    audit: list[dict] = []
    unmatched: list[str] = []
    for card in cards:
        match = card_pattern.fullmatch(str(card.get("card_id") or ""))
        if not match:
            continue
        number = int(match.group(1))
        if number not in costs:
            unmatched.append(str(card.get("card_id")))
            continue
        old_cost = card.get("ink_cost")
        new_cost = costs[number]
        status = "corrected" if old_cost != new_cost else "verified"
        if status == "corrected":
            card["ink_cost"] = new_cost
        audit.append({
            "card_id": card.get("card_id"),
            "name_en": card.get("name_en"),
            "old_ink_cost": old_cost,
            "official_ink_cost": new_cost,
            "status": status,
        })

    corrected = sum(row["status"] == "corrected" for row in audit)
    verified = sum(row["status"] == "verified" for row in audit)
    timestamp = datetime.now(timezone.utc).isoformat()
    payload.setdefault("official_data_sync", {})[f"LOR{args.set_number}"] = {
        "source": CATALOG_URL,
        "field": "ink_cost",
        "synced_at": timestamp,
        "corrected": corrected,
        "verified": verified,
        "unmatched": unmatched,
    }

    temporary = args.output_json.with_suffix(args.output_json.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(args.output_json)

    report = args.output_json.with_name(
        f"{args.output_json.stem}_ink_cost_audit.csv"
    )
    with report.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "card_id", "name_en", "old_ink_cost",
                "official_ink_cost", "status",
            ],
        )
        writer.writeheader()
        writer.writerows(audit)

    print(
        f"LOR{args.set_number}: corrected={corrected}, "
        f"verified={verified}, unmatched={len(unmatched)}"
    )
    print(f"Audit: {report}")
    return 1 if unmatched else 0


if __name__ == "__main__":
    raise SystemExit(main())
