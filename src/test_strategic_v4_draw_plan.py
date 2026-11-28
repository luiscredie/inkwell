import unittest
from itertools import combinations
from strategic_v4_draw_plan import draw_plan


def position(hand=(), outside=0):
    return {"myPlayer": {"field": [], "items": [], "discard": [], "inkwell": [{}] * outside,
                         "hand": [{"id": x} for x in hand], "deckCount": 5 - len(hand) - outside}}


class DrawPlanTest(unittest.TestCase):
    def test_joint_bounds_against_all_decks_and_draws(self):
        deck = ["A", "A", "B", "C", "C"]
        for outside in range(4):
            size = 5 - outside
            for draws in range(size + 1):
                probabilities = []
                for population in combinations(deck, size):
                    possible = list(combinations(population, draws))
                    probabilities.append(sum({"A", "B"} <= set(x) for x in possible) / len(possible))
                result = draw_plan(position(outside=outside), deck, ["A", "B"], draws)
                self.assertEqual(result["hand_plus_draw_bounds"], [min(probabilities), max(probabilities)])

    def test_known_hand_and_hidden_order(self):
        deck = ["A", "A", "B", "C", "C"]
        frame = position(["A"])
        frame["myPlayer"]["deckOrder"] = ["B"] * 4
        frame["opponent"] = {"hand": [{"id": "B"}]}
        self.assertEqual(draw_plan(frame, deck, ["A", "B"], 1)["hand_plus_draw_bounds"], [.25, .25])
        result = draw_plan(position(["A", "B"]), deck, ["A", "B"], 0)
        self.assertEqual(result["hand_plus_draw_bounds"], [1, 1])
        self.assertIsNone(result["win_probability"])
        self.assertEqual(result["execution"], "unverified")


class ObserverSampleTest(unittest.TestCase):
    def test_limited_sample_includes_control_and_keeps_invalid_input_visible(self):
        import gzip
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from strategic_v4_field_audit import sample_observer
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for i in range(30):
                (root / f"{i:02d}.logs.gz").write_bytes(gzip.compress(b'[{"type":"TURN_START"}]'))
            (root / "11.logs.gz").write_bytes(gzip.compress(b'{}'))
            report = sample_observer(root, "11.logs.gz", 8)
            self.assertEqual((report["available"], report["sampled"], report["unreadable"]), (30, 8, 1))
            self.assertEqual(report["event_logs"], 7)
            self.assertEqual(report["status"], "partial")

    def test_empty_directory_never_counts_as_validation(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from strategic_v4_field_audit import sample_observer
        with TemporaryDirectory() as tmp:
            self.assertEqual(sample_observer(Path(tmp))["status"], "unavailable")
