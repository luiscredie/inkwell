"""Play a short, restorable match through the normal chat entry point."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from strategic_v4_sparring_cli import short_test_answer


@unittest.skipUnless(os.getenv("INKWELL_SPAR_ENGINE"), "real Sparring bundle required")
class DefensiveChatTests(unittest.TestCase):
    def test_new_game_records_the_policy_and_replays_its_turn_in_a_new_process(self):
        engine = Path(os.environ["INKWELL_SPAR_ENGINE"]).resolve()
        chat = Path(__file__).with_name("strategic_v4_sparring_chat.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "game.json"
            deck = root / "deck.txt"
            deck.write_text("60 Dalmatian Puppy - Tail Wagger\n")
            command = [sys.executable, str(chat), "--checkpoint", str(checkpoint), "--engine", str(engine)]

            def run(*args):
                return json.loads(subprocess.check_output([*command, *args], text=True))

            turn = run("start", "--seed", "309", "--human", str(deck), "--bot", str(deck))
            for _ in range(12):
                event = turn["next"]
                self.assertIsInstance(event["state"]["players"]["2"]["hand"], int)
                answer = short_test_answer(event["request"])
                turn = run("act", "--expected", turn["cursor"]["digest"], "--answer", json.dumps(answer))
                if turn["new_bot_reviews"]:
                    break
            self.assertTrue(turn["new_bot_reviews"])
            state = json.loads(checkpoint.read_text())
            self.assertTrue(state["defense_journal"])
            self.assertTrue(all("verdict" in row["decision"] for row in state["defense_journal"]))
            self.assertEqual(run("show"), turn)
            state["defense_journal"][0]["key"] = "different decision"
            checkpoint.write_text(json.dumps(state))
            replay = subprocess.run([*command, "show"], capture_output=True, text=True)
            self.assertNotEqual(replay.returncode, 0)
