"""Deterministic fixture tests for tools/validate_release.py (M0R).

Builds tiny in-memory releases in a tmp dir; no production data copied.
    python3 -m unittest tools/test_validate_release.py
"""
import json
import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_release import validate_contract, Report  # noqa: E402

FIX = json.loads((Path(__file__).resolve().parent / "fixtures" / "contract.json").read_text())["valid"]


def write_release(tmp: Path, files: dict) -> None:
    for rel, doc in files.items():
        p = tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(doc if isinstance(doc, str) else json.dumps(doc))


def run(files: dict) -> Report:
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        write_release(tmp, files)
        r = Report()
        validate_contract(tmp, r, check_hashes=True)
        return r


class TestReleaseValidator(unittest.TestCase):
    def test_valid_passes(self):
        self.assertTrue(run(dict(FIX)).ok)

    def test_wrong_schema_fails(self):
        f = json.loads(json.dumps(FIX)); f["data/prices.json"]["schema_version"] = 9
        r = run(f); self.assertFalse(r.ok); self.assertTrue(any("schema_version" in e for e in r.errors))

    def test_unsafe_path_fails(self):
        f = json.loads(json.dumps(FIX)); f["data-manifest.json"]["artifacts"]["cards"]["path"] = "../secret.json"
        r = run(f); self.assertFalse(r.ok); self.assertTrue(any("unsafe" in e for e in r.errors))

    def test_duplicate_card_id_fails(self):
        f = json.loads(json.dumps(FIX)); c = f["data/cards.json"]["cards"][0]; f["data/cards.json"]["cards"] = [c, c]
        r = run(f); self.assertFalse(r.ok); self.assertTrue(any("duplicate" in e for e in r.errors))

    def test_orphan_price_warns(self):
        f = json.loads(json.dumps(FIX)); f["data/prices.json"]["prices"]["ZZ-1"] = {"n": 1}
        r = run(f); self.assertTrue(any("priced ids" in w for w in r.warnings))

    def test_malformed_history_fails(self):
        f = json.loads(json.dumps(FIX)); f["data/price-history.json"]["series"] = [{"date": "bad"}]
        r = run(f); self.assertFalse(r.ok); self.assertTrue(any("price_history" in e for e in r.errors))

    def test_optional_absent_ok(self):
        f = json.loads(json.dumps(FIX)); del f["data/price-history.json"]
        self.assertTrue(run(f).ok)

    def test_missing_required_fails(self):
        f = json.loads(json.dumps(FIX)); del f["data/prices.json"]
        r = run(f); self.assertFalse(r.ok)


if __name__ == "__main__":
    unittest.main()
