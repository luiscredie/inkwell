#!/usr/bin/env python3
"""Read-only, privacy-safe Task Manager telemetry for the Inkwell AI Lab on Ubuntu/WSL.

  python3 ai_lab_task_monitor.py --dry-run
  python3 ai_lab_task_monitor.py --once
  python3 ai_lab_task_monitor.py --watch --interval 120

Publishes aggregate CPU/RAM and running/idle states for four known AI Lab jobs
to the dedicated ai-lab-metrics branch. Never sends PIDs, process arguments,
filenames, paths, environment variables, credentials, or user data.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time

REPO = "luiscredie/inkwell"
BRANCH = "ai-lab-metrics"
REMOTE = "data/task_manager_latest.json"
GROUPS = (
    ("trainer", "Treinamento RL", frozenset({"coach_rl_nightly.py"})),
    ("pipeline", "Sincronização de partidas", frozenset({"run_duels_pipeline.sh"})),
    ("simulator", "Partidas completas", frozenset({"simulate.mjs", "ai_lab_simulator_live.py"})),
    ("exporter", "Publicação de métricas", frozenset({"ai_lab_metrics.py"})),
)
CLOCK_TICKS = os.sysconf("SC_CLK_TCK")
PAGE_BYTES = os.sysconf("SC_PAGE_SIZE")


def classify(argv: list[str]) -> str | None:
    """Use ONLY exact executable/script basenames. Never publish argv."""
    words = {Path(part).name for part in argv[:5] if part and not part.startswith("-")}
    for key, _label, allowed in GROUPS:
        if words & allowed:
            return key
    return None


def proc_stat(line: str) -> tuple[int, int]:
    """Return CPU ticks and RSS pages from Linux /proc/PID/stat."""
    end = line.rfind(")")
    if end < 0:
        raise ValueError("invalid /proc stat")
    fields = line[end + 2:].split()
    if len(fields) < 22:
        raise ValueError("incomplete /proc stat")
    return int(fields[11]) + int(fields[12]), max(0, int(fields[21]))


def read_processes(root: Path = Path("/proc")) -> dict[int, tuple[str, int, int]]:
    seen = {}
    for directory in root.iterdir():
        if not directory.name.isdecimal():
            continue
        try:
            cmdline = (directory / "cmdline").read_bytes().decode("utf-8", "replace")
            group = classify([x for x in cmdline.split("\0") if x])
            if not group:
                continue
            ticks, rss_pages = proc_stat((directory / "stat").read_text())
            seen[int(directory.name)] = (group, ticks, rss_pages)
        except (PermissionError, FileNotFoundError, ProcessLookupError, ValueError, OSError):
            continue
    return seen


def read_cpu(root: Path = Path("/proc")) -> tuple[int, int]:
    """Linux CPU total and idle jiffies."""
    line = (root / "stat").read_text().splitlines()[0]
    parts = line.split()
    if not parts or parts[0] != "cpu":
        raise ValueError("Linux CPU counters unavailable")
    values = [int(x) for x in parts[1:]]
    return sum(values), (values[3] if len(values) > 3 else 0) + (values[4] if len(values) > 4 else 0)


def read_memory(root: Path = Path("/proc")) -> tuple[float, float]:
    values = {}
    for line in (root / "meminfo").read_text().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].rstrip(":") in {"MemTotal", "MemAvailable"}:
            values[parts[0].rstrip(":")] = int(parts[1]) / 1024
    total, available = values["MemTotal"], values["MemAvailable"]
    return round(total, 1), round(max(0, total - available), 1)


def summarize(first: dict, second: dict, seconds: float, cpu_count: int) -> list[dict]:
    """CPU is a percentage of all WSL logical CPUs, not a single core."""
    groups = {key: {"key": key, "label": label, "state": "idle",
                    "processes": 0, "cpu_percent": 0.0, "memory_mb": 0.0}
              for key, label, _patterns in GROUPS}
    for pid, (key, ticks, rss) in second.items():
        item = groups[key]
        item["processes"] += 1
        item["memory_mb"] += rss * PAGE_BYTES / 1048576
        before = first.get(pid)
        if before and before[0] == key and ticks >= before[1]:
            item["cpu_percent"] += (
                100.0 * (ticks - before[1]) / (CLOCK_TICKS * max(seconds, 0.01) * max(cpu_count, 1))
            )
    for item in groups.values():
        item["state"] = "running" if item["processes"] else "idle"
        item["memory_mb"] = round(item["memory_mb"], 1)
        item["cpu_percent"] = round(min(100, item["cpu_percent"]), 1)
    return list(groups.values())


def sample(delay: float = 0.8, root: Path = Path("/proc")) -> dict:
    started = time.monotonic()
    before_cpu, before_idle = read_cpu(root)
    before = read_processes(root)
    time.sleep(delay)
    after = read_processes(root)
    after_cpu, after_idle = read_cpu(root)
    elapsed = max(0.01, time.monotonic() - started)
    total_mem, used_mem = read_memory(root)
    delta_cpu = max(1, after_cpu - before_cpu)
    cpu_pct = 100.0 * max(0, min(1, 1 - (after_idle - before_idle) / delta_cpu))
    tasks = summarize(before, after, elapsed, os.cpu_count() or 1)
    return {
        "schema_version": 1,
        "source": "inkwell-ai-lab-wsl-task-monitor",
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "host": "Ubuntu WSL",
        "sample_seconds": round(elapsed, 2),
        "system": {
            "cpu_percent": round(cpu_pct, 1),
            "memory_used_mb": used_mem,
            "memory_total_mb": total_mem,
            "logical_cpus": os.cpu_count() or 1,
        },
        "tasks": tasks,
    }


def publish(data: dict) -> None:
    """Write only the redacted schema to a separate public metrics branch."""
    subprocess.run(["gh", "auth", "status"], check=True, capture_output=True)
    endpoint = f"repos/{REPO}/contents/{REMOTE}"
    encoded = base64.b64encode(
        (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    ).decode("ascii")
    for attempt in range(3):
        get = subprocess.run(
            ["gh", "api", endpoint + "?ref=" + BRANCH],
            check=False, capture_output=True, text=True)
        if get.returncode == 0:
            sha = json.loads(get.stdout)["sha"]
        elif "404" in get.stderr or "Not Found" in get.stderr:
            sha = None
        else:
            raise RuntimeError("Cannot read remote telemetry file: " + get.stderr[-300:])
        cmd = ["gh", "api", "--method", "PUT", endpoint,
               "-f", "branch=" + BRANCH,
               "-f", "message=Update sanitized WSL AI Lab process telemetry",
               "-f", "content=" + encoded]
        if sha:
            cmd.extend(["-f", "sha=" + sha])
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode == 0:
            return
        if "409" not in result.stderr and "sha" not in result.stderr.lower():
            raise RuntimeError("Could not publish process telemetry: " + result.stderr[-300:])
        time.sleep(attempt + 1)
    raise RuntimeError("Telemetry publish conflict after three retries")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Print sanitized snapshot; do not publish")
    mode.add_argument("--once", action="store_true", help="Publish exactly one snapshot")
    mode.add_argument("--watch", action="store_true", help="Publish on a recurring interval")
    parser.add_argument("--interval", type=int, default=120, help="Seconds between samples, min 60 (default 120)")
    args = parser.parse_args()
    if args.interval < 60:
        parser.error("--interval must be at least 60 seconds to limit GitHub writes")
    if not Path("/proc/stat").is_file():
        parser.error("Linux /proc unavailable; this monitor is for Ubuntu/WSL only")

    while True:
        try:
            data = sample()
            if args.dry_run:
                print(json.dumps(data, ensure_ascii=False, indent=2))
                return 0
            publish(data)
            status = ", ".join(t["key"] for t in data["tasks"] if t["state"] == "running") or "none"
            print(f"{data['updated_at']} published. Running: {status}", flush=True)
        except (ValueError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as exc:
            print("Monitor error:", str(exc), file=sys.stderr, flush=True)
            if not args.watch:
                return 1
        if not args.watch:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
