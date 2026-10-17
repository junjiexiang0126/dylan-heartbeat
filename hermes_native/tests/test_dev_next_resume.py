"""dev_next 的租约/接管/证据核验单测（隔离 workspace，不碰正式数据）。"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

TZ = timezone(timedelta(hours=7))
MODULE = Path(__file__).resolve().parents[1] / "tools" / "dev_next.py"


def load(workspace):
    os.environ["ZIWEI_WORKSPACE"] = str(workspace)
    spec = importlib.util.spec_from_file_location("dev_next_under_test", MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self.tmp.name)
        (self.ws / "dev").mkdir()
        self.now = datetime.now(TZ).replace(microsecond=0)
        self.mod = load(self.ws)

    def tearDown(self):
        os.environ.pop("ZIWEI_WORKSPACE", None)
        self.tmp.cleanup()

    def write(self, tasks, leases=None):
        (self.ws / "tasks.json").write_text(json.dumps(tasks, ensure_ascii=False), encoding="utf-8")
        if leases is not None:
            (self.ws / "dev" / "leases.json").write_text(json.dumps(leases), encoding="utf-8")

    def task(self, tid, status="in_progress"):
        iso = self.now.isoformat()
        return {"id": tid, "title": tid, "status": status, "autonomy": True,
                "note": "", "started_at": iso, "updated_at": iso}

    def test_legacy_task_without_lease_is_adopted_once(self):
        self.write([self.task("A")])
        first = self.mod.adopt_task("A", "单实例、无进程")
        self.assertTrue(first["ok"] and first["adopted"])
        second = self.mod.adopt_task("A", "再来一次")
        self.assertTrue(second.get("duplicate"))
        note = json.loads((self.ws / "tasks.json").read_text(encoding="utf-8"))[0]["note"]
        self.assertEqual(len([x for x in note.splitlines() if x.strip()]), 1)

    def test_dead_pid_inside_ttl_is_refused(self):
        iso = self.now.isoformat()
        self.write([self.task("B")], {"B": {"pid": 999999, "at": iso}})
        result = self.mod.adopt_task("B", "测试")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "owner_alive")

    def test_dead_pid_beyond_ttl_can_be_resumed(self):
        old = (self.now - timedelta(minutes=20)).isoformat()
        self.write([self.task("C")], {"C": {"pid": 999999, "at": old}})
        result = self.mod.resume_task("C")
        self.assertTrue(result["ok"] and result["resumed"])

    def test_evidence_mismatch_is_refused(self):
        self.write([self.task("D")])
        self.mod.adopt_task("D", "测试")
        self.mod.step_start("D", "k1", "写文件")
        target = self.ws / "f.txt"
        target.write_text("hello\n", encoding="utf-8")
        bad = self.mod.step_verify("D", "k1", None, None, str(target), "0" * 64)
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["error"], "evidence_mismatch")

    def test_claim_is_idempotent(self):
        iso = self.now.isoformat()
        self.write([{"id": "E", "title": "E", "status": "pending", "autonomy": True,
                     "note": "", "created_at": iso}])
        first = self.mod.next_task()
        second = self.mod.next_task()
        self.assertEqual(first["task"]["id"], second["task"]["id"])
        self.assertTrue(second.get("reused"))


if __name__ == "__main__":
    unittest.main()
