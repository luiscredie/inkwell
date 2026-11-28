"""Read-only evidence from replay archives or a bounded sample of Observer event logs."""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path

from strategic_v4_benchmark import benchmark_game, strength_choice
from strategic_v4_draw_plan import draw_plan
from strategic_v4_observer import observer_summary
from strategic_v4_outs import STRENGTH_CARD_ID, routes_from_engine
from strategic_v4_replay import read_replays, replay_frames, undo_target


def review_replay(replay):
    frames = list(replay["frames"])
    invalid = set()
    for f in frames:
        seq = f["seq"]
        target = undo_target(f["actionType"], seq)
        if target is not None:
            invalid.update(range(target, seq))
    selections, forecasts, seen = [], [], set()
    deck = replay.get("decklist") or []
    for frame, state, entries in replay_frames(replay):
        seq = frame["seq"]
        if seq in invalid or state["currentPlayer"] != replay["perspective"]:
            continue
        if frame.get("player") == replay["perspective"] and strength_choice(entries):
            selections.append((seq, "strength"))
        if (state["status"] != "playing" or state.get("pendingPrompts") or state.get("opponentHasPendingPrompts")
                or state.get("mulliganState") or state["turnNumber"] in seen or state["myPlayer"]["deckCount"] < 2):
            continue
        for prints in ([STRENGTH_CARD_ID], ["9-26", "10-97"]):
            if not set(prints) <= set(deck):
                continue
            try:
                estimate = draw_plan(state, deck, prints, 2)
            except ValueError as error:
                estimate = {"inconclusive": str(error)}
            forecasts.append({"frame": seq, "turn": state["turnNumber"], **estimate})
        seen.add(state["turnNumber"])
    analysis = benchmark_game(replay, selections)
    casts = []
    for case in analysis["cases"]:
        actual = case["immediate_result"].get("strength") or {}
        resources = case["resources"] or {}
        before = resources.get("before_cast", {})
        sung = resources.get("sung_logged")
        # Verify the *observed* singing route without declaring any other singer ineligible.
        singers = 1 if sung is True and len(resources["newly_exerted_characters"]) == 1 else None
        routes, backend = routes_from_engine(before.get("ready_ink"), singers)
        threats = (case["opponent_recovery"] or {}).get("threats", [])
        casts.append({"frame": case["action_frame"], "sung": sung, "route_backend": backend,
                      "observed_route_supported": routes["can_sing"] if sung is True else
                      routes["can_pay"] if resources.get("ink_paid_logged") == 3 else None,
                      "damage": actual.get("recorded_damage"), "banished": actual.get("banishment_logged"),
                      "returned": next((t["status"] for t in threats if t["instance_id"] == actual.get("target")), None),
                      "observation": case["confidence"]["observation"], "ranking": "inconclusive"})
    return {"frames": len(frames), "events": len(replay["logs"]), "outcome": analysis["outcome"],
            "archetype": analysis["archetype"], "strength": casts, "forecasts": forecasts}


def sample_observer(directory, anchor=None, limit=20):
    if not 1 <= limit <= 20:
        raise ValueError("sample size must be between 1 and 20")
    paths = sorted(directory.glob("*.logs.gz")) if directory.is_dir() else []
    # Include a named control if present, then sample across the sorted collection.
    selected = [p for p in paths if anchor and p.name == anchor][:1]
    others = [p for p in paths if p not in selected]
    count = min(len(others), limit - len(selected))
    selected.extend(others[i * (len(others) - 1) // max(count - 1, 1)] for i in range(count))
    tally = Counter()
    for path in selected:
        try:
            with gzip.open(path, "rt", encoding="utf8") as stream:
                raw = stream.read(16_000_001)
                if len(raw) > 16_000_000:
                    raise ValueError("sample log exceeds size budget")
                data = observer_summary(json.loads(raw))
            if data["source"] != "observer_event_log":
                tally["other_schema"] += 1
                continue
            tally["event_logs"] += 1
            for choice in data["strength_choices"]:
                tally["strength_choices"] += 1
                if choice["undone_flag"] is True:
                    tally["undone_choices"] += 1
                elif any(e["type"] == "CARD_DESTROYED" and e["same_target"] is True
                         for e in choice["adjacent_effects"]):
                    tally["retained_matching_banishments"] += 1
        except (ValueError, OSError, EOFError):
            tally["unreadable"] += 1
    return {"available": len(paths), "sampled": len(selected), **tally,
            "status": "unavailable" if not selected else "partial" if tally["unreadable"] or tally["other_schema"] else "observed",
            "archetype": "unconfirmed", "state_reconstruction": "unavailable_from_events"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replays", type=Path, nargs="*")
    parser.add_argument("--observer", type=Path)
    parser.add_argument("--anchor")
    args = parser.parse_args()
    games = {}
    for path in args.replays:
        for replay in read_replays(path):
            if replay["gameId"] not in games:
                games[replay["gameId"]] = review_replay(replay)
    report = {"observed_replays": list(games.values())}
    if args.observer:
        report["observer"] = sample_observer(args.observer, args.anchor)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
