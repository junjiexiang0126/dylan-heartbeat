"""Tests for bg_review_dedup V1 — no network, no Hermes imports.

Covers: duplicate-event dedup, changed-event trigger, concurrent trigger,
bounded failure retry, forced periodic review floor, over-budget warning
record (no interruption), and self-edit non-retrigger.
"""
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bg_review_dedup as dedup


class _FakeBR:
    """Minimal stand-in for agent.background_review."""

    def __init__(self):
        self.spawn_calls = 0
        self.log_calls = []

        def spawn_thread(agent, messages_snapshot, **kwargs):
            self.spawn_calls += 1
            return (lambda: None), "prompt"

        self.spawn_background_review_thread = spawn_thread

        def log_completion(usage, result):
            self.log_calls.append((dict(usage), result))

        self._log_review_completion = log_completion


class _FakeAgent:
    session_id = "test-session"

    def _spawn_background_review(self, messages_snapshot, *args, **kwargs):
        self.spawned = True
        return "spawned"


class _FakeCls:
    _spawn_background_review = _FakeAgent._spawn_background_review


class DedupTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.mem = self.home / "memories"
        self.mem.mkdir()
        (self.mem / "MEMORY.md").write_text("# memory v1", encoding="utf-8")
        (self.mem / "USER.md").write_text("# user v1", encoding="utf-8")
        patcher = mock.patch.object(dedup, "_home", lambda: self.home)
        patcher.start()
        self.addCleanup(patcher.stop)
        cfg_patcher = mock.patch.object(dedup, "_load_task_cfg",
                                        lambda br: {"dedup_enabled": True})
        cfg_patcher.start()
        self.addCleanup(cfg_patcher.stop)
        self.br = _FakeBR()
        self.cls = _FakeCls()
        self.assertTrue(dedup.install_on_class(self.cls, self.br))
        self.state = self.cls._ziwei_bg_dedup_state
        self.agent = _FakeAgent()

    def tearDown(self):
        self.tmp.cleanup()

    def trigger(self, explicit=False, focus=None):
        return self.cls._spawn_background_review(
            self.agent, [], explicit=explicit, focus=focus)

    def complete(self, result="ok", usage=None):
        self.br._log_review_completion(usage or {"api_calls": 2}, result)
        dedup._fp_local.usage = usage or {"api_calls": 2}
        dedup._fp_local.result = result
        dedup._complete(self.state, dedup._fingerprint(self.agent))

    def log_events(self):
        path = self.home / dedup.LOG_NAME
        if not path.exists():
            return []
        return [json.loads(line) for line in
                path.read_text(encoding="utf-8").splitlines() if line]

    def edit_memory(self, text):
        (self.mem / "MEMORY.md").write_text(text, encoding="utf-8")


class TestDuplicateEventDedup(DedupTestBase):
    def test_unchanged_fingerprint_skipped(self):
        self.assertIsNotNone(self.trigger())
        self.complete("ok")
        self.assertIsNone(self.trigger())
        events = self.log_events()
        self.assertEqual(events[-1]["decision"], "skip")
        self.assertEqual(events[-1]["reason"], "unchanged_fingerprint")

    def test_self_edit_does_not_retrigger(self):
        self.assertIsNotNone(self.trigger())
        # The review itself edits memory; the post-fingerprint must absorb it.
        self.edit_memory("# memory v1 (reviewed)")
        self.complete("ok")
        self.assertIsNone(self.trigger())


class TestChangedEventTriggers(DedupTestBase):
    def test_fingerprint_change_runs(self):
        self.assertIsNotNone(self.trigger())
        self.complete("ok")
        self.edit_memory("# memory v2")
        self.assertIsNotNone(self.trigger())
        events = self.log_events()
        self.assertEqual(events[-1]["decision"], "run")
        self.assertEqual(events[-1]["reason"], "fingerprint_changed")

    def test_explicit_review_always_runs(self):
        self.assertIsNotNone(self.trigger())
        self.complete("ok")
        self.assertIsNotNone(self.trigger(explicit=True))
        self.assertIsNotNone(self.trigger(explicit=True))


class TestConcurrentTrigger(DedupTestBase):
    def test_same_fingerprint_in_flight_skipped(self):
        self.assertIsNotNone(self.trigger())
        # No complete() yet: the review is still running.
        self.assertIsNone(self.trigger())
        events = self.log_events()
        self.assertEqual(events[-1]["reason"], "already_in_flight")


    def test_explicit_does_not_replace_background_reservation(self):
        self.assertIsNotNone(self.trigger())
        fingerprint = dedup._fingerprint(self.agent)
        stamp = self.state.in_flight[fingerprint]
        self.assertIsNotNone(self.trigger(explicit=True))
        self.assertEqual(self.state.in_flight[fingerprint], stamp)

    def test_threaded_triggers_single_run(self):
        results = []

        def worker():
            results.append(self.trigger())

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sum(r is not None for r in results), 1)


class TestFailureRetry(DedupTestBase):
    def test_error_retries_bounded(self):
        self.assertIsNotNone(self.trigger())
        # Failures 1..MAX-1 each earn a retry; failure MAX exhausts the budget.
        for i in range(dedup.MAX_CONSECUTIVE_FAILURES - 1):
            self.complete("error")
            self.assertIsNotNone(self.trigger(), f"retry {i} should run")
        self.complete("error")
        self.assertIsNone(self.trigger())
        events = self.log_events()
        self.assertEqual(events[-1]["reason"], "failure_retry_exhausted")


    def test_force_interval_cannot_bypass_exhausted_retries(self):
        self.assertIsNotNone(self.trigger())
        for i in range(dedup.MAX_CONSECUTIVE_FAILURES - 1):
            self.complete("error")
            self.assertIsNotNone(self.trigger())
        self.complete("error")
        self.state.last_run_at -= dedup.DEFAULT_FORCE_INTERVAL_SECONDS + 1
        self.assertIsNone(self.trigger())
        self.assertEqual(self.log_events()[-1]["reason"], "failure_retry_exhausted")

    def test_new_fingerprint_recovers_from_exhausted_retries(self):
        self.assertIsNotNone(self.trigger())
        for i in range(dedup.MAX_CONSECUTIVE_FAILURES - 1):
            self.complete("error")
            self.assertIsNotNone(self.trigger())
        self.complete("error")
        self.edit_memory("# changed after failed review")
        self.assertIsNotNone(self.trigger())

    def test_success_resets_failures(self):
        self.assertIsNotNone(self.trigger())
        self.complete("error")
        self.assertIsNotNone(self.trigger())
        self.complete("ok")
        self.assertIsNone(self.trigger())  # dedup active again


class TestForcedPeriodicReview(DedupTestBase):
    def test_force_interval_overrides_unchanged_fingerprint(self):
        self.assertIsNotNone(self.trigger())
        self.complete("ok")
        self.assertIsNone(self.trigger())
        # Simulate the force interval elapsing with no changes at all.
        self.state.last_run_at -= dedup.DEFAULT_FORCE_INTERVAL_SECONDS + 1
        self.assertIsNotNone(self.trigger())
        events = self.log_events()
        self.assertEqual(events[-1]["reason"], "force_interval")


class TestOverBudgetWarning(DedupTestBase):
    def test_over_six_calls_recorded_not_interrupted(self):
        self.assertIsNotNone(self.trigger())
        usage = {"api_calls": 9, "input_tokens": 100, "output_tokens": 50,
                 "cache_read_tokens": 10}
        with self.assertLogs("ziwei.bg_review_dedup", level="WARNING") as logs:
            self.complete("ok", usage=usage)
        self.assertTrue(any("9 API calls" in line for line in logs.output))
        events = self.log_events()
        complete = [e for e in events if e["event"] == "complete"]
        self.assertEqual(complete[-1]["api_calls"], 9)
        self.assertEqual(complete[-1]["result"], "ok")


class TestDedupDisabled(DedupTestBase):
    def test_default_is_disabled_until_integration_acceptance(self):
        self.assertFalse(dedup._dedup_enabled({}))
        self.assertFalse(dedup._dedup_enabled(None))

    def test_invalid_force_interval_is_clamped(self):
        self.assertEqual(dedup._force_interval({"dedup_force_interval_seconds": -5}), 1)

    def test_disabled_bypasses_dedup(self):
        with mock.patch.object(dedup, "_load_task_cfg",
                               lambda br: {"dedup_enabled": False}):
            self.assertIsNotNone(self.trigger())
            self.assertIsNotNone(self.trigger())


if __name__ == "__main__":
    unittest.main(verbosity=2)
