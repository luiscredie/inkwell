"""Offline Duels replay validation and evidence for Strategic Coach V4."""
import argparse
from collections import Counter
from copy import deepcopy
import gzip
import json
from math import comb
from pathlib import Path
from zipfile import BadZipFile, ZipFile

if __package__:
    from .strategic_v4_observer import observer_summary
    from .strategic_v4_outs import STRENGTH_CARD_ID, ready_ink, strength_response
else:
    from strategic_v4_observer import observer_summary
    from strategic_v4_outs import STRENGTH_CARD_ID, ready_ink, strength_response


class ReplayError(ValueError):
    pass


def patch_snapshot(snapshot, patch):
    """Apply the observed Duels subset of JSON Patch, in order."""
    for operation in patch:
        op, path = operation["op"], operation["path"]
        if op not in {"add", "replace", "remove"} or not path.startswith("/"):
            raise ReplayError(f"unsupported patch operation {op!r} at {path!r}")
        parts = [part.replace("~1", "/").replace("~0", "~") for part in path[1:].split("/")]
        parent = snapshot
        for part in parts[:-1]:
            if isinstance(parent, list):
                if not part.isascii() or not part.isdecimal() or int(part) >= len(parent):
                    raise ReplayError(f"invalid parent array offset at {path}")
                parent = parent[int(part)]
            else:
                parent = parent[part]
        key = parts[-1]
        value = deepcopy(operation["value"]) if op != "remove" else None
        if isinstance(parent, list):
            index = len(parent) if key == "-" and op == "add" else int(key)
            if not 0 <= index <= len(parent) or (index == len(parent) and op != "add"):
                raise ReplayError(f"invalid array offset at {path}")
            if op == "add":
                parent.insert(index, value)
            elif op == "remove":
                del parent[index]
            else:
                parent[index] = value
        elif op == "remove":
            parent.pop(key, None)
        else:
            # Duels can replace object properties that were omitted in exported snapshots.
            parent[key] = value


def lore_pair(snapshot):
    pair = snapshot["myPlayer"]["lore"], snapshot["opponent"]["lore"]
    if any(type(value) is not int or value < 0 for value in pair):
        raise ReplayError("invalid lore total")
    return pair


def validate_snapshot(snapshot, perspective, required_zones=()):
    if type(snapshot["viewingAs"]) is not int or snapshot["viewingAs"] != perspective:
        raise ReplayError("snapshot perspective differs from replay")
    if type(snapshot["turnNumber"]) is not int or snapshot["turnNumber"] < 1:
        raise ReplayError("invalid turn number")
    if snapshot["status"] == "playing" and (
        type(snapshot["currentPlayer"]) is not int or snapshot["currentPlayer"] not in (1, 2)
    ):
        raise ReplayError("invalid active seat")
    lore_pair(snapshot)
    if not isinstance(snapshot["status"], str) or not snapshot["status"]:
        raise ReplayError("invalid game status")
    if any(zone not in snapshot[side] for side, zone in required_zones):
        raise ReplayError("previously recorded zone is missing")
    for seat in ("myPlayer", "opponent"):
        player = snapshot[seat]
        for zone in ("hand", "field", "items", "discard", "inkwell"):
            if zone in player and (not isinstance(player[zone], list)
                                   or any(not isinstance(card, dict) for card in player[zone])):
                raise ReplayError(f"invalid {seat}.{zone} zone")
        for key in ("deckCount", "handCount"):
            if key in player and (type(player[key]) is not int or player[key] < 0):
                raise ReplayError(f"invalid {seat}.{key}")


def undo_target(action, seq):
    kind, marker, target = action.partition(":")
    if kind not in ("FREE_UNDO", "UNDO_CHOICE"):
        return None
    if not marker or not target.isascii() or not target.isdecimal() or not 1 <= int(target) < seq:
        raise ReplayError(f"invalid undo target at frame {seq}")
    return int(target)


def replay_frames(replay):
    """Yield each recorded frame and the mutable post-action snapshot."""
    if replay.get("format") != "duels-replay-v1":
        raise ReplayError("unsupported replay format")
    if type(replay.get("perspective")) is not int or replay["perspective"] not in (1, 2) or not replay.get("gameId"):
        raise ReplayError("missing game ID or player perspective")
    snapshot = deepcopy(replay["baseSnapshot"])
    logs = replay["logs"]
    cursor = replay["baseSnapshotLogCount"]
    if not isinstance(logs, list) or type(cursor) is not int or not 0 <= cursor <= len(logs):
        raise ReplayError("invalid base log cursor")
    validate_snapshot(snapshot, replay["perspective"])
    required_zones = {(side, zone) for side in ("myPlayer", "opponent")
                      for zone in ("hand", "field", "items", "discard", "inkwell", "deckCount", "handCount")
                      if zone in snapshot[side]}
    snapshot_id = snapshot.get("id")
    yield {"seq": 0, "actionType": "BASE_SNAPSHOT"}, snapshot, []
    for seq, frame in enumerate(replay["frames"], 1):
        end = frame["logCountAfter"]
        if type(frame["seq"]) is not int or frame["seq"] != seq or type(end) is not int or not cursor <= end <= len(logs):
            raise ReplayError(f"invalid sequence or log cursor at frame {seq}")
        try:
            patch_snapshot(snapshot, frame["patch"])
            if snapshot["turnNumber"] != frame["turnNumber"]:
                raise ReplayError("turn number differs from frame")
            if snapshot.get("id") != snapshot_id:
                raise ReplayError("snapshot identity changed")
            validate_snapshot(snapshot, replay["perspective"], required_zones)
        except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
            raise ReplayError(f"frame {seq}: {error}") from error
        yield frame, snapshot, logs[cursor:end]
        cursor = end
    if cursor != len(logs):
        raise ReplayError("unreferenced entries at end of log")


def chance_to_draw(population, outs, draws):
    """Probability of at least one out in random draws without replacement."""
    if not 0 <= outs <= population or not 0 <= draws <= population:
        raise ReplayError("draws and outs must fit in the deck")
    return 1 - comb(population - outs, draws) / comb(population, draws)


def count_visible_cards(cards, visible):
    for card in cards:
        if card.get("hidden") or card.get("facedown"):
            continue
        if card.get("id"):
            visible[card["id"]] += 1
        count_visible_cards(card.get("cardsUnder") or [], visible)


def draw_outs(snapshot, decklist, out_ids, draws):
    """Bound draw coverage using zone visibility and the registered deck counts."""
    if not isinstance(decklist, list) or not decklist or any(
        not isinstance(card, str) or not card for card in decklist
    ):
        raise ReplayError("missing or invalid own decklist")
    deck = Counter(decklist)
    if not out_ids or set(out_ids) - deck.keys():
        raise ReplayError("out IDs must be present in the registered own decklist")
    player = snapshot["myPlayer"]
    visible = Counter()
    for zone in ("hand", "field", "items", "discard"):
        count_visible_cards(player[zone], visible)
    count_visible_cards(
        (slot["card"] for slot in player["inkwell"] if not slot.get("hidden") and slot.get("card")),
        visible,
    )
    remaining = deck - visible
    size = player["deckCount"]
    if type(size) is not int or size < 0 or visible - deck or size > remaining.total():
        raise ReplayError("decklist and visible zones cannot be reconciled")
    unknown_outside = remaining.total() - size
    candidates = sum(remaining[card] for card in set(out_ids))
    low = max(0, candidates - unknown_outside)
    high = min(size, candidates)
    hand_outs = sum(card.get("id") in out_ids for card in player["hand"] if not card.get("hidden"))
    return {
        "assumption": "uniform random draws without replacement; candidate outs supplied by caller",
        "deck_count": size,
        "unknown_copies_outside_deck": unknown_outside,
        "draws": draws,
        "candidate_copies_already_in_hand": hand_outs,
        "draw_out_copies": [low, high],
        "draw_probability_bounds": [chance_to_draw(size, low, draws), chance_to_draw(size, high, draws)],
    }


def board_evidence(snapshot):
    evidence = {}
    for side in ("myPlayer", "opponent"):
        player = snapshot[side]
        evidence[side] = {
            zone: {(card.get("instanceId"), card.get("id")) for card in cards if card.get("instanceId")}
            for zone, cards in (
                ("hand", player.get("hand", [])),
                ("board", player.get("field", []) + player.get("items", [])),
                ("discard", player.get("discard", [])),
                ("inkwell", [slot["card"] for slot in player.get("inkwell", []) if slot.get("card")]),
            )
        }
    return evidence


def disruption_counts(entries, perspective, before=None, after=None):
    """Attribute the affected seat using explicit role or matching zone evidence."""
    impacts = Counter()
    for entry in entries:
        if entry.get("undone"):
            continue
        data = entry.get("data") or {}
        event, origin = entry["type"], data.get("fromZone")
        if event == "CARD_DISCARDED" and origin == "hand":
            category, zone, removed = "hand_discard", "discard", False
        elif event == "CARD_DESTROYED":
            category, zone, removed = "banish", "discard", False
        elif event == "CARD_RETURNED":
            category, zone, removed = "return_to_hand", "board", True
        elif event == "CARD_PUT_INTO_INKWELL" and origin in ("field", "items"):
            category, zone, removed = "board_to_ink", "board", True
        else:
            continue
        explicit = {value for value in (entry.get("affectedPlayer"), data.get("affectedPlayer"))
                    if type(value) is int and value in (1, 2)}
        affected = set()
        instance = entry.get("instanceId") or data.get("instanceId")
        card_id = data.get("cardId")
        if before is not None and (instance or card_id):
            for side, seat in (("myPlayer", perspective), ("opponent", 3 - perspective)):
                earlier, later = before[side][zone], after[side][zone]
                delta = earlier - later if removed else later - earlier
                if any(instance == uid if instance else card_id == cid for uid, cid in delta):
                    affected.add(seat)
        if len(explicit) == 1 and (not affected or affected == explicit):
            seat = next(iter(explicit))
        elif not explicit and len(affected) == 1:
            seat = next(iter(affected))
        else:
            seat = None
        side = "unknown" if seat is None else "own" if seat == perspective else "opponent"
        impacts[f"{side}.{category}"] += 1
    return impacts


def analyze(replay, at_seq=None, out_ids=(), draws=1, strength_context=None):
    perspective = replay["perspective"]
    if strength_context is not None and (at_seq is None or set(out_ids) != {STRENGTH_CARD_ID}):
        raise ReplayError("Strength response requires a frame and only the Strength print 2-201")
    impacts, timeline, episodes = Counter(), [], []
    estimate = None
    max_deficit = 0
    undos = 0
    summaries = {}
    superseded = set()
    before = None
    for frame, snapshot, entries in replay_frames(replay):
        seq, action = frame["seq"], frame["actionType"]
        own, opponent = lore_pair(snapshot)
        turn = snapshot["turnNumber"]
        checkpoint = (turn, snapshot.get("currentPlayer"), own, opponent)
        after = board_evidence(snapshot)
        resources = tuple((player.get("deckCount"), player.get("handCount"),
                           ready_ink(player["inkwell"]) if "inkwell" in player else None)
                          for player in (snapshot["myPlayer"], snapshot["opponent"]))
        undo_evidence = (checkpoint, after, resources)
        target = undo_target(action, seq)
        if target is not None:
            undos += 1
            superseded.update(range(target, seq))
            if undo_evidence != summaries[target - 1]["undo_evidence"]:
                raise ReplayError(f"undo at frame {seq} does not restore recorded turn, lore and zones")
        if seq == at_seq:
            if (snapshot["status"] != "playing" or snapshot["currentPlayer"] != perspective
                    or snapshot.get("pendingPrompts") or snapshot.get("opponentHasPendingPrompts")):
                raise ReplayError("outs require an own-turn frame with no unresolved prompt")
            estimate = draw_outs(snapshot, replay.get("decklist"), out_ids, draws)
            if strength_context is not None:
                estimate["strength_response"] = strength_response(snapshot, strength_context, estimate)
        frame_impacts = disruption_counts(entries, perspective, before, after)
        before = after
        compares_lore = (action == "END_TURN" and snapshot["status"] == "playing"
                         or action == "GAME_FINISH" and replay.get("victoryReason") == "lore")
        summaries[seq] = {"checkpoint": checkpoint, "undo_evidence": undo_evidence, "impacts": frame_impacts,
                          "compares_lore": compares_lore, "terminal": action == "GAME_FINISH"}

    if at_seq in superseded:
        raise ReplayError(f"requested frame {at_seq} was superseded by undo")
    episode = None
    for observed_seq, summary in summaries.items():
        if observed_seq in superseded:
            continue
        turn, _, own_lore, opposing_lore = summary["checkpoint"]
        frame_impacts = summary["impacts"]
        if frame_impacts:
            impacts.update(frame_impacts)
            timeline.append({"seq": observed_seq, "turn": turn, "observed": dict(frame_impacts)})
        if not summary["compares_lore"]:
            continue
        deficit = opposing_lore - own_lore
        max_deficit = max(max_deficit, deficit)
        if deficit > 0:
            if episode is None and summary["terminal"]:
                continue
            if episode is None:
                episode = {"start_seq": observed_seq, "peak_deficit": deficit}
                episodes.append(episode)
            episode["peak_deficit"] = max(episode["peak_deficit"], deficit)
        elif episode is not None:
            episode.update(recovered_seq=observed_seq, recovery="tie" if deficit == 0 else "lead")
            episode = None
    if at_seq is not None and estimate is None:
        raise ReplayError(f"requested frame {at_seq} does not exist")
    winner = snapshot.get("winner")
    reason = snapshot.get("victoryReason")
    if (snapshot.get("status") != "finished" or winner not in (1, 2)
            or winner != replay.get("winner") or reason != replay.get("victoryReason")
            or snapshot.get("turnNumber") != replay.get("turnCount")):
        raise ReplayError("reconstructed ending disagrees with replay metadata")
    winning_lore = own if winner == perspective else opponent
    if reason == "lore" and winning_lore < 20:
        raise ReplayError("lore winner did not reach 20 lore")
    for entry in replay["logs"]:
        if entry.get("type") != "GAME_END" or entry.get("undone"):
            continue
        data = entry.get("data") or {}
        expected = {"winner": winner, "victoryReason": reason, "newLoreTotal": winning_lore}
        if any(key in data and data[key] != value for key, value in expected.items()):
            raise ReplayError("reconstructed ending disagrees with GAME_END log")
    return {
        "game_id": replay["gameId"], "frames": seq, "logs": len(replay["logs"]),
        "undo_frames": undos, "superseded_frames": len(superseded), "own_lore": own, "opponent_lore": opponent,
        "own_victory": winner == perspective, "victory_reason": reason,
        "peak_lore_deficit": max_deficit, "lore_recovery_episodes": episodes,
        "observed_disruption": dict(impacts), "disruption_timeline": timeline,
        "outs_at_frame": estimate,
    }


def read_replays(path):
    if path.name.endswith(".zip"):
        with ZipFile(path) as archive:
            for member in archive.infolist():
                if member.filename.endswith(".replay.gz"):
                    yield json.loads(gzip.decompress(archive.read(member)))
    elif path.name.endswith((".replay.gz", ".logs.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            yield json.load(stream)
    elif path.suffix == ".json":
        yield json.loads(path.read_text(encoding="utf-8"))
    else:
        raise ReplayError("expected a .replay.gz, .logs.gz, .zip, or .json")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replays", nargs="+", type=Path)
    parser.add_argument("--game-id", help="select one game inside an archive")
    parser.add_argument("--at-seq", type=int, help="frame to evaluate using registered deck counts")
    parser.add_argument("--out-id", action="append", default=[], help="manually validated candidate out ID")
    parser.add_argument("--draws", type=int, default=1)
    parser.add_argument("--strength-context", type=Path, help="JSON evidence for Strength at the selected frame")
    args = parser.parse_args(argv)
    if (args.at_seq is None) != (not args.out_id):
        parser.error("--at-seq and --out-id must be used together")
    if args.at_seq is not None and (args.at_seq < 1 or args.draws < 1):
        parser.error("frame and draws must be positive")
    context = None
    if args.strength_context:
        if not args.game_id or set(args.out_id) != {STRENGTH_CARD_ID}:
            parser.error("--strength-context requires --game-id and --out-id 2-201")
        try:
            context = json.loads(args.strength_context.read_text(encoding="utf-8"))
            if not isinstance(context, dict):
                raise ValueError("expected an object")
        except (ValueError, OSError) as error:
            parser.error(f"invalid Strength context: {error}")
    results, partial, errors, seen = [], [], [], set()
    for path in args.replays:
        try:
            for replay in read_replays(path):
                try:
                    if not isinstance(replay, dict) or replay.get("format") != "duels-replay-v1":
                        observed = observer_summary(replay)
                        if args.game_id and observed["game_id"] != args.game_id:
                            continue
                        if args.at_seq is not None:
                            raise ReplayError("Observer input has observations only and cannot evaluate a frame")
                        partial.append(observed)
                        continue
                    if args.game_id and replay.get("gameId") != args.game_id:
                        continue
                    result = analyze(replay, args.at_seq, args.out_id, args.draws, context)
                    if result["game_id"] in seen:
                        raise ReplayError("duplicate replay game ID")
                    seen.add(result["game_id"])
                    results.append(result)
                except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
                    game_id = replay.get("gameId") if isinstance(replay, dict) else None
                    errors.append({"file": path.name, "game_id": game_id, "error": str(error)})
        except (KeyError, OSError, EOFError, ValueError, BadZipFile, TypeError, AttributeError) as error:
            errors.append({"file": path.name, "error": str(error)})
    if not results and not partial and not errors:
        errors.append({"error": "no matching replays"})
    print(json.dumps({"validated": len(results), "failed": len(errors), "games": results, "observer_inputs": partial, "errors": errors}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
