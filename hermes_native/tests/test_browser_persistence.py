import importlib.util
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).parents[1] / 'browser_persistence.py'
spec = importlib.util.spec_from_file_location('ziwei_browser_persistence_tests', MODULE)
bp = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bp
spec.loader.exec_module(bp)


class LeaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name) / 'home'
        self.home.mkdir()
        self.manager = bp.ProfileLeases()

    def tearDown(self):
        for home, lease in list(self.manager.leases.items()):
            self.manager.release(Path(home), lease.owner)
        self.temp.cleanup()

    def test_profile_survives_release_and_new_task(self):
        first = self.manager.acquire(self.home, 'first')
        marker = first.profile / 'Cookies-fixture'
        marker.write_bytes(b'private fixture')
        self.manager.release(self.home, 'first')
        second = self.manager.acquire(self.home, 'second')
        self.assertEqual(second.profile, first.profile)
        self.assertEqual(marker.read_bytes(), b'private fixture')
        self.assertEqual((second.profile.parent / 'lease.lock').stat().st_nlink, 1)

    def test_reentrant_owner_and_competing_task(self):
        first = self.manager.acquire(self.home, 'one')
        self.assertIs(self.manager.acquire(self.home, 'one'), first)
        with self.assertRaises(bp.ProfileBusy):
            self.manager.acquire(self.home, 'two')
        self.manager.release(self.home, 'wrong-owner')
        with self.assertRaises(bp.ProfileBusy):
            self.manager.acquire(self.home, 'two')

    def test_second_process_cannot_write_profile(self):
        self.manager.acquire(self.home, 'one')
        code = '''import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import browser_persistence as b
try: b.ProfileLeases().acquire(Path(sys.argv[2]), 'other-process')
except b.ProfileBusy: sys.exit(0)
sys.exit(1)
'''
        result = subprocess.run([sys.executable, '-c', code, str(MODULE.parent), str(self.home)],
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_profiles_do_not_share_lease_or_data(self):
        other = self.home.parent / 'other'
        other.mkdir()
        a = self.manager.acquire(self.home, 'same-task')
        b = self.manager.acquire(other, 'same-task')
        self.assertNotEqual(a.profile, b.profile)

    def test_private_directory_and_lock_permissions(self):
        lease = self.manager.acquire(self.home, 'one')
        for p in [lease.profile, lease.profile.parent, lease.profile.parent.parent]:
            self.assertEqual(p.stat().st_mode & 0o777, 0o700)
        self.assertEqual((lease.profile.parent / 'lease.lock').stat().st_mode & 0o777, 0o600)

    def test_symlinked_home_refused(self):
        link = self.home.parent / 'link'
        link.symlink_to(self.home, target_is_directory=True)
        with self.assertRaises(bp.PersistenceError):
            self.manager.acquire(link, 'one')
        self.assertFalse((self.home / 'browser').exists())

    def test_symlinked_browser_and_inner_directory_refused(self):
        outside = self.home.parent / 'outside'
        outside.mkdir()
        for rel in ['browser', 'browser/ziwei-native-v1']:
            p = self.home / rel
            p.parent.mkdir(exist_ok=True)
            p.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(bp.PersistenceError):
                self.manager.acquire(self.home, 'one')
            self.assertEqual(list(outside.iterdir()), [])
            p.unlink()

    def test_symlinked_profile_does_not_delete_or_adopt_data(self):
        parent = self.home / 'browser/ziwei-native-v1'
        parent.mkdir(parents=True)
        outside = self.home.parent / 'outside'
        outside.mkdir()
        (outside / 'marker').write_text('retain')
        (parent / 'profile').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(bp.PersistenceError):
            self.manager.acquire(self.home, 'one')
        self.assertEqual((outside / 'marker').read_text(), 'retain')
        (parent / 'profile').unlink()
        self.assertIsNotNone(self.manager.acquire(self.home, 'after-failure'))

    def test_symlinked_and_hardlinked_lock_refused(self):
        parent = self.home / 'browser/ziwei-native-v1'
        parent.mkdir(parents=True)
        outside = self.home.parent / 'external-file'
        outside.write_text('retain')
        outside.chmod(0o644)
        lock = parent / 'lease.lock'
        lock.symlink_to(outside)
        with self.assertRaises(bp.PersistenceError):
            self.manager.acquire(self.home, 'one')
        lock.unlink()
        os.link(outside, lock)
        with self.assertRaises(bp.PersistenceError):
            self.manager.acquire(self.home, 'one')
        self.assertEqual(outside.read_text(), 'retain')
        self.assertEqual(outside.stat().st_mode & 0o777, 0o644)

    def test_fifo_lock_rejected_without_waiting(self):
        parent = self.home / 'browser/ziwei-native-v1'
        parent.mkdir(parents=True)
        os.mkfifo(parent / 'lease.lock')
        with self.assertRaises(bp.PersistenceError):
            self.manager.acquire(self.home, 'one')

    def test_live_daemon_blocks_release_until_native_teardown_finishes(self):
        self.manager.acquire(self.home, 'one')
        self.manager.release(self.home, 'one', live_pid=123)
        self.manager.reap_finished(self.home, lambda pid: True)
        with self.assertRaises(bp.ProfileBusy):
            self.manager.acquire(self.home, 'two')
        self.manager.reap_finished(self.home, lambda pid: False)
        self.manager.acquire(self.home, 'two')


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.config = {}
        self.native_calls = []
        self.native_env = {'PATH': '/safe/native/path'}
        self.alive = False
        self.session = types.ModuleType('tools.browser_tool_session')
        s = self.session
        s._bt = types.SimpleNamespace(_active_sessions={}, _is_local_sidecar_key=lambda t: t.endswith('::local'),
            _is_camofox_mode=lambda: False, _socket_safe_tmpdir=lambda: self.temp.name)
        s._cloud = types.SimpleNamespace(_is_headed_mode=lambda: False)
        s._browser_in_sandbox = lambda: False
        s._read_browser_daemon_pid = lambda directory, name: 123 if self.alive else None
        def env(socket_dir):
            return dict(self.native_env)
        def spawn(task_id, session_info, cmd_parts, command, engine, timeout, stdin_payload=None):
            env = s._agent_browser_command_env('socket')
            self.native_calls.append((task_id, env))
            return {'success': True, 'data': env}
        def discard(task_id, session_info, task_socket_dir):
            s._bt._active_sessions.pop(task_id, None)
        s._agent_browser_command_env = env
        s._spawn_and_collect = spawn
        s._discard_timed_out_browser_session = discard
        lifecycle = types.ModuleType('tools.browser_tool_lifecycle')
        def release(task_id, session_info):
            s._bt._active_sessions.pop(task_id, None)
        lifecycle._release_session_resources = release
        lifecycle._pid_exists = lambda pid: self.alive
        self.lifecycle = lifecycle
        config = types.ModuleType('hermes_cli.config')
        config.read_raw_config = lambda: self.config
        constants = types.ModuleType('hermes_constants')
        constants.get_hermes_home = lambda: self.home
        tools = types.ModuleType('tools')
        tools.browser_tool_session, tools.browser_tool_lifecycle = s, lifecycle
        cli = types.ModuleType('hermes_cli')
        cli.config = config
        self.modules = patch.dict(sys.modules, {'tools': tools, 'tools.browser_tool_session': s,
            'tools.browser_tool_lifecycle': lifecycle, 'hermes_cli': cli, 'hermes_cli.config': config,
            'hermes_constants': constants})
        self.modules.start()
        self.manager = bp.ProfileLeases()
        self.leases_patch = patch.object(bp, 'LEASES', self.manager)
        self.leases_patch.start()
        bp.install()

    def tearDown(self):
        for home, lease in list(self.manager.leases.items()):
            self.manager.release(Path(home), lease.owner)
        self.leases_patch.stop()
        self.modules.stop()
        self.temp.cleanup()

    def run_command(self, task='one', info=None, argv=None, engine='auto', command='open'):
        if info is None:
            info = self.info(task)
        self.session._bt._active_sessions[task] = info
        return self.session._spawn_and_collect(task, info, argv or ['browser', '--session', task], command, engine, 30)

    def info(self, name):
        return {'session_name': name, 'features': {'local': True}, 'cdp_url': None, 'bb_session_id': None}

    def test_profile_injected_after_native_env_without_global_environment_mutation(self):
        before = dict(os.environ)
        result = self.run_command()
        self.assertTrue(result['success'])
        self.assertEqual(result['data']['PATH'], '/safe/native/path')
        self.assertEqual(result['data']['AGENT_BROWSER_PROFILE'], str(self.home / 'browser/ziwei-native-v1/profile'))
        self.assertEqual(dict(os.environ), before)
        self.assertIsNone(bp.COMMAND_PROFILE.get())

    def test_competing_task_returns_busy_without_spawning_or_recycling(self):
        info = self.info('first')
        self.run_command('first', info)
        result = self.run_command('second')
        self.assertEqual(result['code'], 'browser_profile_busy')
        self.assertNotIn('returncode', result)
        self.assertEqual(len(self.native_calls), 1)
        self.lifecycle._release_session_resources('first', info)
        self.assertTrue(self.run_command('second')['success'])

    def test_profile_binding_survives_changed_cleanup_context(self):
        original = self.home
        info = self.info('first')
        self.run_command('first', info)
        self.home = self.home / 'other'
        self.home.mkdir()
        result = self.run_command('first', info, command='close')
        self.assertEqual(result['data']['AGENT_BROWSER_PROFILE'], str(original / 'browser/ziwei-native-v1/profile'))
        self.lifecycle._release_session_resources('first', info)
        self.assertEqual(self.manager.leases, {})

    def test_opt_out_retains_native_disposable_browser(self):
        self.config = {'browser': {'persistence': {'enabled': False}}}
        result = self.run_command()
        self.assertNotIn('AGENT_BROWSER_PROFILE', result['data'])
        self.assertFalse((self.home / 'browser').exists())

    def test_invalid_setting_refuses_silent_nonpersistent_fallback(self):
        self.config = {'browser': {'persistence': {'enabled': 'false'}}}
        self.assertEqual(self.run_command()['code'], 'browser_persistence_unavailable')
        self.assertEqual(self.native_calls, [])

    def test_cloud_cdp_lightpanda_sidecar_headed_and_sandbox_unmodified(self):
        for changes, argv, engine, task in [
            ({'bb_session_id': 'cloud'}, None, 'auto', 'cloud'),
            ({'cdp_url': 'ws://test-only'}, None, 'auto', 'cdp'),
            ({'features': {'local': True, 'real_profile': True}}, None, 'auto', 'real'),
            ({}, None, 'lightpanda', 'lp'),
            ({}, None, 'auto', 'hybrid::local'),
            ({}, ['browser', '--cdp', '1234'], 'auto', 'attach'),
            ({}, ['browser', '--headed'], 'auto', 'headed'),
        ]:
            info = self.info(task)
            info.update(changes)
            result = self.run_command(task, info, argv, engine)
            self.assertNotIn('AGENT_BROWSER_PROFILE', result['data'], task)
        self.session._browser_in_sandbox = lambda: True
        self.assertNotIn('AGENT_BROWSER_PROFILE', self.run_command('sandbox')['data'])
        self.session._browser_in_sandbox = lambda: False
        self.session._bt._is_camofox_mode = lambda: True
        self.assertNotIn('AGENT_BROWSER_PROFILE', self.run_command('camofox')['data'])
        self.assertEqual(self.manager.leases, {})

    def test_existing_explicit_profile_refused_without_overwriting_it(self):
        self.native_env['AGENT_BROWSER_PROFILE'] = '/explicit-test-only-profile'
        result = self.run_command()
        self.assertEqual(result['code'], 'browser_persistence_unavailable')
        self.assertEqual(self.native_env['AGENT_BROWSER_PROFILE'], '/explicit-test-only-profile')
        self.assertEqual(self.native_calls, [])
        self.assertEqual(self.manager.leases, {})
        self.assertIsNone(bp.COMMAND_PROFILE.get())

    def test_timeout_eviction_releases_only_after_native_daemon_is_gone(self):
        info = self.info('first')
        self.run_command('first', info)
        self.alive = True
        self.session._discard_timed_out_browser_session('first', info, 'socket')
        self.assertEqual(self.run_command('second')['code'], 'browser_profile_busy')
        self.alive = False
        self.assertTrue(self.run_command('second')['success'])

    def test_install_is_idempotent_and_rejects_changed_candidate_contract(self):
        installed = self.session._spawn_and_collect
        bp.install()
        self.assertIs(self.session._spawn_and_collect, installed)
        self.session._ziwei_persistence_installed = False
        self.session._spawn_and_collect = lambda changed: None
        with self.assertRaises(RuntimeError):
            bp.install()


if __name__ == '__main__':
    unittest.main()
