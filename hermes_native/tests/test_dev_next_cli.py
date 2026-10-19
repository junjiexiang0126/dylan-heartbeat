"""Exercise real CLI processes: in-process tests miss owner changes between calls."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'dev_next.py'


class CliLeaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ws = Path(self.tmp.name) / 'workspace'
        self.ws.mkdir()
        (self.ws / 'tasks.json').write_text(json.dumps([
            {'id': 'A', 'title': 'A', 'status': 'pending', 'autonomy': True},
            {'id': 'B', 'title': 'B', 'status': 'pending', 'autonomy': True}]))

    def call(self, *args, owner='run-A'):
        env = dict(os.environ, HERMES_HOME=self.tmp.name)
        env.pop('ZIWEI_WORKSPACE', None)
        env.pop('ZIWEI_DEV_OWNER', None)
        if owner is not None:
            env['ZIWEI_DEV_OWNER'] = owner
        result = subprocess.run([sys.executable, str(SCRIPT), *args], env=env,
                                text=True, capture_output=True, check=False)
        self.assertFalse(result.stderr, result.stderr)
        return result.returncode, json.loads(result.stdout)

    def snapshot(self):
        return {str(p.relative_to(self.ws)): p.read_bytes()
                for p in self.ws.rglob('*.json')}

    def test_same_run_can_claim_progress_heartbeat_and_verify_across_processes(self):
        self.assertEqual(self.call()[0], 0)
        self.assertEqual(self.call('--progress', 'A', '--note', 'saved')[0], 0)
        self.assertEqual(self.call('--heartbeat', 'A')[0], 0)
        self.assertEqual(self.call('--step-start', 'A', '--op-key', 'write', '--action', 'write artifact')[0], 0)
        target = self.ws / 'artifact.txt'
        target.write_text('real artifact')
        import hashlib
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        code, value = self.call('--step-verify', 'A', '--op-key', 'write',
                                '--evidence-file', str(target), '--expect-sha256', digest)
        self.assertEqual(code, 0)
        self.assertTrue(value['verified'])
        self.assertEqual(self.call('--done', 'A', '--note', 'finished')[0], 0)
        task = json.loads((self.ws / 'tasks.json').read_text())[0]
        self.assertEqual(task['status'], 'completed')
        self.assertEqual(task['evidence'], ['artifact.txt'])

    def test_other_run_cannot_reuse_an_active_claim(self):
        self.call()
        code, value = self.call(owner='run-B')
        self.assertEqual(code, 0)
        self.assertIsNone(value['task'])

    def test_foreign_mutations_fail_before_any_write(self):
        self.call()
        self.call('--step-start', 'A', '--op-key', 'write', '--action', 'write')
        before = self.snapshot()
        operations = [('--progress', 'A', '--note', 'must not appear'),
                      ('--heartbeat', 'A'), ('--done', 'A'),
                      ('--step-start', 'A', '--op-key', 'other'),
                      ('--step-done', 'A', '--op-key', 'write'),
                      ('--step-verify', 'A', '--op-key', 'write', '--evidence', 'anything')]
        for args in operations:
            with self.subTest(args=args):
                code, value = self.call(*args, owner='run-B')
                self.assertEqual(code, 1)
                self.assertEqual(value['error'], 'owner_mismatch')
                self.assertEqual(self.snapshot(), before)

    def test_legacy_pid_only_cross_process_write_also_fails_without_mutation(self):
        self.call(owner=None)
        before = self.snapshot()
        code, value = self.call('--progress', 'A', '--note', 'no write', owner=None)
        self.assertEqual(code, 1)
        self.assertEqual(value['error'], 'owner_mismatch')
        self.assertEqual(self.snapshot(), before)

    def test_empty_step_verification_is_refused(self):
        self.call()
        self.call('--step-start', 'A', '--op-key', 'write')
        before = self.snapshot()
        code, value = self.call('--step-verify', 'A', '--op-key', 'write')
        self.assertEqual(code, 1)
        self.assertEqual(value['error'], 'evidence_missing')
        self.assertEqual(self.snapshot(), before)

    def test_task_cannot_complete_without_nonempty_scoped_artifact(self):
        self.call()
        before = self.snapshot()
        code, value = self.call('--done', 'A', '--note', 'unproven')
        self.assertEqual(code, 1)
        self.assertEqual(value['error'], 'completion_evidence_missing')
        self.assertEqual(self.snapshot(), before)

    def test_evidence_outside_workspace_is_refused(self):
        self.call()
        self.call('--step-start', 'A', '--op-key', 'write')
        target = Path(self.tmp.name) / 'outside.txt'
        target.write_text('outside')
        import hashlib
        before = self.snapshot()
        code, value = self.call('--step-verify', 'A', '--op-key', 'write',
                                '--evidence-file', str(target),
                                '--expect-sha256', hashlib.sha256(target.read_bytes()).hexdigest())
        self.assertEqual(code, 1)
        self.assertEqual(value['error'], 'evidence_unreadable')
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
