"""Observed persistence and recovery after a benchmarked removal."""
from collections import Counter

if __package__:
    from .strategic_v4_impact import field_departures, named_character
    from .strategic_v4_outs import ready_ink, visible_character
else:
    from strategic_v4_impact import field_departures, named_character
    from strategic_v4_outs import ready_ink, visible_character


def live_frames(seq, snapshots, invalidated):
    return (frame for frame in range(seq + 1, max(snapshots) + 1) if frame not in invalidated)


def threat_persistence(seq, card, seat, snapshots, entries_by_seq, invalidated):
    """Count complete opposing turns during which this instance remained absent."""
    uid = card["instanceId"]
    previous = snapshots[seq]["currentPlayer"]
    handoffs, complete_turns = 0, 0
    fresh_opponent_turn = False
    end = last_absent = seq
    status, recovery = "unobserved_beyond_replay", None
    for frame in live_frames(seq, snapshots, invalidated):
        state = snapshots[frame]
        end = frame
        next_player = state["currentPlayer"]
        field = state["opponent"].get("field")
        observed = next((c for c in field or [] if c.get("instanceId") == uid and visible_character(c)), None)
        if observed is not None:
            choices = [(row.get("data") or {}).get("choice") or {} for row in entries_by_seq[frame]
                       if row["type"] == "CHOICE_RESOLVED" and not row.get("undone")
                       and row.get("player") == 3 - seat]
            sources = {choice["sourceCardName"] for choice in choices
                       if choice.get("sourceCardName") and uid in (choice.get("selectedInstanceIds") or [])}
            recovery = {"frame": frame, "damage": observed.get("damage"),
                        "source_card": next(iter(sources)) if len(sources) == 1 else None}
            status = "same_instance_returned"
            break
        if field is None or any(not c.get("instanceId") or
                                (c.get("instanceId") == uid and not visible_character(c)) for c in field):
            status = "visibility_gap"
            break
        last_absent = frame
        if state["status"] == "finished":
            status = "absent_through_game_end"
            break
        if next_player != previous and next_player in (seat, 3 - seat):
            handoffs += 1
            if next_player == seat and fresh_opponent_turn:
                complete_turns += 1
            fresh_opponent_turn = next_player == 3 - seat
        previous = next_player
    origin, last = (snapshot_position(snapshots[index]) for index in (seq, last_absent))
    return {
        "card": named_character(card), "status": status, "observed_through_frame": end,
        "last_observed_absent_frame": last_absent, "change_while_absent": position_change(origin, last),
        "handoffs_while_absent": handoffs, "complete_opponent_turns_while_absent": complete_turns,
        "lore_value_at_removal": card.get("lore"), "actual_lore_prevented": None,
        "return": recovery,
    }


def snapshot_position(state):
    own, opponent = state["myPlayer"], state["opponent"]
    return {
        "own_lore": own["lore"], "opponent_lore": opponent["lore"],
        "own_visible_characters": sum(visible_character(c) for c in own.get("field", [])),
        "opponent_visible_characters": sum(visible_character(c) for c in opponent.get("field", [])),
    }


def position_change(before, after):
    return {key: after[key] - before[key] for key in before}


def recorded_decisions(seq, seat, snapshots, frames, invalidated, next_own_turn):
    origin = snapshot_position(snapshots[seq])
    results = {}
    for frame in live_frames(seq, snapshots, invalidated):
        action = frames[frame]
        before = snapshots[frame - 1]
        if (before["status"] != "playing" or before["currentPlayer"] != seat
                or action.get("player") != seat
                or not (action.get("takenAction") or action["actionType"] in ("PLAY_CARD", "RESPOND_TO_PROMPT"))
                or "UNDO" in action["actionType"]):
            continue
        position = snapshot_position(before)
        decision = {"frame": frame, "action": action["actionType"], "position": position,
                    "change_since_removal": position_change(origin, position),
                    "immediate_change_after_decision": position_change(position, snapshot_position(snapshots[frame]))}
        results.setdefault("next_recorded_own_decision", decision)
        if next_own_turn is not None and frame > next_own_turn:
            results["first_decision_after_opponent_turn"] = decision
            break
        if next_own_turn is None:
            break
    return results


def visible_ink_names(player):
    return Counter(slot["card"]["id"] for slot in player.get("inkwell", [])
                   if slot.get("hidden") is False and isinstance(slot.get("card"), dict)
                   and slot["card"].get("id"))


def prior_public_cards(seq, seat, snapshots, entries_by_seq, invalidated):
    observations = []
    for frame in range(1, seq):
        if frame in invalidated:
            continue
        newly_visible_ink = (visible_ink_names(snapshots[frame]["opponent"])
                             - visible_ink_names(snapshots[frame - 1]["opponent"]))
        for row in entries_by_seq[frame]:
            data = row.get("data") or {}
            if row.get("player") != 3 - seat or row.get("undone") or not data.get("cardName"):
                continue
            if row["type"] == "CARD_INKED":
                if newly_visible_ink[data.get("cardId")] <= 0:
                    continue
                newly_visible_ink[data.get("cardId")] -= 1
            elif row["type"] != "CARD_PLAYED":
                continue
            observations.append({"frame": frame, "card": data["cardName"], "event": row["type"]})
    return observations


def opponent_resource_use(start, end, seat, snapshots, entries_by_seq, invalidated):
    plays = []
    if start is None:
        return plays
    for frame in range(start + 1, end + 1):
        if frame in invalidated or snapshots[frame - 1]["currentPlayer"] != 3 - seat:
            continue
        old, new = (snapshots[index]["opponent"] for index in (frame - 1, frame))
        before_ink, after_ink = (ready_ink(player["inkwell"]) if "inkwell" in player else None
                                 for player in (old, new))
        ready_ids = {card.get("instanceId") for card in old.get("field", [])
                     if card.get("instanceId") and card.get("exerted") is False}
        exerted = [named_character(card) for card in new.get("field", [])
                   if card.get("instanceId") in ready_ids and card.get("exerted") is True]
        for row in entries_by_seq[frame]:
            if row["type"] != "CARD_PLAYED" or row.get("player") != 3 - seat or row.get("undone"):
                continue
            data = row.get("data") or {}
            plays.append({"frame": frame, "card": data.get("cardName"), "sung_logged": data.get("isSung"),
                          "ink_paid_logged": data.get("inkPaid"), "ready_ink_at_frame": [before_ink, after_ink],
                          "newly_exerted_at_frame": exerted, "hand_count_at_frame": [
                              player.get("handCount") for player in (old, new)
                          ]})
    return plays


def recovery_report(seq, seat, snapshots, frames, entries_by_seq, invalidated, followup):
    threats = field_departures(snapshots[seq - 1]["opponent"], snapshots[seq]["opponent"])[1]
    if not threats:
        return None
    checkpoints = followup["checkpoints"]
    start = checkpoints.get("start_of_opponent_turn", {}).get("frame")
    next_turn = checkpoints.get("start_of_next_own_turn", {}).get("frame")
    terminal = checkpoints.get("game_finished", {}).get("frame", max(snapshots))
    end = next_turn if next_turn is not None else terminal
    return {
        "evidence": "retained_line_only",
        "threats": [threat_persistence(seq, card, seat, snapshots, entries_by_seq, invalidated) for card in threats],
        "opponent_response_card_plays": opponent_resource_use(start, end, seat, snapshots, entries_by_seq, invalidated),
        "public_opponent_cards_before_decision": prior_public_cards(seq, seat, snapshots, entries_by_seq, invalidated),
        "own_decisions": recorded_decisions(seq, seat, snapshots, frames, invalidated, next_turn),
    }
