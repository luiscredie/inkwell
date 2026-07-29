import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tools.refresh_data_manifest import build_refreshed_manifest


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


class RefreshManifestTests(unittest.TestCase):
    def fixture(self) -> Path:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        write_json(root / "data/cards.json", {
            "schema_version": 3,
            "generated_at": "2026-07-28T00:00:00Z",
            "cards": [{"card_id": "A"}, {"card_id": "B"}],
        })
        write_json(root / "data/cards.pt.json", {
            "schema_version": 1,
            "generated_at": "2026-07-28T00:00:00Z",
            "cards": {"A": {}, "B": {}},
        })
        write_json(root / "data/prices.json", {
            "schema_version": 2,
            "generated_at": "2026-07-28T00:00:00Z",
            "prices": {"A": {}},
        })
        write_json(root / "data-manifest.json", {
            "manifest_version": 1,
            "schema": {"cards": 3, "cards_pt": 1, "prices": 2},
            "artifacts": {
                "cards": {"path": "data/cards.json"},
                "cards_pt": {"path": "data/cards.pt.json"},
                "prices": {"path": "data/prices.json"},
            },
        })
        return root

    def test_refreshes_hashes_sizes_counts_and_timestamp(self):
        root = self.fixture()
        result, summary = build_refreshed_manifest(
            root, generated_at="2026-07-28T12:00:00+00:00"
        )
        self.assertEqual(result["generated_at"], "2026-07-28T12:00:00+00:00")
        self.assertEqual(result["counts"], {
            "cards": 2, "pt_overlay_cards": 2, "priced_cards": 1
        })
        for entry in result["artifacts"].values():
            path = root / entry["path"]
            self.assertEqual(entry["bytes"], path.stat().st_size)
            self.assertEqual(entry["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(summary["artifacts"], ["cards", "cards_pt", "prices"])

    def test_schema_mismatch_fails_before_write(self):
        root = self.fixture()
        cards = json.loads((root / "data/cards.json").read_text())
        cards["schema_version"] = 99
        write_json(root / "data/cards.json", cards)
        with self.assertRaisesRegex(ValueError, "schema_version 99"):
            build_refreshed_manifest(root)

    def test_unsafe_path_is_rejected(self):
        root = self.fixture()
        manifest = json.loads((root / "data-manifest.json").read_text())
        manifest["artifacts"]["cards"]["path"] = "../cards.json"
        write_json(root / "data-manifest.json", manifest)
        with self.assertRaisesRegex(ValueError, "unsafe artifact path"):
            build_refreshed_manifest(root)


if __name__ == "__main__":
    unittest.main()
