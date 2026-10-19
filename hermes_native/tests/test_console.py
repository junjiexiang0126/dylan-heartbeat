import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('console',Path(__file__).parents[1]/'web_console.py');console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)
class ConsoleTests(unittest.TestCase):
    def test_stale_counter_and_failed_gate_diagnostics_are_visible_without_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);(home/'logs').mkdir()
            state=home/'autonomy_gate_state.json';state.write_text('{"date":"2000-01-01","wakes":6}')
            (home/'logs/autonomy_preflight.jsonl').write_text(json.dumps({'time':'2026-10-18T10:00:00+07:00','wakeAgent':False,'error_type':'ValueError','invalid_completions':['review'],'secret':'HIDDEN'})+'\n')
            before=state.read_bytes();value=console.snapshot(home,lambda root,relative,limit:(root/relative).read_bytes())
            self.assertFalse(value['wakeCounter']['isCurrentDate'])
            self.assertEqual(value['wakeCounter']['wakes'],6)
            self.assertEqual(value['wakes'][0]['invalid_completions'],['review'])
            self.assertEqual(value['wakes'][0]['error_type'],'ValueError')
            self.assertNotIn('HIDDEN',json.dumps(value));self.assertEqual(state.read_bytes(),before)
    def test_missing_metrics_are_not_zero_or_online_and_secrets_not_returned(self):
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);(home/'workspace').mkdir();(home/'workspace/tasks.json').write_text(json.dumps([{'id':'1','title':'task','status':'pending','secret':'HIDDEN'}]));read=lambda root,relative,limit:(root/relative).read_bytes();value=console.snapshot(home,read)
            self.assertIsNone(value['usage']['today']);self.assertEqual(value['services']['guardian'],'unknown');self.assertNotIn('HIDDEN',json.dumps(value));self.assertFalse((home/'state.db').exists())
