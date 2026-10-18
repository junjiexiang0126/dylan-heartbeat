"""cron 作业级 max_iterations 覆盖的结构性契约测试。

真正的运行时验证需要把补丁应用到一份可写的 Hermes 副本上（生产 /opt 只读）；
这里固定住"优先级规则本身"，防止补丁被后续改动悄悄改坏。
"""
import re
import unittest
from pathlib import Path

PATCH = Path(__file__).resolve().parents[2] / "patches" / "cron" / "0001-cron-job-max-iterations.patch"


class CronIterationOverrideContract(unittest.TestCase):
    def setUp(self):
        self.text = PATCH.read_text(encoding="utf-8")

    def test_patch_targets_cron_scheduler(self):
        self.assertIn("a/cron/scheduler.py", self.text)
        self.assertIn("b/cron/scheduler.py", self.text)

    def test_job_level_override_comes_first(self):
        added = [l[1:] for l in self.text.splitlines() if l.startswith("+") and not l.startswith("+++")]
        body = "\n".join(added)
        self.assertIn('(job or {}).get("max_iterations")', body)
        # 作业级必须出现在全局读取之前
        self.assertLess(body.index('(job or {}).get("max_iterations")'),
                        body.index('_cfg.get("agent", {})'))

    def test_run_budget_override_present(self):
        body = "\n".join(l[1:] for l in self.text.splitlines()
                          if l.startswith("+") and not l.startswith("+++"))
        self.assertIn('(job or {}).get("run_budget_seconds")', body)
        self.assertIn('run_budget_seconds=setup.run_budget_seconds', body)
        self.assertIn('setup.run_budget_seconds = _rb', body)

    def test_global_fallback_preserved(self):
        added = [l[1:] for l in self.text.splitlines() if l.startswith("+") and not l.startswith("+++")]
        body = "\n".join(added)
        self.assertIn('_cfg.get("agent", {}).get("max_turns")', body)
        # 第二级回落是原有代码，属于 diff 的上下文行而非新增行
        self.assertIn('_cfg.get("max_turns")', self.text)


if __name__ == "__main__":
    unittest.main()
