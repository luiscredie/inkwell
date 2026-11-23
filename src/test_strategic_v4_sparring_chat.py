from copy import deepcopy
from pathlib import Path
import shutil
import tempfile
import unittest

from strategic_v4_sparring_chat import BRIDGE, new_checkpoint, stream_checkpoint
from strategic_v4_sparring_cli import short_test_answer
from test_strategic_v4_sparring_cli import FIXTURE


@unittest.skipUnless(shutil.which("node"), "Node is required for checkpoint replay")
class CheckpointTests(unittest.TestCase):
    def test_restart_preserves_exact_prompt_and_bot_turn_review(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = Path(folder) / "engine.mjs"
            engine.write_text(FIXTURE, encoding="utf-8")
            checkpoint = new_checkpoint(20261123, "1 Example", "1 Example", engine, BRIDGE)
            cursor, event, reviews, hands = stream_checkpoint(checkpoint, engine, BRIDGE)
            self.assertEqual((reviews, hands), ([], []))
            checkpoint["cursor"] = cursor
            for _ in range(2):
                old = deepcopy(checkpoint)
                self.assertEqual(stream_checkpoint(checkpoint, engine, BRIDGE)[0:2], (cursor, event))
                answer = short_test_answer(event["request"])
                next_cursor, next_event, reviews, hands = stream_checkpoint(checkpoint, engine, BRIDGE, answer)
                self.assertEqual(checkpoint, old)
                checkpoint["history"].append({"before": cursor["digest"], "answer": answer})
                checkpoint["cursor"] = cursor = next_cursor
                event = next_event
            self.assertEqual(event["type"], "finished")
            self.assertEqual(len(reviews), 1)
            self.assertEqual(len(hands), 1)
            self.assertEqual(stream_checkpoint(checkpoint, engine, BRIDGE), (cursor, event, reviews, hands))

            invalid = deepcopy(checkpoint)
            invalid["history"][0]["before"] = "tampered"
            with self.assertRaisesRegex(ValueError, "did not replay identically"):
                stream_checkpoint(invalid, engine, BRIDGE)
            invalid = deepcopy(checkpoint)
            invalid["runtime"]["node"] = "unverified"
            with self.assertRaisesRegex(ValueError, "runtime differs"):
                stream_checkpoint(invalid, engine, BRIDGE)
