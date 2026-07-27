import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("ligalorcana_price_agent_daily_v4.py")
SPEC = importlib.util.spec_from_file_location("price_agent_v4", MODULE_PATH)
agent = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = agent
SPEC.loader.exec_module(agent)


class AtomicWriteTests(unittest.TestCase):
    def test_retries_a_short_destination_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prices.json"
            real_replace = agent.os.replace
            calls = []

            def flaky_replace(source, destination):
                calls.append((source, destination))
                if len(calls) < 3:
                    raise PermissionError("simulated OneDrive lock")
                return real_replace(source, destination)

            with mock.patch.object(agent.os, "replace", side_effect=flaky_replace):
                with mock.patch.object(agent.time, "sleep"):
                    agent.atomic_write_json(
                        path,
                        {"ok": True},
                        replace_attempts=4,
                        initial_retry_delay=0,
                    )

            self.assertEqual(3, len(calls))
            self.assertEqual({"ok": True}, json.loads(path.read_text("utf-8")))

    def test_preserves_complete_recovery_temp_after_persistent_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "analytics.json"
            path.write_text('{"old":true}\n', encoding="utf-8")

            with mock.patch.object(
                agent.os,
                "replace",
                side_effect=PermissionError("simulated persistent lock"),
            ):
                with mock.patch.object(agent.time, "sleep"):
                    with self.assertRaisesRegex(
                        PermissionError, "--finalize-cache"
                    ):
                        agent.atomic_write_json(
                            path,
                            {"new": True},
                            replace_attempts=2,
                            initial_retry_delay=0,
                        )

            recovery = list(root.glob(".analytics.json.*.tmp"))
            self.assertEqual(1, len(recovery))
            self.assertEqual(
                {"new": True},
                json.loads(recovery[0].read_text("utf-8")),
            )
            self.assertEqual(
                {"old": True},
                json.loads(path.read_text("utf-8")),
            )


class ResumeTests(unittest.TestCase):
    def test_refresh_today_skips_today_and_fetches_older(self):
        today = datetime.now(timezone.utc).isoformat()
        old = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        current = agent.CardResult(
            id="A",
            name="A",
            edition="1",
            number="1",
            url="https://example.test/A",
            canonical_id=None,
            card_db_key=None,
            match_status="matched",
            match_method=None,
            match_note=None,
            printing_type="normal",
            printing_label="Normal",
            rarity=None,
            normal=None,
            foil=None,
            minimum_price_brl=None,
            status="no_price",
            checked_at=today,
        )
        stale = agent.CardResult(**{**current.__dict__, "id": "B", "checked_at": old})
        self.assertFalse(agent.should_refresh(current, 7, False, True))
        self.assertTrue(agent.should_refresh(stale, 7, False, True))

    def test_resume_status_counts_durable_today_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "raw.json"
            catalog = root / "catalog.json"
            today = datetime.now(timezone.utc).isoformat()
            old = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
            output.write_text(
                json.dumps({
                    "schema_version": 8,
                    "generated_at": today,
                    "cards": [
                        {"id": "A", "status": "ok", "checked_at": today},
                        {"id": "B", "status": "no_price", "checked_at": today},
                        {"id": "C", "status": "ok", "checked_at": old},
                    ],
                }),
                encoding="utf-8",
            )
            catalog.write_text(
                json.dumps([{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "D"}]),
                encoding="utf-8",
            )
            status = agent.build_resume_status(output, catalog)
            self.assertEqual(3, status["cache_records"])
            self.assertEqual(2, status["checked_today"])
            self.assertEqual(4, status["catalog_records"])
            self.assertEqual(2, status["remaining_today"])


class FinalizationTests(unittest.TestCase):
    def make_raw(self):
        result = agent.CardResult(
            id="LIGA-1",
            name="Test Card",
            edition="The First Chapter",
            number="1",
            url="https://example.test/LIGA-1",
            canonical_id="LOR1-1",
            card_db_key="LOR1-1",
            match_status="matched",
            match_method="test",
            match_note=None,
            printing_type="normal",
            printing_label="Normal",
            rarity="C",
            normal=agent.PriceBand(low=10.0, average=12.0, high=15.0),
            foil=None,
            minimum_price_brl=10.0,
            status="ok",
            checked_at=datetime.now(timezone.utc).isoformat(),
            database_id="LOR1-1",
            catalog_name="Test Card",
            catalog_match_status="matched",
            catalog_match_note=None,
        )
        return agent.build_payload([result], 1), {result.id: result}

    def test_finalization_writes_manifest_last(self):
        raw, existing = self.make_raw()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            manifest = root / "data-manifest.json"
            manifest.write_text(
                json.dumps({
                    "manifest_version": 1,
                    "schema": {},
                    "artifacts": {},
                    "counts": {},
                }),
                encoding="utf-8",
            )
            paths = {
                "price_map": data / "price-map.json",
                "prices": data / "prices.json",
                "history": data / "history.json",
                "analytics": data / "analytics.json",
            }
            deploy, history, updated = agent.finalize_price_artifacts(
                raw,
                existing,
                paths["price_map"],
                paths["prices"],
                paths["history"],
                paths["analytics"],
                manifest,
            )
            self.assertTrue(updated)
            self.assertEqual(1, len(deploy["prices"]))
            self.assertEqual(1, len(history["series"]))
            published = json.loads(manifest.read_text("utf-8"))
            self.assertIn("prices", published["artifacts"])
            self.assertIn("price_history", published["artifacts"])

    def test_analytics_failure_does_not_publish_manifest(self):
        raw, existing = self.make_raw()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            manifest = root / "data-manifest.json"
            original = {
                "manifest_version": 1,
                "schema": {},
                "artifacts": {},
                "counts": {},
            }
            manifest.write_text(json.dumps(original), encoding="utf-8")
            analytics = data / "analytics.json"
            real_write = agent.atomic_write_json

            def fail_analytics(path, payload, **kwargs):
                if path == analytics:
                    raise PermissionError("simulated analytics lock")
                return real_write(path, payload, **kwargs)

            with mock.patch.object(
                agent,
                "atomic_write_json",
                side_effect=fail_analytics,
            ):
                with self.assertRaises(PermissionError):
                    agent.finalize_price_artifacts(
                        raw,
                        existing,
                        data / "price-map.json",
                        data / "prices.json",
                        data / "history.json",
                        analytics,
                        manifest,
                    )

            self.assertEqual(original, json.loads(manifest.read_text("utf-8")))


if __name__ == "__main__":
    unittest.main()
