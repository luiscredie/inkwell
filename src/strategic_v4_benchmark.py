"""Extract reproducible evidence for reviewed V4 decisions from complete replays."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
from zipfile import BadZipFile

if __package__:
    from .strategic_v4_impact import board_impact, observed_followup, undo_equivalence
    from .strategic_v4_outs import STRENGTH_CARD_ID, ready_ink, visible_character
    from .strategic_v4_replay import analyze, board_evidence, disruption_counts, read_replays, replay_frames, undo_target
else:
    from strategic_v4_impact import board_impact, observed_followup, undo_equivalence
    from strategic_v4_outs import STRENGTH_CARD_ID, ready_ink, visible_character
    from strategic_v4_replay import analyze, board_evidence, disruption_counts, read_replays, replay_frames, undo_target


def visible_board(player):
    keys = ("id", "name", "title", "instanceId", "lore", "willpower", "damage", "exerted", "justPlayed")
    return [{key: card.get(key) for key in keys} for card in player["field"] if visible_character(card)]


def position(snapshot):
    own, opponent = snapshot["myPlayer"], snapshot["opponent"]
    return {
        "turn": snapshot["turnNumber"],
        "lore": [own["lore"], opponent["lore"]],
        "ready_ink": ready_ink(own["inkwell"]) if "inkwell" in own else None,
        "hand_size": len(own["hand"]) if "hand" in own else None,
        "own_board": visible_board(own),
        "opponent_board": visible_board(opponent),
        "strength_in_hand": (any(card.get("id") == STRENGTH_CARD_ID and not card.get("hidden")
                                 for card in own["hand"]) if "hand" in own else None),
    }


def strength_choice(entries, include_undone=False):
    choices = [
        entry["data"]["choice"] for entry in entries
        if entry["type"] == "CHOICE_RESOLVED" and (include_undone or not entry.get("undone"))
        and ((entry.get("data") or {}).get("choice") or {}).get("sourceCardId") == STRENGTH_CARD_ID
    ]
    return choices[0] if len(choices) == 1 else None


def choice_outcome(entries, choice, include_undone=False):
    ids = choice.get("selectedInstanceIds") or []
    if len(ids) != 1:
        return None
    target = ids[0]
    effects = [entry for entry in entries if entry.get("instanceId") == target
               and (include_undone or not entry.get("undone"))]
    damage = [(row.get("data") or {}).get("damage") for row in effects if row["type"] == "DAMAGE_DEALT"]
    return {"target": target, "recorded_damage": damage[0] if len(damage) == 1 else None,
            "banishment_logged": any(row["type"] == "CARD_DESTROYED" for row in effects)}


def strength_alternatives(prompt, outcome, abandoned):
    """Only targets offered at this exact prompt receive confirmed target legality."""
    if not prompt or not outcome or outcome["target"] not in prompt.get("validTargets", []):
        return []
    return [
        {"target": target, "legality": "confirmed_at_choice", "simulated": False,
         "evidence": "observed_then_undone" if target in abandoned else "offered_hypothesis",
         "immediate_result": abandoned.get(target),
         "resources": "same cast and payment already spent",
         "opportunity_cost": "forgo the effect on the chosen target"}
        for target in prompt["validTargets"] if target != outcome["target"]
    ]


def cast_resources(snapshots, entries_by_seq, prompt, seq, invalidated):
    prompt_id = prompt.get("id")
    if not prompt_id:
        return None
    for cast_seq in range(1, seq):
        if cast_seq in invalidated or not any(
            p.get("id") == prompt_id for p in snapshots[cast_seq].get("pendingPrompts", [])
        ):
            continue
        plays = [
            entry["data"] for entry in entries_by_seq[cast_seq]
            if entry["type"] == "CARD_PLAYED" and not entry.get("undone")
            and (entry.get("data") or {}).get("cardId") == STRENGTH_CARD_ID
        ]
        if len(plays) != 1:
            continue
        before, after = snapshots[cast_seq - 1], snapshots[cast_seq]
        original = {card["instanceId"]: card for card in visible_board(before["myPlayer"])}
        candidates = [
            original[card["instanceId"]] for card in visible_board(after["myPlayer"])
            if card["instanceId"] in original and original[card["instanceId"]]["exerted"] is False
            and card["exerted"] is True
        ]
        return {
            "before_cast_frame": cast_seq - 1, "before_cast": position(before),
            "sung_logged": plays[0].get("isSung"), "ink_paid_logged": plays[0].get("inkPaid"),
            "newly_exerted_characters": candidates,
        }
    return None


def benchmark_game(replay, selections):
    game = analyze(replay)
    snapshots, entries_by_seq, frames = {}, {}, {}
    invalidated = {}
    for frame, snapshot, entries in replay_frames(replay):
        seq = frame["seq"]
        snapshots[seq], entries_by_seq[seq], frames[seq] = deepcopy(snapshot), entries, frame
        target = undo_target(frame["actionType"], seq)
        if target is not None:
            invalidated.update({invalid: seq for invalid in range(target, seq)})
    cases = []
    for seq, focus in selections:
        if seq not in frames or seq - 1 not in snapshots or seq in invalidated:
            raise ValueError(f"frame {seq} is missing or superseded")
        before, after, frame, entries = snapshots[seq - 1], snapshots[seq], frames[seq], entries_by_seq[seq]
        seat = replay["perspective"]
        if before["status"] != "playing" or before["currentPlayer"] != seat or frame.get("player") != seat:
            raise ValueError(f"frame {seq} is not a decision by the replayed player")
        if focus != "strength" and (before.get("pendingPrompts") or before.get("opponentHasPendingPrompts")):
            raise ValueError(f"frame {seq} still has a prompt")
        action = frame.get("takenAction") or {"type": frame["actionType"]}
        impacts = disruption_counts(entries, seat, board_evidence(before), board_evidence(after))
        result = {"lore_after": [after["myPlayer"]["lore"], after["opponent"]["lore"]],
                  "disruption": dict(impacts), "board_impact": board_impact(before, after)}
        case = {
            "focus": focus, "before_frame": seq - 1, "action_frame": seq,
            "position": position(before), "actual": action, "immediate_result": result,
            "alternatives": [],
            "followup": observed_followup(seq, seat, snapshots, entries_by_seq, invalidated),
            "confidence": {"observation": "high", "followup": "retained_line_only", "ranking": "inconclusive"},
            "resources": None,
            "opportunity_cost": None,
            "missing_evidence": ["complete legal action enumeration", "simulated counterfactual and opponent response"],
        }
        if focus == "strength":
            choice = strength_choice(entries)
            prompts = [p for p in before.get("pendingPrompts", [])
                       if p.get("sourceAbility", "").casefold() == "strength of a raging fire"
                       and p.get("player") == seat]
            prompt = prompts[0] if len(prompts) == 1 else None
            observed = choice_outcome(entries, choice) if choice else None
            if not observed or not prompt or observed["target"] not in prompt.get("validTargets", []):
                case["confidence"]["observation"] = "inconclusive"
                case["missing_evidence"].append("unique Strength prompt and observed target")
            else:
                result["strength"] = observed
                abandoned = {}
                for other, undo in invalidated.items():
                    if undo >= seq or frames[undo]["actionType"] != f"UNDO_CHOICE:{other}":
                        continue
                    if not prompt.get("id") or not any(
                        p.get("id") == prompt["id"] for p in snapshots[other - 1].get("pendingPrompts", [])
                    ):
                        continue
                    reverted = strength_choice(entries_by_seq[other], include_undone=True)
                    undone = choice_outcome(entries_by_seq[other], reverted, include_undone=True) if reverted else None
                    if undone:
                        restored = undo_equivalence(snapshots[other - 1], snapshots[undo])
                        same_choice_state = undo_equivalence(snapshots[other - 1], before)
                        abandoned[undone["target"]] = {
                            "frame": other, "undo_frame": undo, **undone,
                            "undo_equivalence": restored, "choice_equivalence": same_choice_state,
                            "board_impact": board_impact(snapshots[other - 1], snapshots[other]),
                            "followup": "unobserved_after_undo",
                        }
                case["alternatives"] = strength_alternatives(prompt, observed, abandoned)
                case["resources"] = cast_resources(snapshots, entries_by_seq, prompt, seq, invalidated)
                case["opportunity_cost"] = "card and payment committed; targeting skips the effect on other targets"
                if case["resources"] is None:
                    case["missing_evidence"].append("verified cast and payment")
                if observed["recorded_damage"] is None:
                    case["confidence"]["observation"] = "partial"
                    case["missing_evidence"].append("unique damage entry for selected target")
                case["missing_evidence"].append("comparison of payment routes and downstream effect on victory")
        elif action["type"] in ("QUEST", "CHALLENGE"):
            case["resources"] = {"actor": action.get("cardName") or action.get("attackerName")}
            case["opportunity_cost"] = "exerting this character uses its current action"
        cases.append(case)
    detective_clues = sorted({
        card["id"] for seq, state in snapshots.items() if seq not in invalidated
        for card in state["opponent"].get("field", [])
        if visible_character(card) and card.get("id")
        and any(tag.casefold() == "detective" for tag in card.get("subtypes", []) or [])
    })
    return {"outcome": "win" if game["own_victory"] else "loss",
            "final_lore": [game["own_lore"], game["opponent_lore"]],
            "archetype": {"status": "unconfirmed", "visible_detective_prints": detective_clues},
            "cases": cases}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replays", nargs="+", type=Path)
    parser.add_argument("--cases", type=Path, required=True, help="JSON mapping game IDs to [frame, focus] pairs")
    args = parser.parse_args(argv)
    try:
        selection = json.loads(args.cases.read_text(encoding="utf-8"))
        if not isinstance(selection, dict) or any(
            not isinstance(cases, list) or any(
                not isinstance(case, list) or len(case) != 2 or type(case[0]) is not int
                or case[1] not in ("strength", "comeback", "disruption")
                for case in cases
            ) for cases in selection.values()
        ):
            raise ValueError("invalid case manifest")
        games = {}
        for path in args.replays:
            for replay in read_replays(path):
                game_id = replay["gameId"]
                if game_id not in games:
                    games[game_id] = benchmark_game(replay, selection.get(game_id, []))
        if selection.keys() - games.keys():
            raise ValueError("some selected game IDs are missing from the inputs")
    except (ValueError, TypeError, AttributeError, KeyError, OSError, EOFError, BadZipFile) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps({"validated_games": len(games), "simulated_alternatives": 0, "games": games},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
