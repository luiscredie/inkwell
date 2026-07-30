import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "lorcana_image_agent.py"
SPEC = importlib.util.spec_from_file_location("lorcana_image_agent", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class LorcanaImageAgentTests(unittest.TestCase):
    def row(self, card_id, name="Maui - Demigod", set_code="LOR6", number="124"):
        return {
            MODULE.ID_COLUMN: card_id,
            MODULE.NAME_COLUMN: name,
            MODULE.SET_COLUMN: set_code,
            MODULE.NUMBER_COLUMN: number,
            MODULE.URL_COLUMN: "",
        }

    def test_missing_only_selects_manifest_gaps(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            (output / "images").mkdir()
            valid = output / "images" / "A.jpg"
            valid.write_bytes(b"\xff\xd8\xff" + b"x" * 128)
            rows = [self.row("A"), self.row("B")]
            manifest = {
                "A": {"image_file": "images/A.jpg", "image_url": "https://a"},
                "B": {"image_file": "", "image_url": ""},
            }
            pending = MODULE.rows_needing_art(rows, manifest, output)
            self.assertEqual([row[MODULE.ID_COLUMN] for row in pending], ["B"])

    def test_missing_local_file_is_recovered(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = [self.row("A")]
            manifest = {
                "A": {
                    "image_file": "images/A.jpg",
                    "image_url": "https://example.test/A.jpg",
                }
            }
            pending = MODULE.rows_needing_art(rows, manifest, Path(tmp))
            self.assertEqual(len(pending), 1)
            self.assertEqual(
                pending[0][MODULE.URL_COLUMN], "https://example.test/A.jpg"
            )

    def test_liga_requires_exact_name_and_number(self):
        row = self.row("D100-23", "Maui - Demigod (Alternate Art)", "D100", "23")
        html = """
        <meta property="og:title"
              content="Maui - Demigod (Alternate Art) (23) | Busca de Cartas">
        <meta property="og:image"
              content="https://www.ligalorcana.com.br/img/cards/D100-23.jpg">
        """
        self.assertEqual(
            MODULE.liga_image_from_page(html, row),
            "https://www.ligalorcana.com.br/img/cards/D100-23.jpg",
        )
        wrong = dict(row)
        wrong[MODULE.NUMBER_COLUMN] = "22"
        self.assertEqual(MODULE.liga_image_from_page(html, wrong), "")

    def test_partial_run_preserves_existing_manifest(self):
        rows = [self.row("A"), self.row("B")]
        existing = {
            "A": {
                "display_name": "Existing",
                "image_file": "images/A.jpg",
                "image_url": "https://official/A.jpg",
                "status": "skipped",
                "sha256": "abc",
            },
            "B": {"display_name": "Missing", "image_file": "", "image_url": ""},
            "C": {"display_name": "Outside --limit", "image_file": "images/C.jpg"},
        }
        result = MODULE.Result(
            "B", "Recovered", "https://www.ligalorcana.com.br/B.jpg",
            "images/B.jpg", "downloaded", 123, "def",
        )
        manifest, merged = MODULE.merge_manifest_results(
            rows, existing, [result], Path(".")
        )
        self.assertEqual(manifest["A"], existing["A"])
        self.assertEqual(manifest["B"]["source"], "ligalorcana")
        self.assertEqual(manifest["C"], existing["C"])
        self.assertEqual(len(merged), 2)

    def test_cards_json_uses_same_images_prefix_as_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            (output / "images").mkdir()
            image = output / "images" / "A.jpg"
            image.write_bytes(b"\xff\xd8\xff" + b"x" * 128)
            payload = {"cards": [{"card_id": "A", "image_file": "A.jpg"}]}
            index = {"A": payload["cards"][0]}
            manifest = {
                "A": {
                    "image_file": "images/A.jpg",
                    "image_url": "https://www.ligalorcana.com.br/A.jpg",
                    "source": "ligalorcana",
                }
            }
            changed = MODULE.reconcile_json_from_manifest(
                payload, index, manifest, output
            )
            self.assertGreater(changed, 0)
            self.assertEqual(payload["cards"][0]["image_file"], "images/A.jpg")
            self.assertEqual(
                payload["cards"][0]["image_source"], "ligalorcana"
            )


if __name__ == "__main__":
    unittest.main()
