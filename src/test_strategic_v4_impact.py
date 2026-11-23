from copy import deepcopy
import unittest

from strategic_v4_impact import board_impact, observed_followup, undo_equivalence


def sample_state(active=1):
    zones = {"field": [], "items": [], "discard": [], "inkwell": [], "deckCount": 27, "lore": 4}
    character = {"type": "character", "instanceId": "defender", "name": "Defender", "damage": 0, "lore": 2}
    return {
        "currentPlayer": active, "turnNumber": 6, "status": "playing", "pendingPrompts": [],
        "opponentHasPendingPrompts": False, "turnGateState": {},
        "myPlayer": {**deepcopy(zones), "hand": [{"id": "card-1"}]},
        "opponent": {**deepcopy(zones), "field": [character], "handCount": 3},
    }


class ImpactTests(unittest.TestCase):
    def test_equal_snapshot_covers_recorded_state_only(self):
        start = sample_state()
        result = undo_equivalence(start, deepcopy(start))
        self.assertEqual(result["status"], "matches_recorded_state")
        self.assertEqual(result["different_fields"], [])
        self.assertIn("hidden engine state not verified", result["scope"])

    def test_same_prompt_cannot_hide_changed_damage_ink_hand_or_effect(self):
        start = sample_state()
        start["pendingPrompts"] = [{"id": "prompt"}]
        for key, value, replacement in (
            ("opponent.field", ["field", 0, "damage"], 1),
            ("myPlayer.inkwell", ["inkwell"], [{"exerted": True}]),
            ("myPlayer.hand", ["hand", 0, "id"], "changed"),
            ("turnGateState", [], {"counters": 1}),
        ):
            with self.subTest(key=key):
                changed = deepcopy(start)
                if value:
                    node = changed[key.split(".")[0]]
                    for part in value[:-1]:
                        node = node[part]
                    node[value[-1]] = replacement
                else:
                    changed[key] = replacement
                self.assertEqual(undo_equivalence(start, changed)["different_fields"], [key])

    def test_identical_snapshots_missing_hand_or_effect_are_inconclusive(self):
        start = sample_state()
        start["myPlayer"]["hand"] = None
        del start["turnGateState"]
        result = undo_equivalence(start, deepcopy(start))
        self.assertEqual(result["status"], "insufficient_recorded_state")
        self.assertCountEqual(result["missing_fields"], ["turnGateState", "myPlayer.hand"])

    def test_damage_does_not_count_as_removal_and_return_to_hand_does_not_count_as_banishment(self):
        start = sample_state()
        changed = deepcopy(start)
        changed["opponent"]["field"][0]["damage"] = 2
        self.assertEqual(board_impact(start, changed)["opponent"]["banished_snapshot_lore"], 0)
        card = changed["opponent"]["field"].pop()
        changed["opponent"]["hand"] = [card]
        impact = board_impact(start, changed)["opponent"]
        self.assertEqual(impact["confirmed_banishments"], [])
        self.assertEqual(impact["other_visible_departures"], ["Defender"])

    def test_followup_excludes_undo_and_tracks_return_by_instance_through_next_turn(self):
        start = sample_state()
        banished = deepcopy(start)
        banished["opponent"]["discard"].append(banished["opponent"]["field"].pop())
        gained = sample_state(active=2)
        gained["myPlayer"]["lore"] = 20
        opp_turn = deepcopy(banished)
        opp_turn["currentPlayer"] = 2
        back_in_play = sample_state(active=2)
        own_turn = sample_state(active=1)
        end_turn = sample_state(active=2)
        snapshots = dict(enumerate((start, banished, gained, opp_turn, back_in_play, own_turn, end_turn)))
        entries = {seq: [] for seq in snapshots}
        entries[2] = [{"type": "CARD_QUEST", "data": {"loreGained": 16}}]
        report = observed_followup(1, 1, snapshots, entries, {2: 3})
        self.assertEqual({key: value["frame"] for key, value in report["checkpoints"].items()}, {
            "start_of_opponent_turn": 3, "start_of_next_own_turn": 5, "end_of_next_own_turn": 6,
        })
        self.assertEqual(report["events"], [])
        self.assertEqual(report["same_instances_returned"], [
            {"frame": 4, "side": "opponent", "card": "Defender", "damage": 0},
        ])
        self.assertEqual(board_impact(start, banished)["opponent"]["banished_snapshot_lore"], 2)

    def test_terminal_checkpoint_does_not_invent_next_own_turn(self):
        start = sample_state()
        finish = {**sample_state(active=1), "status": "finished"}
        report = observed_followup(1, 1, {0: start, 1: start, 2: finish}, {2: []}, {})
        self.assertEqual(list(report["checkpoints"]), ["game_finished"])
