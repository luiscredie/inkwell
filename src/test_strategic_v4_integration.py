import contextlib
import gzip
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from strategic_v4_observer import observer_summary
from strategic_v4_outs import resource_routes, strength_response
from strategic_v4_replay import ReplayError, analyze, board_evidence, disruption_counts, main
from test_strategic_v4_replay import sample_replay


class ReplayRegressions(unittest.TestCase):
    def test_detects_corrupt_intermediate_seat_even_with_valid_ending(self):
        replay = sample_replay()
        replay["frames"][0]["patch"].append({"op": "replace", "path": "/viewingAs", "value": 1})
        replay["frames"][1]["patch"].append({"op": "replace", "path": "/viewingAs", "value": 2})
        with self.assertRaisesRegex(ReplayError, r"frame 1: snapshot perspective"):
            analyze(replay)

    def test_detects_missing_intermediate_zone(self):
        replay = sample_replay()
        replay["baseSnapshot"]["myPlayer"]["inkwell"] = []
        replay["frames"][0]["patch"].append({"op": "remove", "path": "/myPlayer/inkwell"})
        with self.assertRaisesRegex(ReplayError, "previously recorded zone is missing"):
            analyze(replay)

    def test_rejects_undo_that_restores_lore_but_not_zone(self):
        replay = sample_replay()
        replay["baseSnapshot"]["myPlayer"]["field"] = []
        replay["frames"][1]["patch"].append({"op": "add", "path": "/myPlayer/field/0",
                                             "value": {"instanceId": "card", "id": "sample"}})
        with self.assertRaisesRegex(ReplayError, "undo at frame 3 does not restore"):
            analyze(replay)

    def test_superseded_events_do_not_count_without_log_undo_marker(self):
        replay = sample_replay()
        replay["logs"] = [
            {"type": "CARD_DESTROYED", "affectedPlayer": 1},
            {"type": "CARD_DESTROYED", "affectedPlayer": 2},
        ]
        for frame, end in zip(replay["frames"], [1, 2, 2, 2, 2]):
            frame["logCountAfter"] = end
        report = analyze(replay)
        self.assertEqual(report["observed_disruption"], {"opponent.banish": 1})
        self.assertEqual(report["superseded_frames"], 1)

    def test_unknown_undo_target_is_rejected(self):
        replay = sample_replay()
        for action in ("FREE_UNDO", "FREE_UNDO:3", "UNDO_CHOICE:not-a-number"):
            with self.subTest(action=action):
                replay["frames"][2]["actionType"] = action
                with self.assertRaisesRegex(ReplayError, "invalid undo target"):
                    analyze(replay)

    def test_zone_delta_overrules_generic_player_but_not_conflicting_victim(self):
        previous = board_evidence({"myPlayer": {}, "opponent": {}})
        current = board_evidence({"myPlayer": {}, "opponent": {
            "discard": [{"instanceId": "target", "id": "card"}],
        }})
        entries = [
            {"type": "CARD_DESTROYED", "player": 2, "instanceId": "target"},
            {"type": "CARD_DESTROYED", "affectedPlayer": 2, "instanceId": "target"},
            {"type": "CARD_RETURNED", "player": 2},
        ]
        self.assertEqual(disruption_counts(entries, 2, previous, current),
                         {"opponent.banish": 1, "unknown.banish": 1, "unknown.return_to_hand": 1})


class StrengthIntegrationTests(unittest.TestCase):
    def setUp(self):
        singer = {"type": "character", "id": "card", "instanceId": "singer",
                  "exerted": False, "justPlayed": False, "cost": 3}
        self.snapshot = {
            "myPlayer": {"inkwell": [{"exerted": False}] * 3, "field": [
                singer, {**singer, "instanceId": "new", "justPlayed": True},
                {**singer, "instanceId": "exerted", "exerted": True},
            ]},
            "opponent": {"field": [{"type": "character", "instanceId": "target", "damage": 1}]},
        }
        self.context = {"target_instance_id": "target", "play_legal": True, "target_legal": True,
                        "paying_ink_legal": True, "eligible_singer_ids": [],
                        "damage_reduction": 0, "target_effective_willpower": 4}
        self.estimate = {"draw_probability_bounds": [0.1, 0.2]}

    def test_ink_payment_and_lethal_includes_all_own_characters(self):
        result = strength_response(self.snapshot, self.context, self.estimate)
        self.assertEqual(result["status_if_drawn_at_frame"], "confirmed_at_frame")
        self.assertTrue(result["resources"]["can_pay"])
        self.assertEqual(result["damage"]["raw"], 3)
        self.assertEqual(result["legal_lethal_candidate_draw_bounds_at_fixed_frame"], [0.1, 0.2])

    def test_calls_local_contract_to_check_singing_route(self):
        self.snapshot["myPlayer"]["inkwell"] = []
        self.context["eligible_singer_ids"] = ["singer"]
        calls = []

        def check_route(**kwargs):
            calls.append(kwargs)
            return resource_routes(**kwargs)

        engine = SimpleNamespace(strength_playability=check_route)
        with patch.dict(sys.modules, {"strategic_adaptation": engine}):
            result = strength_response(self.snapshot, self.context, self.estimate)
        self.assertEqual(calls, [{"available_ink": 0, "eligible_singers": 1}])
        self.assertEqual(result["engine"], "strategic_adaptation")
        self.assertFalse(result["resources"]["can_pay"])
        self.assertTrue(result["resources"]["can_sing"])

    def test_drying_or_exerted_character_cannot_be_listed_as_eligible(self):
        for candidate in ("new", "exerted"):
            self.context["eligible_singer_ids"] = [candidate]
            with self.subTest(candidate=candidate), self.assertRaisesRegex(ValueError, "ready, dry"):
                strength_response(self.snapshot, self.context, self.estimate)

    def test_singer_must_meet_effective_cost(self):
        self.snapshot["myPlayer"]["field"][0]["cost"] = 2
        self.context["eligible_singer_ids"] = ["singer"]
        with self.assertRaisesRegex(ValueError, "effective cost"):
            strength_response(self.snapshot, self.context, self.estimate)
        self.context["effective_singer_costs"] = {"singer": 4}
        result = strength_response(self.snapshot, self.context, self.estimate)
        self.assertTrue(result["resources"]["can_sing"])

    def test_resist_or_illegal_target_blocks_the_response(self):
        for context in ({**self.context, "damage_reduction": 1}, {**self.context, "target_legal": False}):
            with self.subTest(context=context):
                result = strength_response(self.snapshot, context, self.estimate)
                self.assertEqual(result["status_if_drawn_at_frame"], "blocked")
                self.assertEqual(result["legal_lethal_candidate_draw_bounds_at_fixed_frame"], [0, 0])
                self.assertEqual(result["candidate_draw_probability_bounds"], [0.1, 0.2])

    def test_unknown_legality_stays_conditional(self):
        self.context["target_legal"] = None
        result = strength_response(self.snapshot, self.context, self.estimate)
        self.assertEqual(result["status_if_drawn_at_frame"], "conditional")
        self.assertEqual(result["legal_lethal_candidate_draw_bounds_at_fixed_frame"], [0, 0.2])

    def test_mismatched_local_contract_fails_explicitly(self):
        engine = SimpleNamespace(strength_playability=lambda **_: {"can_use": True})
        with patch.dict(sys.modules, {"strategic_adaptation": engine}):
            with self.assertRaisesRegex(ValueError, "contract mismatch"):
                strength_response(self.snapshot, self.context, self.estimate)


class ObserverAdapterTests(unittest.TestCase):
    def test_reads_gzip_list_as_actions_with_no_state_or_perspective(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.logs.gz"
            with gzip.open(path, "wt", encoding="utf-8") as stream:
                json.dump([{"type": "CARD_PLAYED", "player": 1}, {"type": "QUEST", "undone": True}], stream)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main([str(path)]), 0)
            report = json.loads(output.getvalue())
            self.assertEqual(report["validated"], 0)
            self.assertEqual(report["observer_inputs"][0]["actions"], {"CARD_PLAYED": 1})
            self.assertIn("no_confirmed_perspective", report["observer_inputs"][0]["limitations"])
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main([str(path), "--at-seq", "1", "--out-id", "sample"]), 1)
            self.assertIn("cannot evaluate a frame", output.getvalue())

    def test_reads_partial_observer_turn_report_without_inventing_opponent_turns(self):
        report = observer_summary({"game_id": "synthetic", "first_10_own_turns": [
            {"actions": [{"kind": "play"}]}, {},
        ]})
        self.assertEqual(report["sides"], {"own": {"observed_turns": 2, "turns_with_actions": 1,
                                                   "action_counts": {"play": 1}}})
        self.assertIn("no_outs", report["limitations"])

    def test_rejects_unknown_json_shape(self):
        with self.assertRaisesRegex(ValueError, "unrecognized"):
            observer_summary({"format": "different_data"})
