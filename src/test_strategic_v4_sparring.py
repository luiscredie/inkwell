import unittest
from copy import deepcopy
from strategic_v4_sparring import evaluate_emergency, evaluate_setup, prepare_sparring_review


def turn():
    return {
        "game_id": "synthetic-game", "decision_id": "t6-opponent", "human_turn_locked": True,
        "bot_hand": {"source": "engine", "cards": ["circle", "other"]},
        "bot_actions": [
            {"type": "ink", "card_id": None, "declined": True, "source": "engine"},
            {"type": "play", "card_id": "circle", "target": "don", "source": "replay"},
        ],
        "alternative_actions": [{"type": "hold", "source": "human_hypothesis"}],
        "context": {"human_lore": 5, "bot_lore": 0, "phillip_in_discard": None,
                    "malicious_in_hand": None, "sequence_legal_now": None},
    }


def feedback():
    return {"rating": "bad", "reason": "Spend Circle only for a useful board swing; setup Phillip first",
            "preferred_line": "Malicious and Phillip when legal"}


class SparringReviewTests(unittest.TestCase):
    def test_feedback_is_provisional_and_not_training(self):
        t, f = turn(), feedback()
        originals = deepcopy((t, f))
        r = prepare_sparring_review(t, f)
        self.assertEqual(r["feedback"]["human_rating"], "bad")
        self.assertFalse(r["feedback"]["training_applied"])
        self.assertEqual(r["strategic_ranking"], "inconclusive")
        self.assertIsNone(r["win_probability"])
        self.assertEqual(r["simulated_alternatives"], 0)
        self.assertEqual((t, f), originals)

    def test_no_hidden_hand_leak_before_human_moves(self):
        t = turn()
        t["human_turn_locked"] = False
        with self.assertRaisesRegex(ValueError, "before human turn"):
            prepare_sparring_review(t, feedback())

    def test_hand_unknown_is_not_invented(self):
        t = turn()
        t["bot_hand"] = None
        r = prepare_sparring_review(t, feedback())
        self.assertIsNone(r["bot_hand"])
        self.assertIn("bot_hand_not_verified", r["missing_evidence"])

    def test_hand_requires_verifiable_source(self):
        t = turn()
        t["bot_hand"]["source"] = "guess"
        with self.assertRaisesRegex(ValueError, "source"):
            prepare_sparring_review(t, feedback())

    def test_hypothesis_does_not_become_legal_or_simulated(self):
        r = prepare_sparring_review(turn(), feedback())
        self.assertFalse(r["alternative_actions"][0]["legal_confirmed"])
        self.assertFalse(r["alternative_actions"][0]["simulated"])
        self.assertIn("some_alternatives_not_legally_verified", r["missing_evidence"])

    def test_engine_enumeration_is_legal_but_not_simulated(self):
        t = turn()
        t["alternative_actions"][0]["source"] = "engine"
        r = prepare_sparring_review(t, feedback())
        self.assertTrue(r["alternative_actions"][0]["legal_confirmed"])
        self.assertFalse(r["alternative_actions"][0]["simulated"])

    def test_ink_declined_is_recorded_distinct_from_ink_paid(self):
        r = prepare_sparring_review(turn(), feedback())
        self.assertEqual(r["bot_actions"][0]["type"], "ink")
        self.assertTrue(r["bot_actions"][0]["declined"])
        self.assertIsNone(r["bot_actions"][0]["card_id"])

    def test_requires_a_reason_and_known_rating(self):
        for entry in ({"rating": "bad", "reason": " "}, {"rating": "great", "reason": "yes"}):
            with self.assertRaises(ValueError):
                prepare_sparring_review(turn(), entry)

    def test_19_lore_alone_does_not_prove_emergency(self):
        self.assertEqual(evaluate_emergency({"human_lore": 19})["status"], "unverified")

    def test_emergency_requires_engine_evidence_and_only_defense(self):
        c = {"human_lore": 19, "immediate_lethal_threat": True,
             "selected_line_prevents_lethal": True, "only_legal_defense": True}
        self.assertEqual(evaluate_emergency(c)["status"], "declared_emergency_needs_engine_validation")
        c["defense_evidence"] = "engine"
        self.assertEqual(evaluate_emergency(c)["status"], "confirmed_emergency_exception")
        c["only_legal_defense"] = False
        self.assertEqual(evaluate_emergency(c)["status"], "specific_exception_not_supported")

    def test_combo_remains_hypothesis_when_hand_or_discard_unknown(self):
        self.assertEqual(evaluate_setup(turn()["context"])["status"], "setup_hypothesis_unverified")

    def test_combo_needs_verified_sequence(self):
        c = dict(phillip_in_discard=True, malicious_in_hand=True, sequence_legal_now=True)
        self.assertEqual(evaluate_setup(c)["status"], "setup_hypothesis_unverified")
        c["sequence_evidence"] = "engine"
        self.assertEqual(evaluate_setup(c)["status"], "legal_candidate_not_simulated")
        c["malicious_in_hand"] = False
        self.assertEqual(evaluate_setup(c)["status"], "not_available_now")

    def test_emergency_and_bad_can_coexist_as_feedback_and_caveat(self):
        t = turn()
        t["context"].update({"human_lore": 19, "immediate_lethal_threat": True,
                              "selected_line_prevents_lethal": True, "only_legal_defense": True,
                              "defense_evidence": "engine"})
        r = prepare_sparring_review(t, feedback())
        self.assertEqual(r["feedback"]["human_rating"], "bad")
        self.assertEqual(r["checks"]["emergency"]["status"], "confirmed_emergency_exception")
        self.assertEqual(r["strategic_ranking"], "inconclusive")


if __name__ == "__main__":
    unittest.main()
