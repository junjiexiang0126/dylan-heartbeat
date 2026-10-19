import contextlib
import importlib.util
import io
import json
from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('handoff_gate', Path(__file__).parents[1] / 'autonomy_gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class HandoffGateTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name)
        (self.home / 'workspace').mkdir()
        (self.home / 'workspace/tasks.json').write_text('[]')
        self.now = datetime(2026, 10, 19, 12)

    def tasks(self, items):
        (self.home / 'workspace/tasks.json').write_text(json.dumps(items))

    def test_only_the_eight_named_legacy_tasks_can_be_waived(self):
        items = [{'id': tid, 'status': 'completed', 'evidence_waived': 'legacy: no retained artifact'}
                 for tid in sorted(gate.LEGACY_EVIDENCE_WAIVERS)]
        self.tasks(items)
        original = (self.home / 'workspace/tasks.json').read_bytes()
        result = gate.evaluate(self.home, self.now)
        self.assertTrue(result['wakeAgent'])
        self.assertEqual(set(result['waived_evidence']), gate.LEGACY_EVIDENCE_WAIVERS)
        self.assertEqual((self.home / 'workspace/tasks.json').read_bytes(), original)
        self.tasks(items + [{'id': 'new-task', 'status': 'completed', 'evidence_waived': 'please bypass'}])
        result = gate.evaluate(self.home, self.now)
        self.assertFalse(result['wakeAgent'])
        self.assertEqual(result['invalid_completions'], ['new-task'])

    def test_legacy_id_still_needs_an_explicit_reason(self):
        tid = next(iter(gate.LEGACY_EVIDENCE_WAIVERS))
        for reason in (None, False, True, '', ' ', {'reason': ''}):
            with self.subTest(reason=reason):
                self.tasks([{'id': tid, 'status': 'completed', 'evidence_waived': reason}])
                self.assertFalse(gate.evaluate(self.home, self.now)['wakeAgent'])

    def test_profile_configuration_is_used_instead_of_process_home(self):
        (self.home / 'autonomy_gate.json').write_text('{"daily_opportunities": 2}')
        with patch.dict(gate.os.environ, {'HERMES_HOME': '/unrelated-profile'}):
            self.assertTrue(gate.evaluate(self.home, self.now)['wakeAgent'])
            self.assertTrue(gate.evaluate(self.home, self.now)['wakeAgent'])
            result = gate.evaluate(self.home, self.now)
        self.assertFalse(result['wakeAgent'])
        self.assertEqual(result['daily_limit'], 2)

    def test_invalid_explicit_configuration_does_not_consume_a_wake(self):
        config = self.home / 'autonomy_gate.json'
        for value in ('{', '[]', '{"daily_opportunities": true}', '{"daily_opportunities": 0}',
                      '{"daily_opportunities": 49}', '{"daily_opportunities": "15"}'):
            with self.subTest(config=value):
                config.write_text(value)
                output = io.StringIO()
                with patch.dict(gate.os.environ, {'HERMES_HOME': str(self.home)}), contextlib.redirect_stdout(output):
                    gate.main()
                self.assertFalse(json.loads(output.getvalue())['wakeAgent'])
                self.assertFalse((self.home / 'autonomy_gate_state.json').exists())

    def test_default_fifteen_and_explicit_ten_are_both_supported(self):
        self.assertEqual(gate.evaluate(self.home, self.now)['daily_limit'], 15)
        (self.home / 'autonomy_gate.json').write_text('{"daily_opportunities": 10}')
        self.assertEqual(gate.evaluate(self.home, self.now)['daily_limit'], 10)
