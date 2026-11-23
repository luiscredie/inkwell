"""Immediate board impact and observed follow-up for replay decisions."""
if __package__:
    from .strategic_v4_outs import ready_ink, visible_character
else:
    from strategic_v4_outs import ready_ink, visible_character


def undo_equivalence(original, restored):
    """Compare recorded state conservatively. Hidden game state remains unavailable."""
    missing, differences = [], []
    for key in ("turnNumber", "currentPlayer", "status", "pendingPrompts",
                "opponentHasPendingPrompts", "turnGateState"):
        if original.get(key) is None or restored.get(key) is None:
            missing.append(key)
    for side in ("myPlayer", "opponent"):
        old, new = original.get(side, {}), restored.get(side, {})
        required = ("field", "items", "discard", "inkwell", "deckCount", "lore")
        required += ("hand",) if side == "myPlayer" else ()
        missing.extend(f"{side}.{key}" for key in required if old.get(key) is None or new.get(key) is None)
        if side == "opponent" and any(state.get("hand") is None and state.get("handCount") is None for state in (old, new)):
            missing.append("opponent.hand_or_count")
        differences.extend(f"{side}.{key}" for key in sorted(old.keys() | new.keys())
                           if key not in old or key not in new or old[key] != new[key])
    differences.extend(key for key in sorted((original.keys() | restored.keys()) - {"myPlayer", "opponent"})
                       if key not in original or key not in restored or original[key] != restored[key])
    status = ("different_recorded_state" if differences else "insufficient_recorded_state"
              if missing else "matches_recorded_state")
    return {"status": status, "different_fields": differences, "missing_fields": missing,
            "scope": "serialized replay snapshot; hidden engine state not verified"}


def named_character(card):
    return " - ".join(part for part in (card.get("name"), card.get("title")) if part) or card.get("id")


def field_departures(old, new):
    visible_before = {card["instanceId"]: card for card in old.get("field", [])
                      if card.get("instanceId") and visible_character(card)}
    still_in_play = {card.get("instanceId") for card in new.get("field", [])}
    previous_discard = {card.get("instanceId") for card in old.get("discard", [])}
    entered_discard = {card.get("instanceId") for card in new.get("discard", [])} - previous_discard
    departed = [card for uid, card in visible_before.items() if uid not in still_in_play]
    banished = [card for card in departed if card["instanceId"] in entered_discard]
    return departed, banished


def board_impact(before, after):
    """Count observable losses from the board, with discard evidence for banishment."""
    changes = {}
    for side in ("myPlayer", "opponent"):
        departed, banished = field_departures(before[side], after[side])
        lore = [card.get("lore") for card in banished]
        changes[side] = {
            "confirmed_banishments": [named_character(card) for card in banished],
            "other_visible_departures": [named_character(card) for card in departed if card not in banished],
            "banished_snapshot_lore": sum(lore) if all(type(value) is int for value in lore) else None,
        }
    old, new = before["myPlayer"], after["myPlayer"]
    changes["own_resources"] = {
        "ready_ink": [ready_ink(player["inkwell"]) if "inkwell" in player else None for player in (old, new)],
        "cards_in_hand": [len(player["hand"]) if "hand" in player else None for player in (old, new)],
    }
    return changes


def observed_followup(seq, seat, snapshots, entries_by_seq, invalidated):
    """Follow the retained line through opponent response and the next own turn."""
    labels = ("start_of_opponent_turn", "start_of_next_own_turn", "end_of_next_own_turn")
    checkpoints, events, returns = {}, [], []
    watched = {
        side: {card["instanceId"] for card in field_departures(snapshots[seq - 1][side], snapshots[seq][side])[1]}
        for side in ("myPlayer", "opponent")
    }
    phase = 0
    for following in range(seq + 1, max(snapshots) + 1):
        if following in invalidated:
            continue
        state = snapshots[following]
        active = state.get("currentPlayer")
        for side, instances in watched.items():
            for card in state[side].get("field", []):
                if card.get("instanceId") in instances and visible_character(card):
                    instances.remove(card["instanceId"])
                    returns.append({"frame": following, "side": side, "card": named_character(card),
                                    "damage": card.get("damage")})
        for entry in entries_by_seq[following]:
            if entry.get("undone") or entry["type"] not in ("CARD_PLAYED", "CARD_QUEST", "CARD_DESTROYED", "LORE_GAINED"):
                continue
            data = entry.get("data") or {}
            logged_player = entry.get("player")
            events.append({"frame": following, "type": entry["type"], "card": data.get("cardName"),
                           "active_side": relative_side(active, seat),
                           "logged_player_side": relative_side(logged_player, seat),
                           "lore_gained": data.get("loreGained")})
        if state["status"] == "finished":
            checkpoints["game_finished"] = followup_checkpoint(following, state)
            break
        if active == (seat if phase == 1 else 3 - seat):
            checkpoints[labels[phase]] = followup_checkpoint(following, state)
            phase += 1
            if phase == len(labels):
                break
    return {"evidence": "retained_line_only", "checkpoints": checkpoints, "events": events,
            "same_instances_returned": returns}


def relative_side(player, seat):
    return "own" if player == seat else "opponent" if player == 3 - seat else None


def followup_checkpoint(frame, state):
    own, opponent = state["myPlayer"], state["opponent"]
    return {
        "frame": frame, "turn": state["turnNumber"], "lore": [own["lore"], opponent["lore"]],
        "own_characters": [named_character(card) for card in own.get("field", []) if visible_character(card)],
        "opposing_characters": [named_character(card) for card in opponent.get("field", []) if visible_character(card)],
    }
