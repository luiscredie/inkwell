from copy import deepcopy
import unittest

from strategic_v4_recovery import opponent_resource_use, prior_public_cards, recorded_decisions, threat_persistence


THREAT = {"id": "print", "instanceId": "same", "name": "Threat", "type": "character", "lore": 2, "damage": 0}


def state(seat=2, threat=None, status="playing"):
    return {"currentPlayer": seat, "status": status, "myPlayer": {"lore": 4, "field": []},
            "opponent": {"lore": 0, "field": [threat] if threat else [], "inkwell": [], "handCount": 2}}


class RecoveryTests(unittest.TestCase):
    def test_return_captures_window_without_claim_of_lore_prevention(self):
        snapshots = {1: state(), 2: state(), 3: state(1), 4: state(1, THREAT)}
        snapshots[2]["myPlayer"]["lore"] = snapshots[3]["myPlayer"]["lore"] = 5
        logs = {1: [], 2: [], 3: [], 4: [
            {"type": "CHOICE_RESOLVED", "player": 1, "data": {
                "choice": {"sourceCardName": "Recovery", "selectedInstanceIds": ["same"]},
            }},
        ]}
        result = threat_persistence(1, THREAT, 2, snapshots, logs, {})
        self.assertEqual(result["return"], {"frame": 4, "damage": 0, "source_card": "Recovery"})
        self.assertEqual(result["handoffs_while_absent"], 1)
        self.assertEqual(result["complete_opponent_turns_while_absent"], 0)
        self.assertEqual(result["change_while_absent"]["own_lore"], 1)
        self.assertIsNone(result["actual_lore_prevented"])

    def test_new_copy_and_undone_return_do_not_end_absence(self):
        snapshots = {1: state(), 2: state(1), 3: state(1, THREAT), 4: state(1, {**THREAT, "instanceId": "new"}),
                     5: state(2), 6: state(2, status="finished")}
        result = threat_persistence(1, THREAT, 2, snapshots, {i: [] for i in snapshots}, {3: 4})
        self.assertEqual(result["status"], "absent_through_game_end")
        self.assertEqual(result["complete_opponent_turns_while_absent"], 1)
        self.assertIsNone(result["return"])

    def test_hidden_unidentifiable_card_censors_persistence(self):
        snapshots = {1: state(), 2: state(1, {"hidden": True}), 3: state(2, status="finished")}
        result = threat_persistence(1, THREAT, 2, snapshots, {i: [] for i in snapshots}, {})
        self.assertEqual(result["status"], "visibility_gap")
        self.assertEqual(result["last_observed_absent_frame"], 1)

    def test_public_evidence_excludes_hidden_ink_undone_and_future_cards(self):
        snapshots = {i: state() for i in range(5)}
        snapshots[1]["opponent"]["inkwell"] = [{"hidden": False, "card": {"id": "one"}}]
        snapshots[2]["opponent"]["inkwell"] = snapshots[1]["opponent"]["inkwell"] + [
            {"hidden": True, "card": {"id": "two"}},
        ]
        rows = {1: [{"type": "CARD_INKED", "player": 1, "data": {"cardId": "one", "cardName": "Visible"}}],
                2: [{"type": "CARD_INKED", "player": 1, "data": {"cardId": "two", "cardName": "Concealed"}}],
                3: [{"type": "CARD_PLAYED", "player": 1, "data": {"cardName": "Undone"}}],
                4: [{"type": "CARD_PLAYED", "player": 1, "data": {"cardName": "Future"}}]}
        self.assertEqual(prior_public_cards(4, 2, snapshots, rows, {3: 4}), [
            {"frame": 1, "card": "Visible", "event": "CARD_INKED"},
        ])

    def test_resources_keep_observed_ink_change_separate_from_payment_log(self):
        snapshots = {1: state(1), 2: state(1)}
        snapshots[1]["opponent"]["inkwell"] = [{"exerted": False}] * 4
        snapshots[2]["opponent"]["inkwell"] = [{"exerted": True}] * 4
        log = {2: [{"type": "CARD_PLAYED", "player": 1, "data": {"cardName": "Action"}}]}
        event = opponent_resource_use(1, 2, 2, snapshots, log, {})[0]
        self.assertEqual(event["ready_ink_at_frame"], [4, 0])
        self.assertIsNone(event["ink_paid_logged"])

    def test_decision_reports_position_and_effect_as_separate_observations(self):
        snapshots = {1: state(), 2: state(), 3: state(1), 4: state(), 5: state()}
        snapshots[2]["myPlayer"]["lore"] = 5
        snapshots[4]["myPlayer"]["lore"] = snapshots[5]["myPlayer"]["lore"] = 5
        frames = {i: {"player": 2, "actionType": "UNDO", "takenAction": {}} for i in snapshots}
        frames[2].update(actionType="QUEST", takenAction={"type": "QUEST"})
        frames[5].update(actionType="PLAY_CARD")
        result = recorded_decisions(1, 2, snapshots, frames, {}, 4)
        self.assertEqual(result["next_recorded_own_decision"]["change_since_removal"]["own_lore"], 0)
        self.assertEqual(result["next_recorded_own_decision"]["immediate_change_after_decision"]["own_lore"], 1)
        self.assertEqual(result["first_decision_after_opponent_turn"]["frame"], 5)
