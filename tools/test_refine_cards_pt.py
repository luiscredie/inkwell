import copy
import unittest

from tools.refine_cards_pt import apply_repairs, issue_codes, refine, validate_shape


class RefineCardsPtTests(unittest.TestCase):
    def test_translation_memory(self):
        en = "Rush (This character can challenge the turn they're played.)"
        pt = "Ímpeto (Este personagem pode desafiar a vez que eles são jogados.)"
        out, rules = apply_repairs(en, pt)
        self.assertEqual(
            out, "Ímpeto (Este personagem pode desafiar no turno em que é jogado.)"
        )
        self.assertIn("translation_memory", rules)

    def test_dynamic_keyword_translation_preserves_tokens(self):
        en = (
            "Boost 2 {i} (Once during your turn, you may pay 2 {i} to put the "
            "top card of your deck facedown under this character.)"
        )
        out, _ = apply_repairs(en, "texto ruim {i} {i}")
        self.assertEqual(en.count("{i}"), out.count("{i}"))
        self.assertIn("com a face para baixo", out)

    def test_common_machine_translation_repairs(self):
        en = "Whenever this character quests, draw a card."
        pt = "Sempre que este personagem fizer missão, desenhe uma carta."
        out, _ = apply_repairs(en, pt)
        self.assertEqual(
            out, "Sempre que este personagem buscar Lore, compre uma carta."
        )

    def test_issue_detector_flags_symbol_loss(self):
        self.assertIn(
            "game_token_mismatch",
            issue_codes("Pay 1 ⬡.", "Pague 1."),
        )

    def test_shape_validation_rejects_missing_card(self):
        en = {
            "cards": [
                {
                    "card_id": "A",
                    "abilities": [{"ability_id": "A-1", "text": "Draw a card."}],
                }
            ]
        }
        pt = {"cards": {}}
        self.assertTrue(validate_shape(en, pt))

    def test_refine_freezes_contract_fields(self):
        en = {
            "schema_version": 3,
            "cards": [
                {
                    "card_id": "A",
                    "abilities": [{"ability_id": "A-1", "text": "Draw a card."}],
                }
            ],
        }
        pt = {
            "schema_version": 1,
            "generated_at": "old",
            "language": "pt-BR",
            "cards": {
                "A": {
                    "ability_count": 1,
                    "source_fingerprint": "abc",
                    "abilities": [
                        {"ability_id": "A-1", "text": "Desenhe uma carta."}
                    ],
                }
            },
        }
        original_contract = copy.deepcopy(pt["cards"]["A"])
        out, report = refine(en, pt)
        self.assertEqual(out["schema_version"], 1)
        self.assertEqual(
            out["cards"]["A"]["source_fingerprint"],
            original_contract["source_fingerprint"],
        )
        self.assertEqual(out["cards"]["A"]["abilities"][0]["ability_id"], "A-1")
        self.assertEqual(out["cards"]["A"]["abilities"][0]["text"], "Compre uma carta.")
        self.assertEqual(report["counts"]["cards"], 1)


if __name__ == "__main__":
    unittest.main()
