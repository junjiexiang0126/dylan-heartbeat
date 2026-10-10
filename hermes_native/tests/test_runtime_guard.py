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
            with patch.object(g,'HOME',root),patch.object(g,'REQUESTS',requests),patch.object(g,'CONTROL',control),patch.object(g,'health',return_value=True),patch.object(g,'notify',return_value=True) as push,patch.object(g,'switch') as switch,patch.object(g,'restart_gateway') as restart:
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
            with patch.object(g,'HOME',root),patch.object(g,'REQUESTS',requests),patch.object(g,'CONTROL',control),patch.object(g,'TREES',trees),patch.object(g,'health',return_value=True),patch.object(g,'notify',return_value=False),patch.object(g,'mirror_tree'),patch.object(g,'validate_candidate',side_effect=ValueError('native_import_test')),patch.object(g,'switch') as switch,patch.object(g,'backup_profile') as backup:
                g.process_request(req,state); switch.assert_not_called();backup.assert_not_called()
                self.assertEqual(state['active'],'baseline'); self.assertTrue(state['paused'])

    def test_runtime_health_failure_rolls_back(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);requests=root/'requests';(requests/'patches'/'agent').mkdir(parents=True)
            (requests/'patches'/'agent'/'a.py').write_text('value = 2\n');control=root/'control';(control/'releases').mkdir(parents=True);trees=root/'trees';trees.mkdir()
            req=requests/'test.json';req.write_text(json.dumps({'base':'baseline','files':['agent/a.py']}))
            state={'active':'baseline','previous':'baseline','paused':False,'processed':[],'attempts':[]}
            with patch.object(g,'HOME',root),patch.object(g,'REQUESTS',requests),patch.object(g,'CONTROL',control),patch.object(g,'TREES',trees),patch.object(g,'health',return_value=True),patch.object(g,'notify',return_value=False),patch.object(g,'mirror_tree'),patch.object(g,'validate_candidate'),patch.object(g,'backup_profile'),patch.object(g,'switch') as switch,patch.object(g,'restart_gateway') as restart,patch.object(g,'await_health',side_effect=[False,True]):
                g.process_request(req,state); self.assertEqual(switch.call_args_list[-1].args,('baseline',));self.assertEqual(restart.call_count,2)
                self.assertTrue(state['paused']);self.assertNotIn('pending',state)

    def test_secrets_not_forwarded_to_candidate_environment(self):
        with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'private','GH_TOKEN':'private','BARK_KEY':'private'}):
            env=g.user_env(Path('/tmp/profile'),Path('/tmp/tree'))
        self.assertNotIn('private',env.values());self.assertNotIn('GH_TOKEN',env);self.assertNotIn('BARK_KEY',env)



class IncidentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name); self.control = root/'control'; self.control.mkdir()
        self.requests = root/'requests'; self.requests.mkdir()
        self.state = {'active':'r-new','previous':'baseline','paused':False,'processed':[],'attempts':[]}
        for name,value in [('HOME',root),('CONTROL',self.control),('REQUESTS',self.requests)]:
            p=patch.object(g,name,value);p.start();self.addCleanup(p.stop)

    def test_rollback_exception_still_pauses_records_and_notifies(self):
        with patch.object(g,'switch',side_effect=OSError('private error content')),patch.object(g,'restart_gateway',side_effect=OSError('private error content')),patch.object(g,'notify',return_value=True) as push:
            for _ in range(8):g.monitor_once(self.state,False)
            self.assertTrue(self.state['paused']);push.assert_called_once()
            saved=json.loads((self.control/'state.json').read_text())
            public=json.loads((self.requests/'status.json').read_text())
            self.assertEqual(saved['last_result'],public['last_result'])
            self.assertEqual(saved['last_result']['rollback'],'recovery_failed')
            self.assertEqual(saved['last_result']['notification'],'submitted')
            self.assertNotIn('private error content',(self.control/'state.json').read_text())

    def test_incident_survives_guardian_restart_and_transient_recovery(self):
        with patch.object(g,'switch'),patch.object(g,'restart_gateway'),patch.object(g,'notify',return_value=False) as push:
            for _ in range(6):g.monitor_once(self.state,False)
            restarted=json.loads((self.control/'state.json').read_text())
            for _ in range(4):g.monitor_once(restarted,False)
            g.monitor_once(restarted,True);g.monitor_once(restarted,False)
            push.assert_called_once()
            self.assertEqual(restarted['last_result']['notification'],'not_accepted')
            for _ in range(3):g.monitor_once(restarted,True)
            self.assertTrue(restarted['paused'])
            for _ in range(6):g.monitor_once(restarted,False)
            self.assertEqual(push.call_count,2)

    def test_successful_rollback_retains_failure_receipt(self):
        with patch.object(g,'switch') as switch,patch.object(g,'restart_gateway') as restart,patch.object(g,'notify',return_value=True):
            for _ in range(6):g.monitor_once(self.state,False)
            switch.assert_called_once_with('baseline');self.assertEqual(restart.call_count,2)
            self.assertEqual(self.state['active'],'baseline')
            self.assertEqual(self.state['last_result']['rollback'],'switched')
            self.assertTrue(self.state['paused'])

    def test_early_restart_attempt_durable_and_single(self):
        with patch.object(g,'restart_gateway',side_effect=OSError('simulated')) as restart:
            for _ in range(3):g.monitor_once(self.state,False)
            restarted=json.loads((self.control/'state.json').read_text())
            g.monitor_once(restarted,False);restart.assert_called_once()
            self.assertTrue(restarted['health_monitor']['restart_failed'])
            self.assertFalse(restarted['paused'])

    def test_interrupted_notification_is_not_resent(self):
        class Interrupted(BaseException):pass
        with patch.object(g,'switch'),patch.object(g,'restart_gateway'),patch.object(g,'notify',side_effect=Interrupted) as push:
            for _ in range(5):g.monitor_once(self.state,False)
            with self.assertRaises(Interrupted):g.monitor_once(self.state,False)
            restarted=json.loads((self.control/'state.json').read_text())
            g.monitor_once(restarted,False);push.assert_called_once()
            self.assertEqual(restarted['last_result']['notification'],'delivery_unknown')
            self.assertTrue(restarted['paused'])

    def test_resume_incident_if_process_exits_before_notification_reservation(self):
        self.state.update(paused=True,health_monitor={'failures':6,'successes':0,'restart_attempted':True,'incident':'fixture'},last_result={'ok':False,'category':'gateway_unhealthy','incident':'fixture','notification':'not_attempted','bark_accepted':False})
        with patch.object(g,'switch'),patch.object(g,'restart_gateway'),patch.object(g,'notify',return_value=True) as push:
            g.monitor_once(self.state,False);push.assert_called_once()
            self.assertEqual(self.state['last_result']['notification'],'submitted')

    def test_short_network_blips_do_not_accumulate_failures(self):
        with patch.object(g,'restart_gateway') as restart,patch.object(g,'notify') as push:
            for healthy in [False,False,True,False,False,True,False]:
                g.monitor_once(self.state,healthy)
            restart.assert_not_called();push.assert_not_called()
            self.assertEqual(self.state['health_monitor']['failures'],1)
            self.assertFalse(self.state['paused'])

    def test_s6_down_pid_is_zero(self):
        with patch.object(g.subprocess,'check_output',return_value=b'-1\n'):
            self.assertEqual(g.gateway_pid(),0)

    def test_fifo_input_fails_without_waiting_for_a_writer(self):
        fifo=self.requests/'pipe';os.mkfifo(fifo)
        with self.assertRaises(ValueError):g.read_regular_beneath(self.requests,'pipe',100)

    def test_candidate_auth_regression_fails_before_promotion(self):
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):return False
        with patch.object(g.urllib.request,'urlopen',return_value=Response()):
            with self.assertRaisesRegex(ValueError,'isolated_gateway_auth'):
                g.verify_candidate_auth('http://isolated.invalid','fake-key')

    def test_candidate_auth_validates_routes_valid_key_and_cors(self):
        def respond(request,**kw):
            auth=request.get_header('Authorization');origin=request.get_header('Origin')
            status=403 if origin else 200 if auth=='Bearer fake-key' else 401
            if status!=200:
                raise g.urllib.error.HTTPError(request.full_url,status,'synthetic',{},None)
            class Response:
                status=200
                def __enter__(self):return self
                def __exit__(self,*args):return False
            return Response()
        with patch.object(g.urllib.request,'urlopen',side_effect=respond) as open_url:
            g.verify_candidate_auth('http://isolated.invalid','fake-key')
            self.assertEqual(open_url.call_count,20)


class DirectoryBoundaryTests(unittest.TestCase):
    def test_privileged_directory_owner_rejects_mutable_symlink_parents(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);outside=root/'outside';outside.mkdir();(outside/'self-update').mkdir()
            home=root/'home';home.mkdir();(home/'workspace').symlink_to(outside)
            with patch.object(g.os,'fchown') as chown:
                with self.assertRaises(OSError):
                    g.open_directory_beneath(home,'workspace/self-update',create=True,owner=(10000,10000))
                chown.assert_not_called()

    def test_status_publish_refuses_redirected_profile_parent(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);outside=root/'outside';outside.mkdir();(outside/'requests').mkdir()
            home=root/'home';home.mkdir();(home/'workspace').symlink_to(outside)
            with patch.object(g,'HOME',home),patch.object(g,'REQUESTS',home/'workspace/requests'):
                with self.assertRaises(OSError):g.publish({'active':'baseline'})
                self.assertFalse((outside/'requests/status.json').exists())

    def test_directory_descriptor_stays_with_checked_inode_when_path_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);home=root/'home';home.mkdir();workspace=home/'workspace';workspace.mkdir()
            outside=root/'outside';outside.mkdir()
            real_open=g.os.open
            def racing_open(path,flags,**kwargs):
                fd=real_open(path,flags,**kwargs)
                if path=='workspace':
                    workspace.rename(home/'original');workspace.symlink_to(outside)
                return fd
            with patch.object(g.os,'open',side_effect=racing_open):
                fd=g.open_directory_beneath(home,'workspace/self-update',create=True)
                g.os.close(fd)
            self.assertTrue((home/'original/self-update').is_dir())
            self.assertFalse((outside/'self-update').exists())


if __name__ == '__main__': unittest.main()
