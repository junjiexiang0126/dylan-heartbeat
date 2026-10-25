import importlib.util
import json
import tempfile
import unittest
import contextlib
import io
from unittest.mock import patch
from datetime import datetime
from pathlib import Path

spec = importlib.util.spec_from_file_location("gate", Path(__file__).parents[1] / "autonomy_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def setUp(self):
        owner = patch.object(gate.os, "chown")
        self.chown = owner.start(); self.addCleanup(owner.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        (self.home / "workspace/diary").mkdir(parents=True)
        (self.home / "cron").mkdir()
        self.now = datetime(2026, 10, 9, 10)
        self.write_tasks([])
        # Current gate resolves its daily configuration from the active profile.
        env = patch.dict(gate.os.environ, {"HERMES_HOME": str(self.home)})
        env.start(); self.addCleanup(env.stop)

    def write_tasks(self, value):
        (self.home / "workspace/tasks.json").write_text(json.dumps(value))

    def test_idle_and_daily_cap(self):
        for _ in range(15):
            self.assertTrue(gate.evaluate(self.home, self.now)["wakeAgent"])
        self.assertFalse(gate.evaluate(self.home, self.now)["wakeAgent"])
        (self.home / "workspace/diary/2026-10-10.md").write_text("real diary")
        result = gate.evaluate(self.home, datetime(2026, 10, 10, 10))
        self.assertTrue(result["wakeAgent"])
        self.assertTrue(result["idle"])
        self.assertIn("rest", result["available_actions"])
        self.assertEqual(result["opportunity"], 1)

    def test_waiting_front_is_valid_but_not_runnable(self):
        tasks = [{"id": "frontend", "status": "waiting_front"}]
        self.write_tasks(tasks)
        result = gate.evaluate(self.home, self.now)
        self.assertTrue(result["wakeAgent"])
        self.assertEqual(result["tasks"], [])
        self.assertEqual(json.loads((self.home / "workspace/tasks.json").read_text()), tasks)
        self.write_tasks(tasks + [{"id": "unverified", "status": "completed", "evidence": []}])
        result = gate.evaluate(self.home, self.now)
        self.assertTrue(result["wakeAgent"])
        self.assertEqual(result["invalid_completions"], ["unverified"])

    def test_missing_or_unscoped_evidence_is_flagged_without_blocking_wake(self):
        self.write_tasks([{"id":"unscoped", "status": "completed", "evidence": ["../config.yaml"]}])
        original = (self.home / "workspace/tasks.json").read_bytes()
        result = gate.evaluate(self.home, self.now)
        self.assertTrue(result["wakeAgent"])
        self.assertEqual(result["invalid_completions"], ["unscoped"])
        self.assertEqual((self.home / "workspace/tasks.json").read_bytes(), original)
        (self.home / "workspace/result.md").write_text("verified saved output")
        self.write_tasks([{"status": "completed", "evidence": ["result.md"]}])
        self.assertEqual(gate.evaluate(self.home, self.now)["invalid_completions"], [])
        self.assertEqual(json.loads((self.home / "workspace/tasks.json").read_text())[0]["status"], "completed")

    def test_gate_cannot_overwrite_concurrent_task_update(self):
        self.write_tasks([{"id": "old", "status": "completed", "evidence": []}])
        original_read = Path.read_text
        updated = [{"id": "old", "status": "in_progress"},
                   {"id": "new", "status": "pending"}]

        def concurrent_read(path, *args, **kwargs):
            body = original_read(path, *args, **kwargs)
            if path == self.home / "workspace/tasks.json":
                self.write_tasks(updated)
            return body

        with patch.object(Path, "read_text", concurrent_read):
            result = gate.evaluate(self.home, self.now)
            self.assertTrue(result["wakeAgent"])
            self.assertEqual(result["invalid_completions"], ["old"])
        self.assertEqual(json.loads((self.home / "workspace/tasks.json").read_text()), updated)

    def test_empty_or_redirected_diary_is_not_saved_work(self):
        diary = self.home / "workspace/diary/2026-10-09.md"
        diary.touch()
        self.assertTrue(gate.evaluate(self.home, self.now)["diary_due"])
        diary.unlink()
        external = self.home / "external.md"
        external.write_text("outside diary")
        diary.symlink_to(external)
        self.assertTrue(gate.evaluate(self.home, self.now)["diary_due"])

    def test_gate_preserves_failed_completion_even_when_daily_cap_used(self):
        self.write_tasks([{"id": "review", "status": "completed", "evidence": []}])
        (self.home / "autonomy_gate.json").write_text(json.dumps({"daily_opportunities":10}))
        (self.home / "autonomy_gate_state.json").write_text(json.dumps({"date": "2026-10-09", "wakes": 10}))
        result = gate.evaluate(self.home, self.now)
        self.assertFalse(result["wakeAgent"])
        self.assertEqual(result["reason"], "daily opportunities used")
        self.assertEqual(json.loads((self.home / "autonomy_gate_state.json").read_text())["wakes"], 10)
        self.assertEqual(json.loads((self.home / "workspace/tasks.json").read_text())[0]["status"], "completed")

    def test_failures_pause_and_bad_states_refused(self):
        (self.home / "cron/jobs.json").write_text(json.dumps({"jobs": [{"name": "ziwei-test", "failure_streak": 3}]}))
        self.assertFalse(gate.evaluate(self.home, self.now)["wakeAgent"])
        self.write_tasks([{"status": "pretend"}])
        with self.assertRaises(ValueError):
            gate.evaluate(self.home, self.now)

    def test_main_returns_false_even_without_lock_or_log_directory(self):
        out = io.StringIO()
        with patch.dict(gate.os.environ, {"HERMES_HOME": str(self.home / "missing")}), contextlib.redirect_stdout(out):
            gate.main()
        self.assertFalse(json.loads(out.getvalue())["wakeAgent"])
        self.assertIn("time", json.loads(out.getvalue()))

    def test_malformed_task_shape_fails_closed(self):
        self.write_tasks(["bad shape"])
        out = io.StringIO()
        with patch.dict(gate.os.environ, {"HERMES_HOME": str(self.home)}), contextlib.redirect_stdout(out):
            gate.main()
        self.assertFalse(json.loads(out.getvalue())["wakeAgent"])
