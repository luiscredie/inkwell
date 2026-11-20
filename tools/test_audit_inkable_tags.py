import io, json, tempfile, unittest
from contextlib import redirect_stdout
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_inkable_tags as a


class AuditInkableTags(unittest.TestCase):
    CARDS = [
        {"card_id": "LOR11-89", "name_en": "White Rabbit", "inkable": 1, "tags": "character; evasive; uninkable"},
        {"card_id": "LOR12-86", "name_en": "Elinor", "inkable": 0, "tags": "character; uninkable"},
        {"card_id": "LOR1-1", "name_en": "Plain", "inkable": 1, "tags": "character; inkable"},
        {"card_id": "LOR1-2", "name_en": "Odd", "inkable": 0, "tags": "character; inkable"},
        {"card_id": "LOR1-3", "name_en": "No tags", "inkable": 1, "tags": ""},
        {"card_id": "LOR1-4", "name_en": "Word inside", "inkable": 1, "tags": "character; uninkable-ish trait"},
    ]

    def test_finds_only_real_disagreements(self):
        got = {c["card_id"]: k for c, k in a.disagreements(self.CARDS)}
        self.assertEqual(got, {"LOR11-89": "inkable=1, tag uninkable", "LOR1-2": "inkable=0, tag inkable"})

    def test_never_writes_the_catalog(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "cards.json"
            p.write_text(json.dumps({"cards": self.CARDS}), encoding="utf-8")
            before = p.read_bytes()
            with redirect_stdout(io.StringIO()):
                a.main(["--cards", str(p)])
                a.main(["--cards", str(p), "--csv"])
            self.assertEqual(p.read_bytes(), before)
            self.assertEqual(sorted(x.name for x in Path(d).iterdir()), ["cards.json"])

    def test_csv_has_one_row_per_disagreement(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "cards.json"
            p.write_text(json.dumps({"cards": self.CARDS}), encoding="utf-8")
            buf = io.StringIO()
            with redirect_stdout(buf):
                a.main(["--cards", str(p), "--csv"])
            self.assertEqual(len(buf.getvalue().strip().splitlines()), 1 + 2)


if __name__ == "__main__":
    unittest.main()
