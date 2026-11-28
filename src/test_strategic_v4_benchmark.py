import unittest

from strategic_v4_benchmark import strength_alternatives
from strategic_v4_outs import evaluate_strength


class StrengthDecisionTests(unittest.TestCase):
    def setUp(self):
        self.state = {
            "myPlayer": {"inkwell": [{"exerted": False}] * 3, "field": [
                {"instanceId": "singer", "type": "character", "exerted": False, "justPlayed": False, "cost": 3},
                {"instanceId": "drying", "type": "character", "exerted": False, "justPlayed": True, "cost": 2},
            ]},
            "opponent": {"field": [{"instanceId": "target", "type": "character", "damage": 1}]},
        }
        self.context = {"target_instance_id": "target", "play_legal": True, "target_legal": True,
                        "paying_ink_legal": True, "eligible_singer_ids": [], "damage_reduction": 0,
                        "target_effective_willpower": 3}

    def test_strength_paid_with_three_ink(self):
        result = evaluate_strength(self.state, self.context)
        self.assertTrue(result["resources"]["can_pay"])
        self.assertFalse(result["resources"]["can_sing"])
        self.assertEqual(result["status_as_banishment"], "confirmed_at_frame")
        self.assertNotIn("candidate_draw_probability_bounds", result)

    def test_strength_sung_with_no_ink(self):
        self.state["myPlayer"]["inkwell"] = []
        self.context["eligible_singer_ids"] = ["singer"]
        result = evaluate_strength(self.state, self.context)
        self.assertFalse(result["resources"]["can_pay"])
        self.assertTrue(result["resources"]["can_sing"])
        self.assertTrue(result["damage"]["lethal"])

    def test_strength_protected_target_is_illegal_even_if_potentially_lethal(self):
        self.context["target_legal"] = False
        result = evaluate_strength(self.state, self.context)
        self.assertFalse(result["target_legal"])
        self.assertTrue(result["damage"]["lethal"])
        self.assertEqual(result["status_as_banishment"], "blocked")

    def test_strength_can_be_playable_but_insufficient_to_banish(self):
        self.context["target_effective_willpower"] = 4
        result = evaluate_strength(self.state, self.context)
        self.assertTrue(result["target_legal"])
        self.assertTrue(result["resources"]["can_use"])
        self.assertFalse(result["damage"]["lethal"])
        self.assertEqual(result["status_as_banishment"], "blocked")


class ChoiceEvidenceTests(unittest.TestCase):
    def test_offered_and_undone_targets_are_not_simulations(self):
        alternate = {"recorded_damage": 3, "banishment_logged": False}
        result = {candidate["target"]: candidate for candidate in strength_alternatives(
            {"validTargets": ["chosen", "reverted", "untested"]},
            {"target": "chosen"}, {"reverted": alternate, "elsewhere": alternate},
        )}
        self.assertEqual(set(result), {"reverted", "untested"})
        self.assertEqual(result["reverted"]["evidence"], "observed_then_undone")
        self.assertEqual(result["reverted"]["immediate_result"], alternate)
        self.assertEqual(result["untested"]["evidence"], "offered_hypothesis")
        self.assertTrue(all(not candidate["simulated"] for candidate in result.values()))

    def test_inconsistent_prompt_does_not_confirm_alternatives(self):
        self.assertEqual(strength_alternatives({"validTargets": ["other"]}, {"target": "actual"}, {}), [])
