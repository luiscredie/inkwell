"""Tests for stop gate; proof that early stopping only affects an experiment."""
import tempfile
import unittest
from pathlib import Path

from ai_lab_plateau_guard import plateau


def fixture(path, count, promo_index=None, last_delta=0.04):
    lines = ["Hora local\tEpisódios acumulados\tPromoção\tDiferença proxy\tIC95 inferior"]
    for i in range(count):
        delta = last_delta if i >= count - 30 else 0.02
        lines.append(f"2026-11-20T21:00:00-03:00\t{(i+1)*5000}\t{str(i==promo_index)}\t{delta}\t0.01")
    path.write_text("\n".join(lines)+"\n")


class PlateauTest(unittest.TestCase):
    def test_initial_patience(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "metrics.tsv"
            fixture(p, 149)
            self.assertFalse(plateau(p)[0])
            fixture(p, 151)
            self.assertTrue(plateau(p)[0])

    def test_after_promotion_patience(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "metrics.tsv"
            fixture(p, 105, promo_index=1)
            self.assertTrue(plateau(p)[0])
            fixture(p, 70, promo_index=1)
            self.assertFalse(plateau(p)[0])

    def test_possible_new_improvement_continues(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "metrics.tsv"
            fixture(p, 151, last_delta=0.12)
            self.assertFalse(plateau(p)[0])


if __name__ == "__main__":
    unittest.main()
