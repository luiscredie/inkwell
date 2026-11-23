"""Read observed actions without claiming to reconstruct game state."""
from collections import Counter


def action_counts(events, key):
    if not isinstance(events, list) or any(
        not isinstance(event, dict) or not isinstance(event.get(key), str) or not event[key]
        for event in events
    ):
        raise ValueError(f"expected an array of observed actions with {key}")
    return dict(Counter(event[key] for event in events if not event.get("undone")))


def observer_summary(payload):
    if isinstance(payload, list):
        if not payload:
            raise ValueError("empty Observer event log")
        return {
            "source": "observer_event_log",
            "game_id": None,
            "actions": action_counts(payload, "type"),
            "limitations": ["no_snapshots", "no_confirmed_perspective", "no_outs"],
        }
    if not isinstance(payload, dict) or not isinstance(payload.get("game_id"), str):
        raise ValueError("unrecognized replay or Observer payload")
    groups = {}
    for side, keys in (
        ("own", ("first_10_own_turns", "first_10_my_turns", "own_turns")),
        ("opponent", ("first_10_opponent_turns", "first_10_opp_turns", "opponent_turns")),
    ):
        key = next((key for key in keys if key in payload), None)
        if key is None:
            continue
        turns = payload[key]
        if not isinstance(turns, list) or any(not isinstance(turn, dict) for turn in turns):
            raise ValueError(f"invalid Observer turn list: {key}")
        counts = Counter()
        turns_with_actions = 0
        for turn in turns:
            if turn.get("actions") is None:
                continue
            actions = turn["actions"]
            if not isinstance(actions, list):
                raise ValueError(f"invalid Observer actions: {key}")
            turns_with_actions += 1
            # Only action labels are exported. Card names and event payloads stay local.
            for action in actions:
                if not isinstance(action, dict):
                    continue
                label = action.get("type") or action.get("kind") or action.get("action")
                if isinstance(label, str) and label and not action.get("undone"):
                    counts[label] += 1
        groups[side] = {"observed_turns": len(turns), "turns_with_actions": turns_with_actions,
                        "action_counts": dict(counts)}
    if not groups:
        raise ValueError("Observer report has no recognized turn lists")
    return {
        "source": "observer_turn_report",
        "game_id": payload["game_id"],
        "sides": groups,
        "limitations": ["partial_turn_observations", "no_snapshots", "no_outs"],
    }
