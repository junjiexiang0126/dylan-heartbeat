"""Persist plain local Chromium without replacing Hermes browser tools.

One private Chromium profile per Hermes home, one task at a time. No shared
daemon, copied user cookies, state export, background browser, or new API route.
The adapter runs as hermes, after the official credential-scrubbed env builder.
"""
from __future__ import annotations

import contextvars
import fcntl
import functools
import inspect
import os
import stat
import threading
from dataclasses import dataclass
from pathlib import Path


class PersistenceError(Exception):
    code = 'browser_persistence_unavailable'


class ProfileBusy(PersistenceError):
    code = 'browser_profile_busy'


@dataclass
class Lease:
    fd: int
    owner: str
    profile: Path
    blocked_pid: int | None = None


class ProfileLeases:
    """Keep the lock inode permanently; deleting a lock permits split ownership."""
    def __init__(self):
        self.lock = threading.RLock()
        self.leases: dict[str, Lease] = {}

    def acquire(self, home: Path, owner: str) -> Lease:
        key = str(home)
        with self.lock:
            current = self.leases.get(key)
            if current:
                if current.owner == owner and current.blocked_pid is None:
                    return current
                raise ProfileBusy('Another task owns the persistent browser. Retry after its cleanup.')
            fd = directory = None
            try:
                directory = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                for name in ('browser', 'ziwei-native-v1'):
                    try:
                        os.mkdir(name, mode=0o700, dir_fd=directory)
                    except FileExistsError:
                        pass
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                    os.close(directory)
                    directory = child
                    if os.fstat(directory).st_uid != os.geteuid():
                        raise PersistenceError('Browser persistence requires an owned private directory.')
                    os.fchmod(directory, 0o700)
                fd = os.open('lease.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK,
                             0o600, dir_fd=directory)
                st = os.fstat(fd)
                if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != os.geteuid():
                    raise PersistenceError('Browser persistence lock is not an owned regular file.')
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise ProfileBusy('Another process owns the persistent browser. Retry after its cleanup.') from None
                os.fchmod(fd, 0o600)
                try:
                    os.mkdir('profile', mode=0o700, dir_fd=directory)
                except FileExistsError:
                    pass
                profile_fd = os.open('profile', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                try:
                    if os.fstat(profile_fd).st_uid != os.geteuid():
                        raise PersistenceError('Browser profile is not owned by the current user.')
                    os.fchmod(profile_fd, 0o700)
                finally:
                    os.close(profile_fd)
                lease = Lease(fd, owner, home / 'browser/ziwei-native-v1/profile')
                self.leases[key] = lease
                fd = None
                return lease
            except OSError:
                raise PersistenceError('Browser persistence directory or lock is unavailable; no data was removed.') from None
            finally:
                if fd is not None:
                    os.close(fd)
                if directory is not None:
                    os.close(directory)

    def release(self, home: Path, owner: str, live_pid: int | None = None):
        with self.lock:
            lease = self.leases.get(str(home))
            if lease is None or lease.owner != owner:
                return
            if live_pid is not None:
                lease.blocked_pid = live_pid
                return  # A failed native teardown must not grant another writer.
            self.leases.pop(str(home))
            os.close(lease.fd)

    def reap_finished(self, home: Path, pid_exists):
        with self.lock:
            lease = self.leases.get(str(home))
            if lease and lease.blocked_pid is not None and not pid_exists(lease.blocked_pid):
                self.release(home, lease.owner)


LEASES = ProfileLeases()
COMMAND_PROFILE = contextvars.ContextVar('ziwei_browser_profile', default=None)
HOME_FIELD = '_ziwei_persistent_home'


def persistence_enabled(config):
    if not isinstance(config, dict) or not isinstance(config.get('browser', {}), dict):
        raise PersistenceError('Browser configuration must be a mapping.')
    browser = config.get('browser', {})
    value = browser.get('persistence', {})
    if not isinstance(value, dict) or not isinstance(value.get('enabled', True), bool):
        raise PersistenceError('browser.persistence.enabled must be a boolean.')
    return value.get('enabled', True)


def eligible(task_id, info, argv, engine, session):
    features = info.get('features') or {}
    return (features.get('local') is True and not features.get('real_profile')
            and not features.get('lightpanda') and not info.get('cdp_url')
            and not info.get('bb_session_id') and engine in ('auto', 'chrome', 'chromium')
            and '--cdp' not in argv and '--headed' not in argv
            and not session._bt._is_local_sidecar_key(task_id)
            and not session._bt._is_camofox_mode()
            and not session._cloud._is_headed_mode() and not session._browser_in_sandbox())


def install():
    """Install once after an accepted source tree becomes the import root.

    Check the exact private extension points before modifying any of them. An
    incompatible runtime candidate fails preflight instead of silently reverting
    to a disposable browser or weakening the native cleanup/credential boundary.
    """
    from tools import browser_tool_session as session, browser_tool_lifecycle as lifecycle
    from hermes_cli.config import read_raw_config
    from hermes_constants import get_hermes_home
    if getattr(session, '_ziwei_persistence_installed', False):
        return
    expected = {
        '_spawn_and_collect': ('task_id', 'session_info', 'cmd_parts', 'command', 'engine', 'timeout', 'stdin_payload'),
        '_agent_browser_command_env': ('socket_dir',),
        '_discard_timed_out_browser_session': ('task_id', 'session_info', 'task_socket_dir'),
    }
    for name, parameters in expected.items():
        if tuple(inspect.signature(getattr(session, name)).parameters) != parameters:
            raise RuntimeError('Unsupported Hermes browser persistence integration points.')
    if tuple(inspect.signature(lifecycle._release_session_resources).parameters) != ('task_id', 'session_info'):
        raise RuntimeError('Unsupported Hermes browser lifecycle integration point.')
    original_env = session._agent_browser_command_env
    original_spawn = session._spawn_and_collect
    original_release = lifecycle._release_session_resources
    original_discard = session._discard_timed_out_browser_session

    def daemon_pid(info):
        directory = str(Path(session._bt._socket_safe_tmpdir()) / ('agent-browser-' + info['session_name']))
        return session._read_browser_daemon_pid(directory, info['session_name'])

    def settle(info, pid):
        if HOME_FIELD in info:
            alive = pid is not None and lifecycle._pid_exists(pid)
            LEASES.release(Path(info[HOME_FIELD]), info['session_name'], pid if alive else None)

    @functools.wraps(original_env)
    def command_env(socket_dir):
        env = original_env(socket_dir)
        profile = COMMAND_PROFILE.get()
        if profile is not None:
            if env.get('AGENT_BROWSER_PROFILE') not in (None, '', str(profile)):
                raise PersistenceError('Explicit browser profile conflicts with Ziwei persistence; disable one configuration.')
            env['AGENT_BROWSER_PROFILE'] = str(profile)
        return env

    @functools.wraps(original_spawn)
    def spawn(task_id, session_info, cmd_parts, command, engine, timeout, stdin_payload=None):
        token = None
        try:
            # A bound session retains its home even when a janitor cleans it from
            # a different context; never switch a live daemon to another profile.
            home = Path(session_info[HOME_FIELD]) if HOME_FIELD in session_info else None
            if home is not None and command != 'close' and not eligible(task_id, session_info, cmd_parts, engine, session):
                raise PersistenceError('Persistent browser backend changed; clean up the existing session first.')
            if home is None and eligible(task_id, session_info, cmd_parts, engine, session):
                if persistence_enabled(read_raw_config()):
                    home = Path(get_hermes_home())
            if home is not None:
                LEASES.reap_finished(home, lifecycle._pid_exists)
                lease = LEASES.acquire(home, session_info['session_name'])
                session_info[HOME_FIELD] = str(home)
                token = COMMAND_PROFILE.set(lease.profile)
            return original_spawn(task_id, session_info, cmd_parts, command, engine, timeout, stdin_payload)
        except PersistenceError as error:
            # No backend-level returncode: native retry must not treat contention
            # as a broken daemon, recycle the other task, or repeat an action.
            if token is not None:
                settle(session_info, daemon_pid(session_info))
            return {'success': False, 'code': error.code, 'error': str(error)}
        finally:
            if token is not None:
                COMMAND_PROFILE.reset(token)

    @functools.wraps(original_release)
    def release(task_id, session_info):
        pid = daemon_pid(session_info) if HOME_FIELD in session_info else None
        result = original_release(task_id, session_info)
        settle(session_info, pid)
        return result

    @functools.wraps(original_discard)
    def discard(task_id, session_info, task_socket_dir):
        pid = daemon_pid(session_info) if HOME_FIELD in session_info else None
        result = original_discard(task_id, session_info, task_socket_dir)
        if session._bt._active_sessions.get(task_id) is not session_info:
            settle(session_info, pid)
        return result

    session._agent_browser_command_env = command_env
    session._spawn_and_collect = spawn
    lifecycle._release_session_resources = release
    session._discard_timed_out_browser_session = discard
    session._ziwei_persistence_installed = True
