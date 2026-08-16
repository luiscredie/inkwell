import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from tools.build_pages_artifact import build_pages_artifact


def write(path: Path, value: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


class BuildPagesArtifactTests(unittest.TestCase):
    def fixture(self) -> tuple[Path, Path]:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        source = base / "site"
        output = base / "public"
        write(source / "index.html", "<!doctype html>")
        write(source / "support.js")
        write(source / "data/prices.json", "{}")
        write(source / "data/ligalorcana-prices.json", "private pipeline cache")
        write(source / "index.html.bak", "old shell")
        write(source / "lorcana-card-images/images/keep.jpg")
        write(source / "lorcana-card-images/images/orphan.jpg")
        write(
            source / "data/cards.json",
            json.dumps({
                "cards": [{
                    "card_id": "A",
                    "image_file": "images/keep.jpg",
                }]
            }),
        )
        return source, output

    def test_build_keeps_runtime_and_removes_pipeline_files_and_orphans(self):
        source, output = self.fixture()
        result = build_pages_artifact(source, output)
        self.assertTrue((output / "index.html").is_file())
        self.assertTrue((output / "support.js").is_file())
        self.assertTrue((output / "data/prices.json").is_file())
        self.assertTrue((output / "lorcana-card-images/images/keep.jpg").is_file())
        self.assertFalse((output / "data/ligalorcana-prices.json").exists())
        self.assertFalse((output / "index.html.bak").exists())
        self.assertFalse((output / "lorcana-card-images/images/orphan.jpg").exists())
        self.assertEqual(result["orphan_images_removed"], 1)
        self.assertEqual(result["referenced_images_missing"], 0)

    def test_output_cannot_overlap_the_source(self):
        source, _ = self.fixture()
        with self.assertRaisesRegex(ValueError, "separate, non-nested"):
            build_pages_artifact(source, source / "public")

    def test_image_optimization_only_changes_the_public_copy(self):
        source, output = self.fixture()
        original = source / "lorcana-card-images/images/keep.jpg"
        Image.new("RGB", (1468, 2048), (120, 40, 80)).save(
            original, format="JPEG", quality=95
        )
        original_bytes = original.read_bytes()

        result = build_pages_artifact(source, output, optimize_images=True)
        public_image = output / "lorcana-card-images/images/keep.jpg"
        with Image.open(public_image) as optimized:
            self.assertLessEqual(optimized.width, 734)
            self.assertLessEqual(optimized.height, 1024)
        self.assertEqual(original.read_bytes(), original_bytes)
        self.assertEqual(result["images_seen"], 1)
        self.assertEqual(result["images_optimized"], 1)
        self.assertLess(result["image_bytes_after"], result["image_bytes_before"])


if __name__ == "__main__":
    unittest.main()
