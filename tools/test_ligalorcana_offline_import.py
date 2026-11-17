"""Testes isolados do importador (sem rede e sem dependências externas)."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("liga_offline", Path(__file__).with_name("ligalorcana_offline_import.py"))
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

CAPTURE = "2026-11-17T16:58:00Z"
URL = "https://www.ligalorcana.com.br/?view=cards/card&card=A%20Dark%20Age%20No%20More%20(162)&ed=LOR14&num=162"
CATALOG = {"records": [
    {"id": "LOR14-162", "edicao": "LOR14", "numero": "162", "nome_base": "A Dark Age No More", "url": URL},
    {"id": "LOR14-205", "edicao": "LOR14", "numero": "205", "nome_base": "No Offers"},
    {"id": "Q1-223--yen-sid", "edicao": "Q1", "numero": "223", "nome_base": "Yen Sid - Powerful Sorcerer"},
    {"id": "Q1-223--piglet", "edicao": "Q1", "numero": "223", "nome_base": "Piglet - Pooh Pirate Captain"},
]}
DETAIL = {"_fonte": URL, "_capturado_em": CAPTURE, "cards_editions": [{
    "idcard": 3230, "id": 9, "idkey": "9_162", "code": "LOR14", "num": "162",
    "price": {"0": {"p": "4.60", "m": "5.54", "g": "10.00"},
              "2": {"p": "7.80", "m": "10.00", "g": "10.90"},
              "3": {"p": "100", "m": "200", "g": "300"}},
}]}


class PriceTests(unittest.TestCase):
    def test_real_lor14_162(self):
        self.assertEqual({"status": "ok", "min_centavos": 460, "med_centavos": 554, "max_centavos": 1000},
                         mod.finish(DETAIL["cards_editions"][0]["price"]["0"]))
        self.assertEqual({"status": "ok", "min_centavos": 780, "med_centavos": 1000, "max_centavos": 1090},
                         mod.finish(DETAIL["cards_editions"][0]["price"]["2"]))

    def test_absent_vs_no_offer(self):
        self.assertEqual({"status": "sem_oferta"}, mod.finish([]))
        self.assertEqual({"status": "campo_ausente"}, mod.finish(None))

    def test_unsafe_prices_rejected(self):
        for bad in ("0.00", "-1", "NaN", "Infinity", "1.005", "9999999", "abc"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                mod.cents(bad)
        with self.assertRaisesRegex(ValueError, "inconsistentes"):
            mod.finish({"p": "10", "m": "9", "g": "15"})
        with self.assertRaisesRegex(ValueError, "incompleta"):
            mod.finish({"p": "2", "m": "3"})

    def test_timestamp_must_be_real_and_aware(self):
        for bad in (None, "", "2026-11-17T16:58:00", "ontem"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                mod.iso(bad)
        self.assertEqual("2026-11-17T16:58:00+00:00", mod.iso(CAPTURE))


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog_file = self.write("catalog.json", CATALOG)
        self.detail_file = self.write("detail.json", DETAIL)
        self.catalog = mod.build_catalog(CATALOG)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, data):
        path = self.root / name
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return path

    def test_full_offline_flow_and_partial_history(self):
        snapshots, problems = mod.import_data(self.catalog, [self.detail_file], None)
        self.assertFalse(problems)
        report = mod.write_outputs(self.root / "out", self.catalog, snapshots, problems)
        self.assertEqual(["2026-11-17"], report["dias"])
        data = json.loads((self.root / "out/precos/2026-11-17.json").read_text())
        self.assertFalse(data["publicavel"])
        self.assertEqual(4, len(data["registros"]))
        row = next(r for r in data["registros"] if r["numero"] == "162")
        self.assertEqual([3230, 9, "162"], [row["liga_card_id"], row["liga_edicao_id"], row["numero"]])
        self.assertEqual("LOR14-162", row["inkwell_card_id"])
        self.assertEqual(780, row["foil"]["min_centavos"])
        untouched = next(r for r in data["registros"] if r["numero"] == "205")
        self.assertEqual("nao_coletado", untouched["normal"]["status"])
        self.assertIsNone(untouched["capturado_em"])
        with self.assertRaises(FileExistsError):
            mod.write_outputs(self.root / "out", self.catalog, snapshots, problems)
        self.assertEqual(["2026-11-17"], json.loads((self.root / "out/historico/index.json").read_text())["dias"])

    def test_no_offer_finish_real_case(self):
        doc = {"_capturado_em": CAPTURE, "cards_editions": [{"idcard": 3354, "id": 9, "code": "LOR14", "num": "205",
                "price": {"0": {"p": "2", "m": "3", "g": "4"}, "2": []}}]}
        file = self.write("nofoil.json", doc)
        data, errors = mod.import_data(self.catalog, [file], None)
        self.assertFalse(errors)
        row = next(iter(data["2026-11-17"].values()))
        self.assertEqual("sem_oferta", row["foil"]["status"])

    def test_collision_requires_card_name(self):
        doc = {"_capturado_em": CAPTURE, "cards_editions": [{"idcard": 700, "id": 10, "code": "Q1", "num": "223", "price": {"0": []}}]}
        file = self.write("collision.json", doc)
        data, issues = mod.import_data(self.catalog, [file], None)
        self.assertFalse(data)
        self.assertIn("ambígua", issues[0]["erro"])
        doc["_fonte"] = "https://www.ligalorcana.com.br/?card=Yen%20Sid%20-%20Powerful%20Sorcerer%20(223)&ed=Q1&num=223"
        file = self.write("collision_named.json", doc)
        data, issues = mod.import_data(self.catalog, [file], None)
        self.assertFalse(issues)
        self.assertEqual("Q1-223--yen-sid", next(iter(data["2026-11-17"].values()))["inkwell_card_id"])

    def test_catalog_id_mismatch_prevents_import(self):
        cardsjson = {"cardsjson": [{"id": 3230, "idE": 9, "sSigla": "LOR14", "sN": "162", "nEN": "A Dark Age No More (162)"}]}
        catalog = mod.build_catalog(cardsjson)
        bad = {**DETAIL, "cards_editions": [{**DETAIL["cards_editions"][0], "idcard": 999}]}
        file = self.write("bad_id.json", bad)
        data, issues = mod.import_data(catalog, [file], None)
        self.assertFalse(data)
        self.assertIn("não corresponde", issues[0]["erro"])

    def test_duplicate_same_day_rejected(self):
        data, issues = mod.import_data(self.catalog, [self.detail_file, self.detail_file], None)
        self.assertEqual(1, len(issues))
        self.assertIn("duplicada", issues[0]["erro"])
        self.assertEqual(1, len(data["2026-11-17"]))

    def test_future_schema_csv_and_missing_finish(self):
        file = self.root / "data.csv"
        file.write_text("liga_card_id;liga_edicao_id;edicao;numero;nome;captured_at;n_min;n_med;n_max;f_status\n"
                        "3230;9;LOR14;162;A Dark Age No More;2026-11-17T16:58:00Z;4.60;5.54;10.00;sem_oferta\n")
        data, issues = mod.import_data(self.catalog, [file], None)
        self.assertFalse(issues)
        row = next(iter(data["2026-11-17"].values()))
        self.assertEqual("sem_oferta", row["foil"]["status"])
        self.assertEqual(554, row["normal"]["med_centavos"])

    def test_reject_wrong_host_source(self):
        bad = {**DETAIL, "_fonte": "https://example.com/cart?card=Foo"}
        file = self.write("bad_source.json", bad)
        data, issues = mod.import_data(self.catalog, [file], None)
        self.assertFalse(data)
        self.assertIn("não é HTTPS", issues[0]["erro"])


if __name__ == "__main__":
    unittest.main()
