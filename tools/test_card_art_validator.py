import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "validate_card_art.py"
SPEC = importlib.util.spec_from_file_location("validate_card_art", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class CardArtValidatorTests(unittest.TestCase):
    def make_repo(self, card, manifest, image_bytes=None):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / "data").mkdir()
        (root / "lorcana-card-images" / "images").mkdir(parents=True)
        (root / "data" / "cards.json").write_text(
            json.dumps({"cards": [card]}), encoding="utf-8"
        )
        (root / "lorcana-card-images" / "image_manifest.json").write_text(
            json.dumps({card["card_id"]: manifest}), encoding="utf-8"
        )
        if image_bytes is not None and card.get("image_file"):
            target = root / "lorcana-card-images" / card["image_file"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(image_bytes)
        return temp, root

    def test_valid_local_mapping_passes(self):
        image = b"\xff\xd8\xff\xe0" + b"test-jpeg"
        digest = hashlib.sha256(image).hexdigest()
        card = {
            "card_id": "LOR6-124",
            "image_file": "images/Maui_-_Half-Shark__LOR6-124.jpg",
            "image_url": "https://example.test/maui.jpg",
        }
        manifest = {
            "image_file": card["image_file"],
            "image_url": card["image_url"],
            "sha256": digest,
        }
        temp, root = self.make_repo(card, manifest, image)
        self.addCleanup(temp.cleanup)

        result = MODULE.validate(root)

        self.assertTrue(result.ok)
        self.assertEqual(result.local_files_ok, 1)

    def test_manifest_disagreement_fails(self):
        image = b"\xff\xd8\xff\xe0" + b"test-jpeg"
        card = {
            "card_id": "LOR9-242",
            "image_file": "images/Mickey.jpg",
            "image_url": "https://example.test/mickey.jpg",
        }
        manifest = {"image_file": "", "image_url": "", "sha256": ""}
        temp, root = self.make_repo(card, manifest, image)
        self.addCleanup(temp.cleanup)

        result = MODULE.validate(root)

        self.assertFalse(result.ok)
        self.assertTrue(
            any("image_file mismatch" in error for error in result.errors)
        )

    def test_true_pipeline_gap_is_counted_not_failed(self):
        card = {"card_id": "D100-23", "image_file": None, "image_url": None}
        manifest = {"image_file": "", "image_url": "", "sha256": ""}
        temp, root = self.make_repo(card, manifest)
        self.addCleanup(temp.cleanup)

        result = MODULE.validate(root)

        self.assertTrue(result.ok)
        self.assertEqual(result.pipeline_missing, 1)


if __name__ == "__main__":
    unittest.main()
