from copy import deepcopy
from itertools import combinations
import unittest

from strategic_v4_replay import (
    ReplayError, analyze, chance_to_draw, disruption_counts, draw_outs, patch_snapshot,
)


def sample_replay():
    base = {
        "viewingAs": 2, "status": "playing", "turnNumber": 1, "currentPlayer": 2,
        "myPlayer": {"lore": 0}, "opponent": {"lore": 0},
    }
    frames = []
    for seq, own, opp, action in (
        (1, 2, 5, "END_TURN"),
        (2, 8, 5, "QUEST"),
        (3, 2, 5, "FREE_UNDO:2"),
        (4, 5, 5, "END_TURN"),
        (5, 5, 20, "GAME_FINISH"),
    ):
        patch = [
            {"op": "replace", "path": "/myPlayer/lore", "value": own},
            {"op": "replace", "path": "/opponent/lore", "value": opp},
        ]
        if seq == 5:
            patch.extend([
                {"op": "replace", "path": "/status", "value": "finished"},
                {"op": "replace", "path": "/winner", "value": 1},
                {"op": "replace", "path": "/victoryReason", "value": "lore"},
            ])
        frames.append({"seq": seq, "logCountAfter": 0, "turnNumber": 1, "actionType": action, "patch": patch})
    return {
        "format": "duels-replay-v1", "gameId": "example", "perspective": 2,
        "winner": 1, "victoryReason": "lore", "turnCount": 1,
        "baseSnapshot": base, "baseSnapshotLogCount": 0, "frames": frames, "logs": [],
    }


class ReplayTests(unittest.TestCase):
    def test_patch_replaces_missing_object_key_and_preserves_patch_inputs(self):
        state = {"a/b": {"~list": ["x", "y"]}}
        operations = [
            {"op": "add", "path": "/a~1b/~0list/1", "value": {"b": [1]}},
            {"op": "replace", "path": "/a~1b/~0list/1/b/0", "value": 2},
            {"op": "remove", "path": "/a~1b/~0list/0"},
            {"op": "replace", "path": "/a~1b/new", "value": 42},
        ]
        patch_snapshot(state, operations)
        self.assertEqual(state, {"a/b": {"~list": [{"b": [2]}, "y"], "new": 42}})
        self.assertEqual(operations[0]["value"], {"b": [1]})

    def test_invalid_array_position_fails(self):
        with self.assertRaises(ReplayError):
            patch_snapshot({"cards": [0]}, [{"op": "remove", "path": "/cards/-1"}])

    def test_lore_recovery_requires_completed_turn_and_preserves_input(self):
        replay = sample_replay()
        original = deepcopy(replay)
        report = analyze(replay)
        self.assertFalse(report["own_victory"])
        self.assertEqual(report["undo_frames"], 1)
        self.assertEqual(report["lore_recovery_episodes"], [
            {"start_seq": 1, "peak_deficit": 3, "recovered_seq": 4, "recovery": "tie"},
        ])
        self.assertEqual(replay, original)

    def test_reconstruction_checks_metadata_and_log_cursor(self):
        replay = sample_replay()
        replay["winner"] = 2
        with self.assertRaisesRegex(ReplayError, "ending disagrees"):
            analyze(replay)
        replay["frames"][1]["logCountAfter"] = 1
        with self.assertRaisesRegex(ReplayError, "log cursor at frame 2"):
            analyze(replay)

    def test_disruption_uses_target_seat_and_excludes_undone_and_other_zones(self):
        rows = [
            {"type": "CARD_DISCARDED", "affectedPlayer": 2, "data": {"fromZone": "hand"}},
            {"type": "CARD_DISCARDED", "player": 2, "data": {"fromZone": "deck"}},
            {"type": "CARD_DESTROYED", "player": 1, "undone": True},
            {"type": "CARD_PUT_INTO_INKWELL", "affectedPlayer": 1, "data": {"fromZone": "field"}},
        ]
        self.assertEqual(disruption_counts(rows, 2), {"own.hand_discard": 1, "opponent.board_to_ink": 1})


class OutsTests(unittest.TestCase):
    def test_formula_matches_enumeration(self):
        for outs in range(6):
            for draws in range(6):
                samples = list(combinations(range(5), draws))
                hit = sum(any(card < outs for card in sample) for sample in samples)
                self.assertAlmostEqual(chance_to_draw(5, outs, draws), hit / len(samples))

    def test_bounds_use_visible_zones_and_ignore_future_order(self):
        snapshot = {"myPlayer": {
            "hand": [{"id": "A"}], "field": [{"id": "B", "cardsUnder": [{"id": "A"}]}],
            "items": [], "discard": [], "inkwell": [{"hidden": True, "card": {"id": "A"}}],
            "deckCount": 4, "deckOrder": ["A", "B", "C", "D"],
        }}
        deck = ["A"] * 4 + ["B", "C", "D", "E"]
        report = draw_outs(snapshot, deck, ["A", "A"], 2)
        self.assertEqual(report["candidate_copies_already_in_hand"], 1)
        self.assertEqual(report["draw_out_copies"], [1, 2])
        self.assertEqual(report["draw_probability_bounds"], [0.5, 1 - 1 / 6])
        snapshot["myPlayer"]["deckOrder"] = ["E", "D", "C", "B"]
        self.assertEqual(draw_outs(snapshot, deck, ["A"], 2), report)

    def test_inconsistent_visible_copies_and_unavailable_draws_fail(self):
        snapshot = {"myPlayer": {
            "hand": [{"id": "A"}], "field": [], "items": [], "discard": [],
            "inkwell": [], "deckCount": 2,
        }}
        with self.assertRaisesRegex(ReplayError, "cannot be reconciled"):
            draw_outs(snapshot, ["A", "B"], ["A"], 1)
        with self.assertRaisesRegex(ReplayError, "must fit"):
            draw_outs(snapshot, ["A", "B", "C"], ["A"], 3)


if __name__ == "__main__":
    unittest.main()
