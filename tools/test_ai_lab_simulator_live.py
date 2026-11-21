"""Contract tests for safe full-game benchmark publication (no network calls)."""
import json
import unittest

import ai_lab_simulator_live as sim


class SimulatorMetricsTest(unittest.TestCase):
    def test_private_raw_games_never_published(self):
        source = {
            "options": {"seed": 20261121, "nodes": 50, "samples": 2, "games": 3,
                        "reference": "decks/meta-s14"},
            "decks": [{"name": "emerald-steel-current", "reference": False,
                       "cards": ["PRIVATE_DECK_CONTENT"]},
                      {"name": "detectives", "reference": True}],
            "jobs": [{"id": 0, "decks": [0, 1]},
                     {"id": 1, "decks": [1, 0]},
                     {"id": 2, "decks": [0, 1]}],
            "matchups": [{"a": 0, "b": 1, "games": [
                {"id": 0, "winner": 0, "private_trace": "SECRET_PLAYER"},
                {"id": 1, "winner": 0},
                {"id": 2, "error": "failed", "private_trace": "SECRET_GAME_ID"},
            ]}],
        }
        result = sim.report_summary(source)
        self.assertEqual(result["schema_version"], 1)
        self.assertEqual(result["summary"]["completed_games"], 3)
        self.assertEqual(result["summary"]["planned_games"], 3)
        self.assertEqual(result["summary"]["wins"], 1)
        self.assertEqual(result["summary"]["losses"], 1)
        self.assertEqual(result["summary"]["undecided"], 1)
        self.assertEqual(result["summary"]["errors"], 1)
        self.assertEqual(result["summary"]["matchups"], 1)
        row = result["matchups"][0]
        self.assertEqual(row["play_games"], 2)
        self.assertEqual(row["play_wins"], 1)
        self.assertEqual(row["draw_games"], 1)
        self.assertEqual(row["draw_wins"], 0)
        published = json.dumps(result)
        for forbidden in ("PRIVATE_DECK_CONTENT", "SECRET_PLAYER", "SECRET_GAME_ID",
                          "private_trace", "cards"):
            self.assertNotIn(forbidden, published)

    def test_running_counts_and_options(self):
        report = sim.running_payload("2026-11-21T08:00:00+00:00", 12, 100,
            ["decks/emerald-steel-current.deck", "--reference", "decks/meta-s14",
             "--games", "10", "--nodes", "40", "--samples", "2", "--seed", "37"])
        self.assertEqual(report["summary"]["completed_games"], 12)
        self.assertEqual(report["summary"]["planned_games"], 100)
        self.assertEqual(report["summary"]["matchups"], 10)
        self.assertEqual(report["run"]["target"], "emerald-steel-current")
        self.assertEqual(report["run"]["nodes"], 40)
        self.assertEqual(report["run"]["seed"], 37)

    def test_rejects_non_single_target(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            sim.report_summary({"decks": [{"name": "a", "reference": False},
                                         {"name": "b", "reference": False}]})
