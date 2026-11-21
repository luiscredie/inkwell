"""Contract tests for public-safe RL metrics export (no external services)."""
import json
import tempfile
import unittest
from pathlib import Path

import ai_lab_metrics as metrics


class DashboardMetricsTest(unittest.TestCase):
    def test_aggregate_no_private_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            p = root / "results.tsv"
            p.write_text(
                "Hora local\tEpisódios acumulados\tPromoção\tDiferença proxy\tIC95 inferior\n"
                "2026-11-20T21:00:00-03:00\t2200\tFalse\t0.035\t0.01\n"
                "2026-11-20T21:01:00-03:00\t7200\tTrue\t0.12\t0.04\n"
                "2026-11-20T21:00:30-03:00\t12200\tFalse\t-0.01\t-0.03\n"
                "MALFORMED\tsecret-player-name\tFalse\t0\t0\n",
                encoding="utf-8",
            )
            (root / "sync_status.json").write_text(json.dumps({
                "total_games": 400, "archived_gamelogs": 350,
                "token": "SECRET_DO_NOT_EXPOSE", "opponent_name": "PRIVATE_USER",
            }))
            (root / "observer_quality.json").write_text(json.dumps({
                "eligible_game_ids": ["PRIVATE_ID_1", "PRIVATE_ID_2"],
            }))
            rows, invalid, anomalies = metrics.read_rows(p)
            doc = metrics.build_document(rows, root, invalid, anomalies)
            self.assertEqual(doc["summary"]["episodes"], 12200)
            self.assertEqual(doc["summary"]["promotions"], 1)
            self.assertEqual(doc["summary"]["plateau_batches"], 1)
            self.assertEqual(doc["summary"]["anomalous_timestamps"], 1)
            self.assertEqual(doc["data_quality"]["observer_eligible"], 2)
            output = json.dumps(doc)
            for forbidden in ("PRIVATE_USER", "PRIVATE_ID", "SECRET_DO_NOT_EXPOSE",
                              str(root), "deck_hash", "game_id", "token"):
                self.assertNotIn(forbidden, output)

    def test_bad_metrics_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "results.tsv"
            p.write_text("header\n2026-11-20\tfoo\tTrue\tnan\tinf\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                metrics.read_rows(p)

    def test_unknown_status_is_null(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(metrics.optional_count(Path(folder) / "missing.json", "x"))


if __name__ == "__main__":
    unittest.main()
