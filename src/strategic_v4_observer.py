"""Read observed actions without claiming to reconstruct game state."""
from collections import Counter

if __package__:
    from .strategic_v4_outs import STRENGTH_CARD_ID
else:
    from strategic_v4_outs import STRENGTH_CARD_ID


def action_counts(events, key):
    if not isinstance(events, list) or any(
        not isinstance(event, dict) or not isinstance(event.get(key), str) or not event[key]
        for event in events
    ):
        raise ValueError(f"expected an array of observed actions with {key}")
    return dict(Counter(event[key] for event in events if not event.get("undone")))


def strength_choices(events):
    """Describe individual choices and adjacent events; only exact IDs establish target identity."""
    records = []
    for index, event in enumerate(events):
        if event["type"] != "CHOICE_RESOLVED":
            continue
        data = event.get("data")
        choice = data.get("choice") if isinstance(data, dict) else None
        if not isinstance(choice, dict) or choice.get("sourceCardId") != STRENGTH_CARD_ID:
            continue
        targets = choice.get("selectedInstanceIds")
        target = (targets[0] if isinstance(targets, list) and len(targets) == 1
                  and isinstance(targets[0], str) and targets[0] else None)
        record = {"choice_index": index, "turn": event.get("turnNumber"),
                  "target_instance_id": target, "undone_flag": event.get("undone"),
                  "adjacent_effects": [], "following_undo_index": None}
        records.append(record)
        # Recognize the specific contiguous log shape. Never scan past a new
        # challenge, choice, cast or unrelated event looking for a banishment.
        cursor = index + 1
        for expected in ("ABILITY_TRIGGERED", "DAMAGE_DEALT", "CARD_DESTROYED"):
            if cursor == len(events) or events[cursor]["type"] != expected:
                continue
            row = events[cursor]
            if row.get("turnNumber") != record["turn"] or bool(row.get("undone")) != bool(event.get("undone")):
                break
            if expected != "ABILITY_TRIGGERED":
                instance = row.get("instanceId")
                has_identity = isinstance(instance, str) and bool(instance)
                effect = {"index": cursor, "type": expected,
                          "same_target": instance == target if has_identity and target else None}
                details = row.get("data")
                if isinstance(details, dict):
                    effect.update({key: details[key] for key in ("cardId", "damage") if key in details})
                record["adjacent_effects"].append(effect)
            cursor += 1
        if (cursor < len(events) and events[cursor]["type"] == "CHOICE_UNDO"
                and events[cursor].get("turnNumber") == record["turn"]):
            record["following_undo_index"] = cursor
    return records


def observer_summary(payload):
    if isinstance(payload, list):
        if not payload:
            raise ValueError("empty Observer event log")
        return {
            "source": "observer_event_log",
            "game_id": None,
            "actions": action_counts(payload, "type"),
            "strength_choices": strength_choices(payload),
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
