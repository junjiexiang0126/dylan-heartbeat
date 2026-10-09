"""Root-owned, model-free controller for tested Python overlays in one Hermes service.

Application code is always tested and run as hermes. Docker launchers, dependencies,
this controller, credentials and profile identity are outside the patch boundary.
"""
import ast
import hashlib
import json
import os
import pwd
import re
import secrets
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE = Path('/opt/hermes')
CONTROL = Path('/data/ziwei_control')
TREES = Path('/opt/ziwei-runtime')
HOME = Path(os.environ.get('HERMES_HOME', '/data/hermes_native'))
REQUESTS = HOME / 'workspace' / 'self-update'
VERSION = '0.21.6'
ALLOWED = ('agent/', 'gateway/', 'tools/', 'cron/', 'plugins/')
TOP_FILES = {'run_agent.py', 'model_tools.py', 'toolsets.py', 'hermes_state.py', 'hermes_state_messages.py'}
ID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,48}$')
MAX_BYTES = 2 * 1024 * 1024
HEALTH_INTERVAL = 15
RESTART_FAILURES = 3
INCIDENT_FAILURES = 6
RECOVERY_SUCCESSES = 3


def atomic_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def read_state():
    p = CONTROL / 'state.json'
    return json.loads(p.read_text()) if p.exists() else {'active': 'baseline', 'previous': 'baseline', 'paused': False, 'processed': [], 'attempts': []}


def safe_patch_path(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or path.suffix != '.py':
        raise ValueError('patch_path')
    if not (name in TOP_FILES or name.startswith(ALLOWED)):
        raise ValueError('patch_boundary')
    if any(p.startswith(('.', 'python-', 'node-', 'npm-', 'chromium-', 'uv-', 'ffmpeg-', 'ripgrep-')) or p in {'__pycache__', 'node_modules'} for p in path.parts):
        raise ValueError('hidden_patch')
    return path


def read_regular_beneath(root, relative, limit):
    """Walk descriptors with O_NOFOLLOW, including parents, to avoid redirects/races."""
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or '..' in parts:
        raise ValueError('unsafe_input')
    fd = (open_directory_beneath(HOME, root.relative_to(HOME)) if root == REQUESTS
          else os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        leaf = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            info = os.fstat(leaf)
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise ValueError('input_size_or_type')
            data = os.read(leaf, limit + 1)
            if len(data) > limit:
                raise ValueError('input_size')
            return data
        finally:
            os.close(leaf)
    finally:
        os.close(fd)


def open_directory_beneath(root, relative, create=False, owner=None):
    """Never follow mutable profile parents during privileged directory work."""
    relative = Path(relative)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('directory_boundary')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in relative.parts:
            if create:
                try: os.mkdir(name, dir_fd=fd)
                except FileExistsError: pass
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        if owner is not None: os.fchown(fd, *owner)
        return fd
    except BaseException:
        os.close(fd)
        raise


def mirror_tree(destination, overlays):
    """Reuse image bytes/dependencies. Only accepted changed files occupy the volume."""
    destination.mkdir(parents=True, exist_ok=False)
    for current, dirs, files in os.walk(BASE, followlinks=False):
        current = Path(current); rel = current.relative_to(BASE); target = destination / rel
        target.mkdir(exist_ok=True)
        for name in list(dirs):
            source = current / name
            if name in {'.venv', '.git', '__pycache__', 'node_modules'} or source.is_symlink() or name.startswith(('chromium-', 'python-', 'node-', 'npm-', 'ffmpeg-', 'uv-', 'ripgrep-')):
                if name not in {'.git', '__pycache__'}:
                    (target / name).symlink_to(source.resolve(), target_is_directory=True)
                dirs.remove(name)
        for name in files:
            if not name.endswith('.pyc'):
                (target / name).symlink_to((current / name).resolve())
    for name, data in overlays.items():
        p = destination / safe_patch_path(name)
        if not p.parent.resolve().is_relative_to(destination.resolve()):
            raise ValueError('patch_symlink_parent')
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.is_symlink() or p.exists(): p.unlink()
        p.write_bytes(data); p.chmod(0o644)


def overlays_for(release):
    if release == 'baseline': return {}
    root = CONTROL / 'releases' / release / 'patches'
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*.py')}


def switch(release):
    path = TREES / release
    if not path.exists(): mirror_tree(path, overlays_for(release))
    temporary = TREES / '.current-new'
    temporary.unlink(missing_ok=True); temporary.symlink_to(path)
    os.replace(temporary, TREES / 'current')


def publish(state, result=None):
    # Public state contains fixed categories and hashes, never logs or credentials.
    public = {k: state.get(k) for k in ('active', 'previous', 'paused', 'failure_category')}
    if result or state.get('last_result'): public['last_result'] = result or state['last_result']
    fd = open_directory_beneath(HOME, REQUESTS.relative_to(HOME))
    name = '.status-' + secrets.token_hex(8)
    try:
        output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=fd)
        with os.fdopen(output, 'w') as stream:
            stream.write(json.dumps(public, ensure_ascii=False, indent=2))
        os.rename(name, 'status.json', src_dir_fd=fd, dst_dir_fd=fd)
    finally:
        os.close(fd)


def notify(category, release):
    credential = CONTROL / 'bark.json'
    if not credential.exists(): return False
    try:
        conf = json.loads(credential.read_text())
        key = conf['key']
        payload = json.dumps({'device_key': key, 'title': '知微故障通知', 'body': f'故障类型：{category}；版本：{release[:48]}。自动更新已停止，请在知微查看状态或联系维护者。', 'group': '知微故障', 'isArchive': 0}).encode()
        req = urllib.request.Request('https://api.day.app/push', data=payload, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status == 200 and json.loads(response.read()).get('code') == 200
    except Exception:
        return False


def user_env(home, tree):
    # Tests receive no live API tokens or push keys, and no external SSH access.
    return {'PATH': '/opt/hermes/bin:/opt/hermes/.venv/bin:/usr/local/bin:/usr/bin:/bin', 'HOME': str(home), 'HERMES_HOME': str(home), 'PYTHONPATH': str(tree), 'PYTHONDONTWRITEBYTECODE': '1', 'DEEPSEEK_API_KEY': 'isolated-test-no-live-model', 'API_SERVER_KEY': 'isolated-test-no-live-access-token-12345', 'HERMES_WRITE_SAFE_ROOT': str(home / 'workspace'), 'HERMES_SUPERVISED_CHILD': '1', 'HERMES_S6_SUPERVISED_CHILD': '1', 'HERMES_GATEWAY_NO_SUPERVISE': '1'}


def unprivileged():
    user = pwd.getpwnam('hermes')
    os.setgroups([]); os.setgid(user.pw_gid); os.setuid(user.pw_uid)


def verify_candidate_auth(base_url, key):
    """Immutable, model-free checks against the isolated candidate's real routes."""
    routes = [('GET', '/v1/models'), ('GET', '/api/sessions'),
              ('GET', '/api/sessions/security-probe/messages'),
              ('GET', '/api/jobs'), ('GET', '/v1/runs/security-probe'),
              ('GET', '/p/default/v1/models'),
              ('POST', '/v1/chat/completions'), ('POST', '/v1/runs'),
              ('POST', '/api/jobs')]

    def status(method, path, token=None, origin=None):
        headers = {'Content-Type': 'application/json'}
        if token is not None: headers['Authorization'] = 'Bearer ' + token
        if origin is not None: headers['Origin'] = origin
        # Invalid JSON prevents a paid turn even if a candidate removes auth.
        request = urllib.request.Request(base_url + path, method=method,
                                         data=b'{' if method == 'POST' else None,
                                         headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            exc.close()
            return exc.code

    for method, path in routes:
        for token in (None, 'wrong-isolated-auth-token'):
            if status(method, path, token) != 401:
                raise ValueError('isolated_gateway_auth')
    if status('GET', '/v1/models', key) != 200:
        raise ValueError('isolated_gateway_valid_auth')
    if status('GET', '/v1/models', key, 'https://untrusted.example') != 403:
        raise ValueError('isolated_gateway_cors')


def validate_candidate(tree):
    """Canonical tests from the immutable integration layer, not candidate-authored tests."""
    user = pwd.getpwnam('hermes')
    with tempfile.TemporaryDirectory(prefix='ziwei-preflight-') as tmp:
        home = Path(tmp); os.chown(home, user.pw_uid, user.pw_gid)
        # Persistent user data never enters the test profile.
        for name in ['workspace', 'cron', 'memories', 'skills']:
            p = home / name; p.mkdir(); os.chown(p, user.pw_uid, user.pw_gid)
        config = {'model': {'default': 'deepseek-flash', 'provider': 'ziwei-deepseek'}, 'providers': {'openrouter': {'enabled': False}, 'ziwei-deepseek': {'base_url': 'https://api.deepseek.com/v1', 'key_env': 'DEEPSEEK_API_KEY'}}, 'platforms': {'api_server': {'enabled': True, 'extra': {'host': '127.0.0.1', 'port': 8765, 'tool_progress_events': False}}}, 'platform_toolsets': {'api_server': ['hermes-api-server','kanban','tts']}, 'kanban': {'dispatch_in_gateway': False, 'review_dispatch': False, 'auto_decompose': False}, 'auxiliary': {'background_review': {'enabled': False}}, 'model_catalog': {'enabled': False}, 'fallback_model': []}
        p = home / 'config.yaml'; p.write_text(json.dumps(config)); os.chown(p, user.pw_uid, user.pw_gid)
        env = user_env(home, tree)
        result = subprocess.run([str(BASE / '.venv/bin/python'), '/opt/ziwei-native/runtime_launch.py', '--preflight', str(tree)], env=env, cwd=tree, preexec_fn=unprivileged, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
        if result.returncode: raise ValueError('native_import_test')
        env['ZIWEI_TEST_TREE'] = str(tree)
        proc = subprocess.Popen([str(BASE / '.venv/bin/python'), '/opt/ziwei-native/runtime_launch.py', 'gateway', 'run', '--no-supervise', '--force'], env=env, cwd=tree, preexec_fn=unprivileged, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 65
            while time.monotonic() < deadline:
                if proc.poll() is not None: raise ValueError('isolated_gateway_exit')
                try:
                    with urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=2) as r:
                        if r.status == 200:
                            break
                except Exception: pass
                time.sleep(1)
            else:
                raise ValueError('isolated_gateway_health')
            verify_candidate_auth('http://127.0.0.1:8765', env['API_SERVER_KEY'])
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try: proc.wait(timeout=12)
                except subprocess.TimeoutExpired: os.killpg(proc.pid, signal.SIGKILL); proc.wait()


def backup_profile(release):
    target = CONTROL / 'releases' / release / 'profile-backup'; target.mkdir()
    for name in ['SOUL.md', 'config.yaml', 'memories/MEMORY.md', 'memories/USER.md']:
        source = HOME / name
        if source.is_file() and not source.is_symlink():
            dest = target / name; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, dest)
    for source in HOME.rglob('*.db'):
        if source.is_symlink() or any(x in source.parts for x in ['backups', 'history_archive', 'workspace']): continue
        destination = target / source.relative_to(HOME); destination.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise ValueError('backup_integrity')


def restart_gateway():
    service = Path('/run/service/gateway-default')
    if not service.exists(): raise ValueError('gateway_supervisor_missing')
    old_pid = gateway_pid()
    # Hermes's native finish script treats a clean exit as an intentional stop.
    # Stop, wait for the actual child to exit, then explicitly bring it up.
    subprocess.run(['/command/s6-svc', '-d', str(service)], check=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        if gateway_pid() == 0: break
        time.sleep(0.5)
    if gateway_pid() != 0:
        subprocess.run(['/command/s6-svc', '-k', str(service)], check=True, timeout=10)
        for _ in range(10):
            if gateway_pid() == 0: break
            time.sleep(0.5)
    subprocess.run(['/command/s6-svc', '-u', str(service)], check=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return old_pid


def gateway_pid():
    output = subprocess.check_output(['/command/s6-svstat', '-o', 'pid', '/run/service/gateway-default'], timeout=5, stderr=subprocess.DEVNULL)
    # s6 reports -1 for a down service, rather than zero.
    return max(0, int(output.strip()))


def health():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8642/health', timeout=3) as r:
            return r.status == 200 and json.loads(r.read()).get('status') == 'ok'
    except Exception: return False


def await_health(previous_pid=None):
    # Wait for the old process to leave before counting the new one as healthy.
    time.sleep(3)
    consecutive = 0
    for _ in range(45):
        fresh = previous_pid is None or (gateway_pid() > 0 and gateway_pid() != previous_pid)
        consecutive = consecutive + 1 if fresh and health() else 0
        if consecutive >= 3: return True
        time.sleep(1)
    return False


def fail(state, request_id, category):
    state.update(paused=True, failure_category=category)
    state['processed'] = (state['processed'] + [request_id])[-100:]
    result = {'id': request_id, 'ok': False, 'category': category, 'bark_accepted': notify(category, state['active'])}
    state['last_result'] = result
    atomic_json(CONTROL / 'state.json', state)
    publish(state, result)


def process_request(path, state):
    request_id = path.stem
    if not ID_RE.fullmatch(request_id): return
    if request_id in state['processed'] or state['paused']: return
    if not health(): return
    try:
        request = json.loads(read_regular_beneath(REQUESTS, path.name, 20000))
        if request.get('base') != state['active']: raise ValueError('stale_base')
        files = request.get('files')
        if not isinstance(files, list) or not 1 <= len(files) <= 20: raise ValueError('patch_count')
        attempts = [x for x in state['attempts'] if x > time.time() - 86400]
        if len(attempts) >= 2: raise ValueError('daily_update_limit')
        attempts.append(time.time()); state['attempts'] = attempts
        atomic_json(CONTROL / 'state.json', state)
        changes = overlays_for(state['active']); total = 0
        for name in files:
            rel = safe_patch_path(name)
            data = read_regular_beneath(REQUESTS, Path('patches') / rel, MAX_BYTES)
            total += len(data)
            if total > MAX_BYTES: raise ValueError('patch_size')
            ast.parse(data, filename=name); changes[name] = data
        if shutil.disk_usage(CONTROL).free < 50 * 1024 * 1024: raise ValueError('low_disk')
        digest = hashlib.sha256(b''.join(n.encode()+b'\0'+v for n,v in sorted(changes.items()))).hexdigest()[:16]
        release = 'r-' + digest
        root = CONTROL / 'releases' / release
        if root.exists(): raise ValueError('duplicate_release')
        patches = root / 'patches'; patches.mkdir(parents=True)
        for name, data in changes.items():
            dest = patches / name; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data); dest.chmod(0o644)
        tree = TREES / release; mirror_tree(tree, changes)
        validate_candidate(tree)
        backup_profile(release)
        previous = state['active']
        # Journal before the switch: startup rolls interrupted promotions back.
        state['pending'] = {'new': release, 'old': previous}; atomic_json(CONTROL / 'state.json', state)
        switch(release)
        try:
            previous_pid = restart_gateway()
            if not await_health(previous_pid): raise ValueError('runtime_health')
        except Exception:
            switch(previous)
            try:
                previous_pid = restart_gateway(); await_health(previous_pid)
            finally:
                state.pop('pending', None)
            raise ValueError('runtime_rolled_back')
        state.update(active=release, previous=previous, failure_category=None)
        state.pop('pending', None); state['processed'] = (state['processed'] + [request_id])[-100:]
        state['last_result'] = {'id': request_id, 'ok': True, 'category': 'tests_and_restart_passed'}
        atomic_json(CONTROL / 'state.json', state); publish(state)
        keep = {release, previous}
        for old in (CONTROL / 'releases').iterdir():
            if old.name not in keep: shutil.rmtree(old)
        for old in TREES.iterdir():
            if old.is_dir() and not old.is_symlink() and old.name not in keep | {'baseline'}: shutil.rmtree(old)
    except Exception as exc:
        category = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r'[a-z_]+', str(exc)) else type(exc).__name__
        fail(state, request_id, category)


def initialize():
    for p in [CONTROL, CONTROL / 'releases', TREES]:
        if p.is_symlink(): raise RuntimeError('controller_path_redirect')
        p.mkdir(parents=True, exist_ok=True)
    CONTROL.chmod(0o700); TREES.chmod(0o755)
    user = pwd.getpwnam('hermes')
    for p in [HOME / 'workspace', REQUESTS, REQUESTS / 'patches']:
        fd = open_directory_beneath(HOME, p.relative_to(HOME), create=True,
                                    owner=(user.pw_uid, user.pw_gid))
        os.close(fd)
    state = read_state()
    if state.get('pending'):
        state['active'] = state['pending']['old']; state.pop('pending')
        state.update(paused=True, failure_category='interrupted_promotion')
        state['last_result'] = {'ok':False,'category':'interrupted_promotion','bark_accepted':notify('interrupted_promotion',state['active'])}
        atomic_json(CONTROL / 'state.json', state)
    switch(state['active']); publish(state)
    return state


def monitor_once(state, healthy):
    """Persist incident state before recovery/notification side effects.

    A Guardian restart keeps the same incident. Three healthy checks close it;
    recovery does not silently resume updates paused after a fault.
    """
    monitor = state.setdefault('health_monitor', {'failures': 0, 'successes': 0})
    if healthy:
        if monitor['failures']:
            monitor['successes'] = monitor.get('successes', 0) + 1
            if monitor['successes'] >= RECOVERY_SUCCESSES:
                monitor.clear(); monitor.update(failures=0, successes=0)
            atomic_json(CONTROL / 'state.json', state)
        return
    monitor['failures'] += 1
    monitor['successes'] = 0
    # Reserving attempts durably prevents retries/storms if this process exits.
    restart_due = monitor['failures'] >= RESTART_FAILURES and not monitor.get('restart_attempted')
    if restart_due: monitor['restart_attempted'] = True
    incident_due = monitor['failures'] >= INCIDENT_FAILURES and not monitor.get('incident')
    if incident_due:
        monitor['incident'] = secrets.token_hex(8)
        state.update(paused=True, failure_category='gateway_unhealthy')
        state['last_result'] = {'ok': False, 'category': 'gateway_unhealthy',
                                'incident': monitor['incident'], 'rollback': 'not_needed',
                                'notification': 'not_attempted', 'bark_accepted': False}
    atomic_json(CONTROL / 'state.json', state)
    if restart_due:
        try: restart_gateway()
        except Exception:
            monitor['restart_failed'] = True
            atomic_json(CONTROL / 'state.json', state)
    resume_incident = (monitor.get('incident') and
                       state.get('last_result', {}).get('incident') == monitor['incident'] and
                       state['last_result'].get('notification') == 'not_attempted')
    if not (incident_due or resume_incident): return
    result = state['last_result']
    # Pausing has already been committed, even if switch/restart/publish fails.
    if state['active'] != state['previous']:
        try:
            switch(state['previous'])
            state['active'] = state['previous']
            result['rollback'] = 'switched'
            atomic_json(CONTROL / 'state.json', state)
            restart_gateway()
        except Exception:
            result['rollback'] = 'recovery_failed'
    # Write the attempt before sending: an interrupted send has unknown delivery,
    # and is not automatically repeated on a Guardian process restart.
    result['notification'] = 'delivery_unknown'
    atomic_json(CONTROL / 'state.json', state)
    try:
        result['bark_accepted'] = bool(notify('gateway_unhealthy', state['active']))
    except Exception:
        result['bark_accepted'] = False
    result['notification'] = 'submitted' if result['bark_accepted'] else 'not_accepted'
    atomic_json(CONTROL / 'state.json', state)
    publish(state)


def main():
    state = initialize()
    # The official bootstrap may adjust ownership. Apply this after cont-init:
    # sticky directories prevent terminal/code tools from replacing root-owned
    # SOUL and the reviewed preflight while retaining normal profile writes.
    user = pwd.getpwnam('hermes')
    for directory in [HOME, HOME / 'scripts']:
        if directory.exists():
            fd = open_directory_beneath(HOME, directory.relative_to(HOME))
            try:
                os.fchown(fd, 0, user.pw_gid); os.fchmod(fd, 0o1770)
            finally: os.close(fd)
    while True:
        try:
            healthy = health()
            monitor_once(state, healthy)
            if healthy:
                for path in sorted(REQUESTS.glob('*.json')):
                    if path.name != 'status.json': process_request(path, state)
            time.sleep(HEALTH_INTERVAL)
        except Exception:
            # Fixed output only. A malformed agent request cannot kill the guardian.
            print('[ziwei-guardian] control operation failed', flush=True); time.sleep(HEALTH_INTERVAL)


if __name__ == '__main__':
    if '--initialize' in sys.argv: initialize()
    else: main()
