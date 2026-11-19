"""Fast isolated safety regression tests for LigaLorcana incremental publication."""
import json
import tempfile
import unittest
from pathlib import Path

from ligalorcana_publish_incremental import apply, completed_editions, valid_finish


def dump(path, obj):
    path.write_text(json.dumps(obj), encoding="utf-8")


def rec(code, number, name, normal=(100, 200, 300), foil=(50, 80, 100)):
    row = {"code": code, "num": str(number), "edition_id": "16",
           "idcard": str(number), "name": name,
           "captured_at": "2026-11-18T23:00:00Z"}
    for finish, data in (("normal", normal), ("foil", foil)):
        row[finish + "_status"] = "ok" if data else "missing"
        if data:
            for suffix, value in zip(("min", "med", "max"), data):
                row[finish + "_" + suffix + "_centavos"] = value
    return row


class PublishSafetyTest(unittest.TestCase):
    def test_complete_requires_count_and_no_failures(self):
        base = {"records": [rec("LOR10", 1, "Card A")],
                "editionAudit": {"LOR10": {"queued_urls": 1, "captured_urls": 1, "failed_urls": 0}}}
        accepted, excluded = completed_editions(base)
        self.assertIn("LOR10", accepted)
        base["editionAudit"]["LOR10"]["failed_urls"] = 1
        accepted, excluded = completed_editions(base)
        self.assertNotIn("LOR10", accepted)
        self.assertIn("LOR10", excluded)

    def test_average_above_maximum_is_valid(self):
        row = rec("LOR10", 1, "Card A", normal=(89099, 98250, 97500))
        row["normal_status"] = "invalid_order"  # legacy collector
        values = valid_finish(row, "normal")
        self.assertEqual(values, {"nl": 890.99, "n": 982.5, "nh": 975.0})
        row["normal_status"] = "ok"  # corrected collector
        self.assertEqual(valid_finish(row, "normal"), values)

    def test_invalid_price_order_refused(self):
        row = rec("LOR10", 1, "Card A", normal=(300, 200, 100))
        self.assertIsNone(valid_finish(row, "normal"))

    def test_partial_preserves_existing_and_does_not_update(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = folder / "captures"
            source.mkdir()
            dump(folder / "cards.json", {"cards": [
                {"id": "LOR10-1", "name_en": "Card A"},
                {"id": "LOR10-2", "name_en": "Card B"},
                {"id": "LOR11-1", "name_en": "Card C"}]})
            dump(folder / "prices.json", {
                "schema_version": 2,
                "prices": {"LOR10-2": {"n": 50, "nl": 45, "nh": 55},
                           "LOR11-1": {"n": 33, "nl": 30, "nh": 35}},
                "liga_prices": {}})
            dump(folder / "history.json", {"schema_version": 1, "series": []})
            dump(source / "coleta_2026-11-18T23-00-00-000Z.json", {
                "schema": "inkwell-ligalorcana-local-v1",
                "exported_at": "2026-11-18T23:00:00Z",
                "total": 2,
                "records": [rec("LOR10", 1, "Card A"), rec("LOR11", 1, "Card C")],
                "editionAudit": {
                    "LOR10": {"queued_urls": 1, "captured_urls": 1, "failed_urls": 0},
                    "LOR11": {"queued_urls": 2, "captured_urls": 1, "failed_urls": 1}},
                "pending": []})
            report = apply(source, folder / "cards.json", folder / "prices.json",
                           folder / "history.json", folder / "report.json")
            result = json.loads((folder / "prices.json").read_text())
            self.assertEqual(result["prices"]["LOR10-1"]["n"], 2)
            self.assertEqual(result["prices"]["LOR10-2"]["n"], 50)
            self.assertEqual(result["prices"]["LOR11-1"]["n"], 33)
            self.assertIn("LOR11", report["excluded_editions"])
            self.assertEqual(report["changed_cards"], 1)

    def test_name_mismatch_is_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = folder / "captures"
            source.mkdir()
            dump(folder / "cards.json", {"cards": [{"id": "LOR10-1", "name_en": "Card A"}]})
            dump(folder / "prices.json", {"schema_version": 2, "prices": {}})
            dump(folder / "history.json", {"schema_version": 1, "series": []})
            dump(source / "coleta_2026-11-18T23-00-00-000Z.json", {
                "schema": "inkwell-ligalorcana-local-v1",
                "exported_at": "2026-11-18T23:00:00Z",
                "total": 1, "records": [rec("LOR10", 1, "Incorrect Card")],
                "editionAudit": {"LOR10": {"queued_urls": 1, "captured_urls": 1, "failed_urls": 0}},
                "pending": []})
            report = apply(source, folder / "cards.json", folder / "prices.json",
                           folder / "history.json", folder / "report.json")
            self.assertEqual(report["changed_cards"], 0)
            self.assertEqual(json.loads((folder / "prices.json").read_text())["prices"], {})


if __name__ == "__main__":
    unittest.main()
