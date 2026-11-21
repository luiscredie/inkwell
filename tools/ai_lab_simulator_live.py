#!/usr/bin/env python3
"""Publish anonymized Lorcana full-game simulator progress to Inkwell AI Lab.

Install this single file in the simulator directory, authenticate with "gh auth login",
then run:
  python3 ai_lab_simulator_live.py -- decks/emerald-steel-current.deck --reference decks/meta-s14 --games 100 --workers 4 --seed 20261121 --nodes 50

To upload an existing completed simulator --json report:
  python3 ai_lab_simulator_live.py --import-json benchmark_meta_s14_smoke.json

Only aggregate counts and opponent deck file names reach the public metrics branch.
Neither cardlists, physical deck contents, turn traces, nor raw game records are uploaded.
"""
import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time

REPOSITORY = "luiscredie/inkwell"
BRANCH = "ai-lab-metrics"
REMOTE_PATH = "data/simulator_latest.json"
MIN_PUBLISH_INTERVAL = 60


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def report_summary(data):
    """Convert simulator raw JSON to public-safe aggregates without raw games."""
    decks = data.get("decks", [])
    jobs = {int(j["id"]): j for j in data.get("jobs", [])}
    own = [i for i, d in enumerate(decks) if not d.get("reference")]
    if len(own) != 1:
        raise ValueError("Requires exactly one non-reference target deck")
    target = own[0]
    rows = []
    total = {"completed_games": 0, "planned_games": len(jobs), "wins": 0,
             "losses": 0, "undecided": 0, "errors": 0, "matchups": 0}
    for matchup in data.get("matchups", []):
        a, b = int(matchup["a"]), int(matchup["b"])
        if target not in (a, b):
            continue
        other = b if a == target else a
        name = str(decks[other]["name"])[:90]
        row = {"opponent": name, "games": 0, "wins": 0, "losses": 0,
               "undecided": 0, "play_wins": 0, "play_games": 0,
               "draw_wins": 0, "draw_games": 0, "errors": 0}
        for game in matchup.get("games", []):
            job = jobs.get(int(game["id"]))
            if job is None:
                raise ValueError("Game has no corresponding job")
            seats = job["decks"]
            if target not in seats:
                raise ValueError("Game seat does not include target deck")
            on_play = int(seats[0]) == target
            row["games"] += 1
            side = "play" if on_play else "draw"
            row[side + "_games"] += 1
            winner = game.get("winner")
            if winner is None or winner not in (0, 1):
                row["undecided"] += 1
            elif int(seats[winner]) == target:
                row["wins"] += 1
                row[side + "_wins"] += 1
            else:
                row["losses"] += 1
            if game.get("error"):
                row["errors"] += 1
        rows.append(row)
        for key in ("wins", "losses", "undecided", "errors"):
            total[key] += row[key]
        total["completed_games"] += row["games"]
    total["matchups"] = len(rows)
    opts = data.get("options", {})
    run = {
        "target": str(decks[target]["name"])[:90],
        "nodes": int(opts.get("nodes") or 0),
        "samples": int(opts.get("samples") or 1),
        "seed": int(opts.get("seed") or 0),
        "games_per_matchup": int(opts.get("games") or 0),
        "reference": Path(str(opts.get("reference") or "")).name,
    }
    return {"schema_version": 1, "source": "simulator-for-lorcana-sanitized",
            "status": "completed", "updated_at": utc_now(),
            "run": run, "summary": total, "matchups": rows}


def publish(payload):
    """Upload only the aggregate JSON to a dedicated public GitHub data branch."""
    subprocess.run(["gh", "--version"], capture_output=True, check=True)
    path = f"repos/{REPOSITORY}/contents/{REMOTE_PATH}"
    blob = base64.b64encode(
        (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    ).decode("ascii")
    for attempt in range(3):
        current = subprocess.run(
            ["gh", "api", path + "?ref=" + BRANCH],
            capture_output=True, text=True, check=False,
        )
        if current.returncode == 0:
            sha = json.loads(current.stdout)["sha"]
        elif "404" in current.stderr or "Not Found" in current.stderr:
            sha = None
        else:
            raise RuntimeError("Could not read GitHub metrics file: " + current.stderr[-400:])
        command = ["gh", "api", "--method", "PUT", path,
                   "-f", "message=Update sanitized AI Lab simulator progress",
                   "-f", "branch=" + BRANCH, "-f", "content=" + blob]
        if sha:
            command.extend(["-f", "sha=" + sha])
        done = subprocess.run(command, capture_output=True, text=True, check=False)
        if done.returncode == 0:
            return
        if "409" not in done.stderr and "sha" not in done.stderr.lower():
            raise RuntimeError("GitHub publication failed: " + done.stderr[-500:])
        time.sleep(1 + attempt)
    raise RuntimeError("GitHub metrics branch changed during publication (3 retries)")


def safe_publish(payload, enabled=True):
    if not enabled:
        return False
    try:
        publish(payload)
        print("[AI Lab] Public dashboard updated", file=sys.stderr)
        return True
    except (RuntimeError, OSError, subprocess.SubprocessError, ValueError) as exc:
        print("[AI Lab] Could not publish: " + str(exc), file=sys.stderr)
        return False


def running_payload(started, progress, planned, command_args):
    def option(name, default):
        try:
            return command_args[command_args.index(name) + 1]
        except (ValueError, IndexError):
            return default
    reference = option("--reference", "reference-decks")
    target = next((Path(a).stem for a in command_args if a.endswith(".deck")), "local-deck")
    return {"schema_version": 1, "source": "simulator-for-lorcana-sanitized",
            "status": "running", "updated_at": utc_now(), "started_at": started,
            "run": {"target": target, "nodes": int(option("--nodes", "0")),
                    "samples": int(option("--samples", "1")),
                    "seed": int(option("--seed", "1")),
                    "games_per_matchup": int(option("--games", "20")),
                    "reference": Path(reference).name},
            "summary": {"completed_games": progress, "planned_games": planned,
                        "wins": 0, "losses": 0, "undecided": 0,
                        "errors": 0, "matchups": (planned // int(option("--games", "20")) if planned else 0)},
            "matchups": []}


def run_simulator(simulate_args, enabled=True):
    args = list(simulate_args)
    if args and args[0] == "--":
        args.pop(0)
    if not args:
        raise ValueError("Provide simulator arguments after --")
    json_file = None
    if "--json" in args:
        ix = args.index("--json")
        if ix + 1 >= len(args):
            raise ValueError("--json requires a destination file")
        json_file = Path(args[ix + 1])
    else:
        json_file = Path("benchmark_ai_lab_live.json")
        args += ["--json", str(json_file)]
    if json_file.exists():
        raise FileExistsError("Benchmark output already exists; choose a new --json FILE: " + str(json_file))
    started = utc_now()
    state = {"done": 0, "total": 0}
    lock = threading.Lock()
    initial = running_payload(started, 0, 0, args)
    safe_publish(initial, enabled)
    command = ["npm", "run", "simulate", "--", *args]
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, bufsize=1, encoding="utf-8", errors="replace")

    def stdout_reader():
        for line in proc.stdout:
            m = re.search(r"= (\d+) games on", line)
            if m:
                with lock:
                    state["total"] = int(m.group(1))
            sys.stdout.write(line)
            sys.stdout.flush()

    def stderr_reader():
        buffer = ""
        while True:
            char = proc.stderr.read(1)
            if not char:
                break
            if char not in "\r\n":
                buffer += char
                continue
            match = re.search(r"(\d+)/(\d+) games", buffer)
            if match:
                with lock:
                    state["done"] = int(match.group(1))
                    state["total"] = int(match.group(2))
            sys.stderr.write(buffer + char)
            sys.stderr.flush()
            buffer = ""
        if buffer:
            sys.stderr.write(buffer)
            sys.stderr.flush()

    threads = [threading.Thread(target=stdout_reader, daemon=True),
               threading.Thread(target=stderr_reader, daemon=True)]
    for t in threads:
        t.start()
    last_publish = time.monotonic()
    previous = (-1, -1)
    while proc.poll() is None:
        time.sleep(1)
        with lock:
            snapshot = (state["done"], state["total"])
        if enabled and snapshot != previous and time.monotonic() - last_publish >= MIN_PUBLISH_INTERVAL:
            safe_publish(running_payload(started, *snapshot, args), enabled)
            previous = snapshot
            last_publish = time.monotonic()
    for t in threads:
        t.join()
    if proc.returncode == 0 and json_file.exists():
        report = report_summary(json.loads(json_file.read_text(encoding="utf-8")))
        report["started_at"] = started
        safe_publish(report, enabled)
    else:
        with lock:
            snapshot = (state["done"], state["total"])
        report = running_payload(started, *snapshot, args)
        report["status"] = "failed"
        report["exit_code"] = proc.returncode
        safe_publish(report, enabled)
    return proc.returncode


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import-json", metavar="FILE", help="Publish a completed simulator JSON result")
    parser.add_argument("--no-publish", action="store_true", help="Run locally without writing to GitHub")
    parser.add_argument("simulate_args", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.import_json:
        data = json.loads(Path(args.import_json).read_text(encoding="utf-8"))
        report = report_summary(data)
        safe_publish(report, not args.no_publish)
        print("Imported:", report["summary"]["completed_games"],
              "games across", report["summary"]["matchups"], "matchups")
        return 0
    return run_simulator(args.simulate_args, not args.no_publish)


if __name__ == "__main__":
    sys.exit(main())
