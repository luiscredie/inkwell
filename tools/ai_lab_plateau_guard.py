#!/usr/bin/env python3
"""Conservative stop signal for the local overnight RL loop.

Exit 10: plateau confirmed (caller should stop after current finished batch).
Exit 0: continue.
Exit 1: invalid/unavailable metrics (caller should continue and warn).
Does not modify weights, decks, game logs, or train models.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path


def plateau(path: Path, first_patience=150, later_patience=100, recent=30):
    if not path.is_file():
        return None, "Metrics file missing"
    rows = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for fields in csv.reader(f, delimiter="\t"):
            if len(fields) < 5:
                continue
            try:
                episode = int(fields[1])
                promoted = fields[2].strip().lower() == "true"
                delta = float(fields[3])
                ci = float(fields[4])
                if not (episode > 0 and math.isfinite(delta) and math.isfinite(ci)):
                    continue
                rows.append((episode, promoted, delta, ci))
            except (ValueError, TypeError):
                continue
    if not rows:
        return None, "No valid metrics"
    # Avoid mistaking timestamp anomalies for out-of-order training.
    dedup = {r[0]: r for r in rows}
    rows = sorted(dedup.values())
    last_promo = next((i for i in range(len(rows)-1, -1, -1) if rows[i][1]), -1)
    since = len(rows)-1-last_promo
    patience = later_patience if last_promo >= 0 else first_patience
    if since < patience:
        return False, f"{since}/{patience} batches since last promotion"
    window = rows[-recent:]
    max_delta = max(r[2] for r in window)
    # The trainer requires average delta >= 0.10 plus positive CI and V2 gate.
    # If even the average delta is below 0.10 in every recent candidate, skip
    # additional overnight batches. This isn't proof of model convergence.
    should_stop = max_delta < 0.10
    return should_stop, (f"{since} without promotion; maximum recent delta {max_delta:+.4f}"
                         + (" — plateau" if should_stop else " — continue"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("metrics", type=Path)
    p.add_argument("--initial-patience", type=int, default=150)
    p.add_argument("--after-promotion-patience", type=int, default=100)
    args = p.parse_args()
    try:
        stop, reason = plateau(args.metrics, args.initial_patience, args.after_promotion_patience)
        if stop is None:
            print("Plateau guard:", reason, file=sys.stderr)
            return 1
        if stop:
            print("Plateau guard: stopping training safely:", reason)
            return 10
        return 0
    except Exception as exc:
        print("Plateau guard:", type(exc).__name__, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
