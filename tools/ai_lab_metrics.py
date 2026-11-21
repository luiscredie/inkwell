#!/usr/bin/env python3
"""Local-only RL metrics -> a strictly whitelisted public aggregate for GitHub.

Never serializes gamelogs, player/opponent names, game ids, model weights,
deck lists, API keys, filesystem paths or the original metrics TSV.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = "luiscredie/inkwell"
BRANCH = "ai-lab-metrics"
REMOTE_PATH = "data/latest.json"
ROOT = Path.home() / ".local/share/inkwell-ai-lab/duels"
METRICS = ROOT / "coach_rl/logs/overnight_metrics_latest.tsv"
OUTPUT = ROOT / "dashboard/latest.json"


def safe_int(value, default=None):
    try:
        number = int(value)
        return number if 0 <= number <= 1_000_000_000_000 else default
    except (ValueError, TypeError, OverflowError):
        return default


def safe_float(value):
    try:
        number = float(value)
        return round(number, 5) if math.isfinite(number) and abs(number) < 100000 else None
    except (ValueError, TypeError, OverflowError):
        return None


def read_rows(path: Path):
    if not path.is_file():
        raise FileNotFoundError("RL metrics TSV not found: run the nightly trainer first")
    if path.stat().st_size > 12_000_000:
        raise ValueError("Metrics TSV unexpectedly large")
    rows = []
    invalid = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for fields in csv.reader(handle, delimiter="\t"):
            if len(fields) < 5:
                continue
            try:
                at = datetime.fromisoformat(fields[0].strip())
            except (ValueError, TypeError):
                continue
            episode = safe_int(fields[1].strip())
            delta = safe_float(fields[3])
            lower = safe_float(fields[4])
            if episode is None or delta is None or lower is None or episode < 1:
                invalid += 1
                continue
            rows.append({
                "at": at, "episodes": episode,
                "promoted": fields[2].strip().lower() == "true",
                "delta": delta, "lower": lower,
            })
    if not rows:
        raise ValueError("No valid training rows found; nothing will be published")
    # Count chronological anomalies in the input, but order observations by
    # cumulative episodes (timestamps can be skewed by scheduler delays).
    out_of_order = sum(rows[i]["at"] < rows[i - 1]["at"] for i in range(1, len(rows)))
    by_episode = {row["episodes"]: row for row in rows}
    rows = sorted(by_episode.values(), key=lambda row: row["episodes"])
    return rows, invalid, out_of_order


def optional_count(path: Path, key: str):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        value = data.get(key)
        if isinstance(value, list):
            return safe_int(len(value))
        return safe_int(value)
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def build_document(rows, root: Path, invalid: int, out_of_order: int):
    promotions = [r for r in rows if r["promoted"]]
    last_promo_index = next((i for i in range(len(rows) - 1, -1, -1)
                             if rows[i]["promoted"]), -1)
    plateau_batches = len(rows) - (last_promo_index + 1)
    last = rows[-1]
    by_day = defaultdict(list)
    for row in rows:
        by_day[row["at"].date().isoformat()].append(row)

    daily = []
    for day, items in sorted(by_day.items())[-45:]:
        daily.append({
            "day": day,
            "batches": len(items),
            "last_episodes": items[-1]["episodes"],
            "promotions": sum(r["promoted"] for r in items),
            "average_delta": round(sum(r["delta"] for r in items) / len(items), 5),
        })

    # Maximum 200 observations; always retain promoted models and last sample.
    picks = set(range(0, len(rows), max(1, math.ceil(len(rows) / 190))))
    picks.add(len(rows) - 1)
    picks.update(i for i, row in enumerate(rows) if row["promoted"])
    selected = [rows[i] for i in sorted(picks)][-240:]
    history = [
        {"episodes": r["episodes"], "delta": r["delta"],
         "lower_ci95": r["lower"], "promoted": r["promoted"]}
        for r in selected
    ]

    return {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "inkwell-ai-lab-local-sanitized",
        "status": "reported",
        "summary": {
            "episodes": last["episodes"],
            "training_batches": len(rows),
            "promotions": len(promotions),
            "latest_delta": last["delta"],
            "latest_lower_ci95": last["lower"],
            "last_promotion_episodes": promotions[-1]["episodes"] if promotions else None,
            "plateau_batches": plateau_batches,
            "anomalous_timestamps": out_of_order,
            "invalid_rows": invalid,
        },
        "data_quality": {
            "history_games": optional_count(root / "sync_status.json", "total_games"),
            "logs_archived": optional_count(root / "sync_status.json", "archived_gamelogs"),
            "observer_eligible": optional_count(root / "observer_quality.json", "eligible_game_ids"),
        },
        "daily": daily,
        "history": history,
        "caveat": "3-turn heuristic reward; not match win rate or complete Lorcana gameplay",
    }


def github_publish(payload: str):
    if not shutil.which("gh"):
        raise RuntimeError("GitHub CLI (gh) is missing; install and run gh auth login locally")
    endpoint = "repos/" + REPO + "/contents/" + REMOTE_PATH
    fetch = subprocess.run(
        ["gh", "api", endpoint + "?ref=" + BRANCH, "--jq", ".sha"],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if fetch.returncode != 0 or not fetch.stdout.strip():
        raise RuntimeError("Could not read public metrics branch; run gh auth login and verify repo access")
    # A content SHA prevents accidental overwrites of concurrent updates.
    import base64
    request = {
        "message": "data(ai-lab): update sanitized RL training aggregates",
        "branch": BRANCH,
        "sha": fetch.stdout.strip(),
        "content": base64.b64encode(payload.encode("utf-8")).decode("ascii"),
    }
    write = subprocess.run(
        ["gh", "api", "--method", "PUT", endpoint, "--input", "-"],
        input=json.dumps(request), capture_output=True, text=True,
        timeout=60, check=False,
    )
    if write.returncode != 0:
        raise RuntimeError("GitHub metrics upload failed; original TSV and RL models remain untouched")
    return True


def main():
    p = argparse.ArgumentParser(description="Export PUBLIC SAFE aggregate metrics")
    p.add_argument("--metrics", type=Path, default=METRICS)
    p.add_argument("--data-root", type=Path, default=ROOT)
    p.add_argument("--output", type=Path, default=OUTPUT)
    p.add_argument("--publish", action="store_true",
                   help="Opt-in: upload sanitized JSON to PUBLIC GitHub branch")
    args = p.parse_args()
    try:
        rows, invalid, anomalies = read_rows(args.metrics)
        document = build_document(rows, args.data_root, invalid, anomalies)
        payload = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.parent.chmod(0o700)
        args.output.write_text(payload, encoding="utf-8")
        args.output.chmod(0o600)
        print("Export complete:", document["summary"])
        print("Only aggregate metrics exported; no names, logs, game IDs or model weights.")
        if args.publish:
            github_publish(payload)
            print("Published sanitized aggregates to GitHub public metrics branch.")
        else:
            print("Local-only; use --publish after reviewing the JSON and authenticating gh.")
        return 0
    except Exception as exc:
        print("Metrics exporter failed:", str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
