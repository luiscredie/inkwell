"""load_set asks Lorcast again when the answer is cut short (the 14-15/11/2026 daily-price failures)."""
import http.client
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prices_from_lorcast as P  # noqa: E402


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Cut:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        raise http.client.IncompleteRead(b"[{", 10)


def _ok(cards):
    return _Resp(json.dumps(cards).encode("utf-8"))


class LoadSetRetry(unittest.TestCase):
    def setUp(self):
        self.sleep = mock.patch.object(P.time, "sleep").start()
        self.addCleanup(mock.patch.stopall)

    def test_answer_cut_short_is_asked_again(self):
        with mock.patch.object(P.urllib.request, "urlopen", side_effect=[_Cut(), _ok([{"name": "Elsa"}])]) as u:
            self.assertEqual(P.load_set("1", None), [{"name": "Elsa"}])
            self.assertEqual(u.call_count, 2)

    def test_dropped_connection_and_5xx_are_asked_again(self):
        err = urllib.error.HTTPError("u", 503, "busy", None, None)
        with mock.patch.object(P.urllib.request, "urlopen", side_effect=[urllib.error.URLError("reset"), err, _ok([])]) as u:
            self.assertEqual(P.load_set("2", None), [])
            self.assertEqual(u.call_count, 3)

    def test_gives_up_after_the_last_try_without_writing_anything(self):
        with mock.patch.object(P.urllib.request, "urlopen", side_effect=[_Cut() for _ in range(P.RETRIES)]) as u:
            with self.assertRaises(RuntimeError):
                P.load_set("3", None)
            self.assertEqual(u.call_count, P.RETRIES)

    def test_a_404_is_not_retried(self):
        err = urllib.error.HTTPError("u", 404, "no such set", None, None)
        with mock.patch.object(P.urllib.request, "urlopen", side_effect=[err]) as u:
            with self.assertRaises(urllib.error.HTTPError):
                P.load_set("zz", None)
            self.assertEqual(u.call_count, 1)

    def test_saved_folder_does_not_touch_the_network(self):
        with mock.patch.object(P.urllib.request, "urlopen") as u:
            self.assertEqual(P.load_set("1", Path("/nonexistent-folder")), [])
            u.assert_not_called()


if __name__ == "__main__":
    unittest.main()
