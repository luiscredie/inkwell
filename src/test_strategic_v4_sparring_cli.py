import json
from pathlib import Path
import shutil
import tempfile
import unittest

from strategic_v4_sparring_cli import run_session, short_test_answer


# Exercises the production bridge and review client against a deterministic runner double.
FIXTURE = """
const secret = { fullName: "Synthetic hidden Circle", i: 7 };
const publicCard = { fullName: "Singer", i: 8 };
const action = (type, option, player, card) => ({ option, action: { type, player, card }, cost: [] });
const view = (player) => ({ turn: { number: player, player }, players: {
  1: { lore: 5, hand: [], play: [], inkwell: [] },
  2: { lore: 0, hand: [secret], play: [{ card: publicCard, exerted: false }], inkwell: [], discard: [] }
}});
export function parseDeckList() { return { cards: [{count: 1, fullName: "Fixture"}], problems: [] }; }
export function getCard() { return {}; }
export function validateDeck() { return { valid: true }; }
export function createBot() { return {
  observe() {},
  decide(_state, request) { return { type: "Action", option: request.actions[0].option }; }
}; }
export async function playGameAsync(seats) {
  const human = seats[0].controller, bot = seats[1].controller;
  await human.decide(view(1), { type: "Choose Cards", min: 0, max: 0, cards: [] });
  const outOfTurn = { type: "Action", actions: [action("End Turn", 0, 2)] };
  await bot.decide(view(1), outOfTurn);
  const answer = await human.decide(view(1), { type: "Action", actions: [action("End Turn", 0, 1)] });
  if (answer.option !== 0) throw new Error("bad synthetic input");
  const request = {type: "Action", actions: [action("End Turn", 0, 2), action("Ink", 1, 2, secret)]};
  await bot.decide(view(2), request);
  bot.observe({ state: view(1) });
  return { turns: [{}, {}], outcome: { winners: [1], reason: "Lore" } };
}
"""


@unittest.skipUnless(shutil.which("node"), "Node is required for the Sparring bridge")
class SparringEndToEndTests(unittest.TestCase):
    def test_synthetic_match_hides_hand_offers_ink_and_saves_provisional_feedback(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            engine, deck, annotations = (folder / n for n in ("engine.mjs", "sample.deck", "feedback.jsonl"))
            engine.write_text(FIXTURE, encoding="utf-8")
            deck.write_text("1 Example", encoding="utf-8")
            bridge = Path(__file__).resolve().parents[1] / "tools" / "strategic_v4_sparring_engine.mjs"
            chronology = []

            def answer(message):
                chronology.append("human")
                self.assertEqual(message["state"]["players"]["2"]["hand"], 1)
                self.assertNotIn("Synthetic hidden Circle", json.dumps(message))
                return short_test_answer(message["request"])

            def notify(message):
                chronology.append(message["type"])
                if message["type"] == "trainer_hand":
                    self.assertEqual(message["bot_hand"]["cards"], ["Synthetic hidden Circle"])

            def review(turn):
                chronology.append("review")
                self.assertEqual(turn["ink_decision"], "declined_when_available")
                self.assertEqual([a["type"] for a in turn["alternative_actions"]], ["End Turn", "Ink"])
                return {"rating": "bad", "reason": "Ink was available", "preferred_line": "Ink first"}

            output = run_session(["node", str(bridge), "--engine", str(engine), "--human", str(deck),
                                  "--bot", str(deck)], annotations, answer, review, notify)
            self.assertEqual(chronology, ["human", "human", "trainer_hand", "review", "finished"])
            self.assertEqual(output["turns"], 2)
            saved = json.loads(annotations.read_text(encoding="utf-8"))
            self.assertEqual(saved["feedback"]["status"], "provisional_human_label")
            self.assertFalse(saved["feedback"]["training_applied"])
            self.assertEqual(saved["ink_decision"], "declined_when_available")
            self.assertEqual(saved["feedback"]["preferred_line"], "Ink first")
            self.assertEqual(saved["simulated_alternatives"], 0)
