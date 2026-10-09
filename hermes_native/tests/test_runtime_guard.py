import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runtime_guard', Path(__file__).parents[1] / 'runtime_guard.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)


class RuntimeGuardTests(unittest.TestCase):
    def test_controller_and_launchers_cannot_be_patched(self):
        for name in ['../run_agent.py', '/run_agent.py', 'docker/entrypoint.py', 'hermes_cli/main.py', '.env.py', 'tools/__pycache__/a.py', 'tools/a.sh']:
            with self.assertRaises(ValueError): g.safe_patch_path(name)
        self.assertEqual(g.safe_patch_path('agent/test.py'), Path('agent/test.py'))

    def test_input_rejects_symlinked_leaf_and_parent(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root/'real').mkdir(); (root/'real'/'x').write_text('payload')
            (root/'leaf').symlink_to(root/'real'/'x'); (root/'parent').symlink_to(root/'real')
            for p in ['leaf', 'parent/x']:
                with self.assertRaises(OSError): g.read_regular_beneath(root,p,100)
            self.assertEqual(g.read_regular_beneath(root,'real/x',100),b'payload')
            with self.assertRaises(ValueError): g.read_regular_beneath(root,'real/x',3)

    def test_rejected_request_pauses_without_switch_or_live_restart(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); requests=root/'requests'; requests.mkdir(); control=root/'control'; control.mkdir()
            request=requests/'bad.json'; request.write_text(json.dumps({'base':'stale','files':['run_agent.py']}))
            state={'active':'baseline','previous':'baseline','paused':False,'processed':[],'attempts':[]}
            with patch.object(g,'REQUESTS',requests),patch.object(g,'CONTROL',control),patch.object(g,'health',return_value=True),patch.object(g,'notify',return_value=True) as push,patch.object(g,'switch') as switch,patch.object(g,'restart_gateway') as restart:
                g.process_request(request,state)
                self.assertTrue(state['paused']); self.assertEqual(state['failure_category'],'stale_base')
                self.assertTrue(json.loads((requests/'status.json').read_text())['last_result']['bark_accepted'])
                switch.assert_not_called(); restart.assert_not_called(); push.assert_called_once()
                g.process_request(request,state); push.assert_called_once()

    def test_candidate_failure_never_promotes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); requests=root/'requests';(requests/'patches'/'agent').mkdir(parents=True)
            (requests/'patches'/'agent'/'a.py').write_text('value = 1\n')
            control=root/'control';(control/'releases').mkdir(parents=True);trees=root/'trees';trees.mkdir()
            req=requests/'test.json';req.write_text(json.dumps({'base':'baseline','files':['agent/a.py']}))
            state={'active':'baseline','previous':'baseline','paused':False,'processed':[],'attempts':[]}
            with patch.object(g,'REQUESTS',requests),patch.object(g,'CONTROL',control),patch.object(g,'TREES',trees),patch.object(g,'health',return_value=True),patch.object(g,'notify',return_value=False),patch.object(g,'mirror_tree'),patch.object(g,'validate_candidate',side_effect=ValueError('native_import_test')),patch.object(g,'switch') as switch,patch.object(g,'backup_profile') as backup:
                g.process_request(req,state); switch.assert_not_called();backup.assert_not_called()
                self.assertEqual(state['active'],'baseline'); self.assertTrue(state['paused'])

    def test_runtime_health_failure_rolls_back(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);requests=root/'requests';(requests/'patches'/'agent').mkdir(parents=True)
            (requests/'patches'/'agent'/'a.py').write_text('value = 2\n');control=root/'control';(control/'releases').mkdir(parents=True);trees=root/'trees';trees.mkdir()
            req=requests/'test.json';req.write_text(json.dumps({'base':'baseline','files':['agent/a.py']}))
            state={'active':'baseline','previous':'baseline','paused':False,'processed':[],'attempts':[]}
            with patch.object(g,'REQUESTS',requests),patch.object(g,'CONTROL',control),patch.object(g,'TREES',trees),patch.object(g,'health',return_value=True),patch.object(g,'notify',return_value=False),patch.object(g,'mirror_tree'),patch.object(g,'validate_candidate'),patch.object(g,'backup_profile'),patch.object(g,'switch') as switch,patch.object(g,'restart_gateway') as restart,patch.object(g,'await_health',side_effect=[False,True]):
                g.process_request(req,state); self.assertEqual(switch.call_args_list[-1].args,('baseline',));self.assertEqual(restart.call_count,2)
                self.assertTrue(state['paused']);self.assertNotIn('pending',state)

    def test_secrets_not_forwarded_to_candidate_environment(self):
        with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'private','GH_TOKEN':'private','BARK_KEY':'private'}):
            env=g.user_env(Path('/tmp/profile'),Path('/tmp/tree'))
        self.assertNotIn('private',env.values());self.assertNotIn('GH_TOKEN',env);self.assertNotIn('BARK_KEY',env)

if __name__=='__main__':unittest.main()
