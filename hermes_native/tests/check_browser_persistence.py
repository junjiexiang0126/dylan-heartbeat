"""Synthetic browser fixture ONLY in the disposable official-container CI.

Write in one process, read in another after a full container restart. Uses only a
loopback web page and fake credentials; never visits accounts or calls a model.
"""
import argparse
import json
import os
import stat
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Page(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        if self.path == '/seed':
            self.send_header('Set-Cookie', 'ziwei_fixture=persisted; Path=/; HttpOnly; Max-Age=3600; SameSite=Lax')
        self.end_headers()
        seed = "localStorage.setItem('ziwei_fixture', 'persisted');" if self.path == '/seed' else ''
        cookie_ok = 'ziwei_fixture=persisted' in self.headers.get('Cookie', '')
        self.wfile.write((f'<html><title>Ziwei synthetic browser</title><body data-cookie="{int(cookie_ok)}">'
                         f'<button>Fixture</button><script>{seed}</script></body></html>').encode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['write', 'read'])
    mode = parser.parse_args().mode
    assert os.environ.get('ZIWEI_EPHEMERAL_BROWSER_TEST') == '1'
    assert os.environ.get('API_SERVER_KEY') == 'startup-check-only-distinct-not-a-live-credential'
    assert os.environ.get('DEEPSEEK_API_KEY') == 'startup-check-only-no-model-request'
    assert Path('/data/legacy-marker').read_text() == 'legacy-data-preserved'
    assert os.geteuid() == 10000, 'Browser fixture must run as non-root hermes.'
    # Deliberately do NOT call runtime_launch.activate/install: this proves the
    # ordinary native import used by CLI/Cron has the adapter too.
    sys.path.insert(0, '/opt/hermes')
    import hermes_bootstrap
    from tools import browser_tool, browser_tool_session as session, browser_tool_lifecycle as lifecycle
    assert session._ziwei_persistence_installed
    from hermes_constants import get_hermes_home
    home = Path(get_hermes_home())
    profile = home / 'browser/ziwei-native-v1/profile'
    before = {name: (home / name).read_bytes() for name in ['config.yaml', 'SOUL.md', 'scripts/autonomy_gate.py']
              if (home / name).is_file()}
    server = ThreadingHTTPServer(('127.0.0.1', 18649), Page)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def command(task, verb, args):
        result = session._run_browser_command(task, verb, args, timeout=60)
        assert result.get('success'), f'{verb} failed: {result.get("code", "native_backend_error")}'
        return result

    def read_state(task):
        result = command(task, 'eval', ["JSON.stringify({cookie:document.body.dataset.cookie,storage:localStorage.getItem('ziwei_fixture')})"])
        value = result['data']['result']
        return json.loads(value) if isinstance(value, str) else value

    try:
        task = 'ziwei-fixture-' + mode
        command(task, 'open', ['http://127.0.0.1:18649/' + ('seed' if mode == 'write' else 'check')])
        if mode == 'write':
            command(task, 'open', ['http://127.0.0.1:18649/check'])
        assert read_state(task) == {'cookie': '1', 'storage': 'persisted'}
        command(task, 'snapshot', ['-c'])
        command(task, 'screenshot', [str(home / 'workspace/browser-fixture.png')])
        assert (home / 'workspace/browser-fixture.png').stat().st_size > 0
        # Another task cannot start a second Chromium on the same disk profile.
        contender = session._run_browser_command('ziwei-fixture-contender', 'open', ['http://127.0.0.1:18649/check'])
        assert contender.get('code') == 'browser_profile_busy'
        assert not contender.get('success')
        lifecycle.cleanup_browser('ziwei-fixture-contender')
        lifecycle.cleanup_browser(task)
        # A new task gets a new daemon but the same persisted cookies/storage.
        command('ziwei-fixture-followup', 'open', ['http://127.0.0.1:18649/check'])
        assert read_state('ziwei-fixture-followup') == {'cookie': '1', 'storage': 'persisted'}
        info = session._get_session_info('ziwei-fixture-followup')
        env = session._agent_browser_command_env(session._prepare_session_socket_dir(info['session_name']))
        assert 'DEEPSEEK_API_KEY' not in env and 'API_SERVER_KEY' not in env
        lifecycle.cleanup_browser('ziwei-fixture-followup')
        assert profile.is_dir() and stat.S_IMODE(profile.stat().st_mode) == 0o700
        assert stat.S_IMODE((profile.parent / 'lease.lock').stat().st_mode) == 0o600
        for name, original in before.items():
            assert (home / name).read_bytes() == original
        print(json.dumps({'mode': mode, 'cookie_and_local_storage': 'passed', 'task_handoff': 'passed',
                          'concurrent_writer_rejected': True, 'snapshot_and_screenshot': 'passed',
                          'credential_env_scrubbing': 'passed', 'core_files_unchanged': True,
                          'uid': os.geteuid(), 'model_requests': 0}))
    finally:
        lifecycle.cleanup_all_browsers()
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == '__main__':
    main()
