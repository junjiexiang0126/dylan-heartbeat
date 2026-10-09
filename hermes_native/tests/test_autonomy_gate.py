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
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        (self.home / "workspace/diary").mkdir(parents=True)
        (self.home / "cron").mkdir()
        self.now = datetime(2026, 10, 9, 10)
        self.write_tasks([])

    def write_tasks(self, value):
        (self.home / "workspace/tasks.json").write_text(json.dumps(value))

    def test_idle_and_daily_cap(self):
        for _ in range(6):
            self.assertTrue(gate.evaluate(self.home, self.now)["wakeAgent"])
        self.assertFalse(gate.evaluate(self.home, self.now)["wakeAgent"])
        (self.home / "workspace/diary/2026-10-10.md").write_text("real diary")
        self.assertFalse(gate.evaluate(self.home, datetime(2026, 10, 10, 10))["wakeAgent"])

    def test_completion_requires_real_scoped_artifact(self):
        self.write_tasks([{"status": "completed", "evidence": ["../config.yaml"]}])
        gate.evaluate(self.home, self.now)
        self.assertEqual(json.loads((self.home / "workspace/tasks.json").read_text())[0]["status"], "failed")
        (self.home / "workspace/result.md").write_text("verified saved output")
        self.write_tasks([{"status": "completed", "evidence": ["result.md"]}])
        gate.evaluate(self.home, self.now)
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

    def test_malformed_task_shape_fails_closed(self):
        self.write_tasks(["bad shape"])
        out = io.StringIO()
        with patch.dict(gate.os.environ, {"HERMES_HOME": str(self.home)}), contextlib.redirect_stdout(out):
            gate.main()
        self.assertFalse(json.loads(out.getvalue())["wakeAgent"])
