import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('console',Path(__file__).parents[1]/'web_console.py');console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)
class ConsoleTests(unittest.TestCase):
    def test_missing_metrics_are_not_zero_or_online_and_secrets_not_returned(self):
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);(home/'workspace').mkdir();(home/'workspace/tasks.json').write_text(json.dumps([{'id':'1','title':'task','status':'pending','secret':'HIDDEN'}]));read=lambda root,relative,limit:(root/relative).read_bytes();value=console.snapshot(home,read)
            self.assertIsNone(value['usage']['today']);self.assertEqual(value['services']['guardian'],'unknown');self.assertNotIn('HIDDEN',json.dumps(value));self.assertFalse((home/'state.db').exists())
