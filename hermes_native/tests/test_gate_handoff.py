"""Current main gate contract: evidence reminders, profile caps, and block notices."""
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
        # The container UID/GID handoff is privileged; temp-home unit tests
        # must not depend on root/CAP_CHOWN or change real file ownership.
        owner = patch.object(gate.os, "chown")
        self.chown = owner.start(); self.addCleanup(owner.stop)
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name)
        (self.home / 'workspace').mkdir()
        (self.home / 'workspace/tasks.json').write_text('[]')
        self.now = datetime(2026, 10, 19, 12)
        env = patch.dict(gate.os.environ, {'HERMES_HOME': str(self.home)})
        env.start(); self.addCleanup(env.stop)

    def tasks(self, items):
        (self.home / 'workspace/tasks.json').write_text(json.dumps(items))

    def test_explicit_waivers_are_not_restricted_to_legacy_task_ids(self):
        items = [{'id': 'new-task', 'status': 'completed', 'evidence_waived': 'operator accepted historical gap'},
                 {'id': 'another-task', 'status': 'completed', 'evidence_waived': True},
                 {'id': 'needs-evidence', 'status': 'completed', 'evidence': []}]
        self.tasks(items)
        original = (self.home / 'workspace/tasks.json').read_bytes()
        result = gate.evaluate(self.home, self.now)
        self.assertTrue(result['wakeAgent'])
        self.assertEqual(result['waived_evidence'], ['new-task', 'another-task'])
        self.assertEqual(result['invalid_completions'], ['needs-evidence'])
        self.assertEqual((self.home / 'workspace/tasks.json').read_bytes(), original)

    def test_no_waiver_flags_gap_and_still_consumes_an_opportunity(self):
        for value in (None, False, '', {}):
            with self.subTest(waiver=value):
                self.tasks([{'id':'needs-evidence', 'status':'completed', 'evidence_waived':value}])
                before = json.loads((self.home / 'autonomy_gate_state.json').read_text())['wakes'] if (self.home / 'autonomy_gate_state.json').exists() else 0
                result = gate.evaluate(self.home, self.now)
                self.assertTrue(result['wakeAgent'])
                self.assertEqual(result['waived_evidence'], [])
                self.assertEqual(result['invalid_completions'], ['needs-evidence'])
                self.assertEqual(result['opportunity'], before + 1)

    def test_daily_configuration_comes_from_active_environment_profile(self):
        (self.home / 'autonomy_gate.json').write_text('{"daily_opportunities":10}')
        profile = self.home / 'active-profile'; profile.mkdir()
        (profile / 'autonomy_gate.json').write_text('{"daily_opportunities":2}')
        with patch.dict(gate.os.environ, {'HERMES_HOME':str(profile)}):
            self.assertEqual(gate._daily_opportunities(), 2)
            self.assertTrue(gate.evaluate(self.home, self.now)['wakeAgent'])
            self.assertTrue(gate.evaluate(self.home, self.now)['wakeAgent'])
            result = gate.evaluate(self.home, self.now)
        self.assertFalse(result['wakeAgent'])
        self.assertEqual(result['reason'], 'daily opportunities used')
        self.assertEqual(json.loads((self.home / 'autonomy_gate_state.json').read_text())['wakes'], 2)

    def test_unreadable_or_malformed_daily_config_falls_back_to_fifteen(self):
        for value in ('{', '[]', '{"daily_opportunities":"invalid"}', '{"daily_opportunities":null}'):
            with self.subTest(config=value):
                (self.home / 'autonomy_gate.json').write_text(value)
                self.assertEqual(gate._daily_opportunities(), 15)
        (self.home / 'autonomy_gate.json').unlink()
        self.assertEqual(gate._daily_opportunities(), 15)

    def test_numeric_config_is_converted_and_clamped_to_supported_range(self):
        # Match the current main implementation's conversion/clamp policy.
        for value, expected in ((0,1), (49,48), ('10',10), (True,1)):
            with self.subTest(value=value):
                (self.home / 'autonomy_gate.json').write_text(json.dumps({'daily_opportunities':value}))
                self.assertEqual(gate._daily_opportunities(), expected)

    def test_default_fifteen_and_explicit_ten_are_enforced(self):
        for limit in (15,10):
            with self.subTest(limit=limit):
                (self.home / 'autonomy_gate.json').write_text(json.dumps({'daily_opportunities':limit}))
                (self.home / 'autonomy_gate_state.json').write_text(json.dumps({'date':self.now.date().isoformat(),'wakes':limit-1}))
                final = gate.evaluate(self.home, self.now)
                self.assertTrue(final['wakeAgent']); self.assertEqual(final['opportunity'],limit)
                self.assertEqual(gate.evaluate(self.home, self.now)['reason'],'daily opportunities used')

    def test_main_uses_current_call_signature_and_persists_audit_and_counter(self):
        (self.home / 'logs').mkdir()
        self.tasks([{'id':'review','status':'completed','evidence':[]}])
        output = io.StringIO()
        with contextlib.redirect_stdout(output): gate.main()
        result = json.loads(output.getvalue())
        self.assertTrue(result['wakeAgent']); self.assertEqual(result['opportunity'],1)
        self.assertEqual(result['invalid_completions'],['review'])
        audit = json.loads((self.home/'logs/autonomy_preflight.jsonl').read_text())
        self.assertEqual(audit,result)
        self.assertEqual(json.loads((self.home/'autonomy_gate_state.json').read_text())['wakes'],1)

    def test_cap_block_notifies_once_and_does_not_increment_counter(self):
        (self.home / 'autonomy_gate.json').write_text('{"daily_opportunities":10}')
        (self.home / 'autonomy_gate_state.json').write_text(json.dumps({'date':self.now.date().isoformat(),'wakes':10}))
        for _ in range(2):
            self.assertFalse(gate.evaluate(self.home,self.now)['wakeAgent'])
        records=json.loads((self.home/'workspace/web-pokes.json').read_text())['records']
        self.assertEqual(len(records),1)
        self.assertEqual(records[0]['author'],'ziwei');self.assertEqual(records[0]['target'],'user')
        import uuid
        self.assertEqual(str(uuid.UUID(records[0]['id'])),records[0]['id'])
        self.assertEqual(json.loads((self.home/'autonomy_gate_state.json').read_text())['wakes'],10)

    def test_owner_handoff_failure_keeps_main_fail_closed(self):
        self.chown.side_effect = PermissionError("isolated ownership failure")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gate.main()
        result = json.loads(out.getvalue())
        self.assertFalse(result['wakeAgent'])
        self.assertEqual(result['error_type'], 'PermissionError')
        self.assertEqual(json.loads((self.home/'autonomy_gate_state.json').read_text())['wakes'], 1)

    def test_successful_state_save_requests_container_owner(self):
        gate.evaluate(self.home, self.now)
        self.chown.assert_called_with(self.home/'autonomy_gate_state.json', 10000, 10000)

    def test_three_failures_notify_without_consuming_opportunity(self):
        (self.home/'cron').mkdir()
        (self.home/'cron/jobs.json').write_text(json.dumps({'jobs':[{'name':'ziwei-test','failure_streak':3}]}))
        result=gate.evaluate(self.home,self.now)
        self.assertFalse(result['wakeAgent']);self.assertIn('three consecutive failures',result['reason'])
        self.assertFalse((self.home/'autonomy_gate_state.json').exists())
        self.assertEqual(len(json.loads((self.home/'workspace/web-pokes.json').read_text())['records']),1)

    def test_main_invalid_tasks_notify_and_return_false(self):
        self.tasks(['bad-shape'])
        out=io.StringIO()
        with contextlib.redirect_stdout(out):gate.main()
        result=json.loads(out.getvalue())
        self.assertFalse(result['wakeAgent']);self.assertEqual(result['error_type'],'ValueError')
        self.assertFalse((self.home/'autonomy_gate_state.json').exists())
        self.assertEqual(len(json.loads((self.home/'workspace/web-pokes.json').read_text())['records']),1)

    def test_notice_failure_does_not_allow_blocked_wake(self):
        (self.home/'autonomy_gate.json').write_text('{"daily_opportunities":1}')
        (self.home/'autonomy_gate_state.json').write_text(json.dumps({'date':self.now.date().isoformat(),'wakes':1}))
        with patch.object(gate,'atomic_json',side_effect=OSError('notice cannot be saved')):
            result=gate.evaluate(self.home,self.now)
        self.assertFalse(result['wakeAgent']);self.assertEqual(result['reason'],'daily opportunities used')

    def test_notice_same_reason_is_throttled_but_different_reason_is_delivered(self):
        gate._notify_block(self.home,'cap')
        gate._notify_block(self.home,'cap')
        gate._notify_block(self.home,'failure')
        self.assertEqual(len(json.loads((self.home/'workspace/web-pokes.json').read_text())['records']),2)
        state=json.loads((self.home/'.autonomy-gate-notify.json').read_text())
        state['ts'] -= 3601
        (self.home/'.autonomy-gate-notify.json').write_text(json.dumps(state))
        gate._notify_block(self.home,'failure')
        self.assertEqual(len(json.loads((self.home/'workspace/web-pokes.json').read_text())['records']),3)
