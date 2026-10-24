"""Operator-selected upgrade of one reviewed Cron script, before privilege drop."""
import ast
import fcntl
import hashlib
import json
import os
import stat
from pathlib import Path

ROOT_UID = 0
OLD_SHA = 'de3d8c5a784f2bf1bae8880e9991e99d49f4e4bbeb5145cfb1cfd4f551c6f6f1'
PREVIOUS_SHA = '2cba28d19ce9b47bd1e6420112f9dff2c3cd5b211410b637e5252a7b312d96c9'
PREVIOUS_IMAGE_SHA = '58d0b2fa916d866532a250fc566a99d121b0ea62f49344941a7c65eb73569340'
PREVIOUS_REVIEWED_SHA = '653d393730dcacb0979e67130275af58390bc0faf48c90193ea3e5cb5e36093f'
PREVIOUS_NOTIFY_SHA = '1d71190170c6e5531067a55f53cad6429099f64fd34f85a799eb7fcd9851f53f'
PREVIOUS_HANDOFF_SHA = '7a990621de0001deedd05b932028205c56a37f99060fc152fdc22dc9a976d836'
NEW_SHA = '74f0fb6211a9aa4d65b3a4d9593945bcc6871e883fe5389bb7afc4dd5c84c823'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(directory, name, maximum=131072):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != ROOT_UID or info.st_mode & 0o022 or info.st_size > maximum:
            raise RuntimeError('preflight_upgrade_unsafe_file')
        data = os.read(fd, maximum + 1)
        if len(data) > maximum:
            raise RuntimeError('preflight_upgrade_size')
        return data
    finally:
        os.close(fd)


def write_atomic(directory, name, data):
    temp = '.upgrade-' + os.urandom(12).hex()
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fchmod(out.fileno(), 0o444)
            os.fsync(out.fileno())
        os.replace(temp, name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        try:
            os.unlink(temp, dir_fd=directory)
        except FileNotFoundError:
            pass


def upgrade(home: Path, source=Path('/opt/ziwei-native/autonomy_gate.py')):
    selected = os.environ.get('ZIWEI_PREFLIGHT_UPGRADE_SHA256', '')
    if not selected:
        return {'state': 'not_requested'}
    if selected != NEW_SHA:
        raise RuntimeError('preflight_upgrade_not_authorized')
    if os.geteuid() != ROOT_UID:
        # Some launchers enter the wrapper again after the official privilege drop.
        # Only verify the root-updated file here; never try to rewrite it as the Agent.
        directory = os.open(home / 'scripts', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if digest(read_regular(directory, 'autonomy_gate.py')) != NEW_SHA:
                raise RuntimeError('preflight_upgrade_requires_root')
            return {'state': 'already_current', 'new_sha256': NEW_SHA}
        finally:
            os.close(directory)
    source_fd = os.open(source.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        new = read_regular(source_fd, source.name)
    finally:
        os.close(source_fd)
    if digest(new) != NEW_SHA:
        raise RuntimeError('preflight_upgrade_image_hash')
    ast.parse(new.decode('utf-8'))  # Never execute the preflight during upgrade.
    home_fd = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    scripts = lock = None
    try:
        lock = os.open('.preflight-upgrade.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=home_fd)
        if os.fstat(lock).st_uid != ROOT_UID or os.fstat(lock).st_nlink != 1:
            raise RuntimeError('preflight_upgrade_unsafe_lock')
        fcntl.flock(lock, fcntl.LOCK_EX)
        scripts = os.open('scripts', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=home_fd)
        old = read_regular(scripts, 'autonomy_gate.py')
        current = digest(old)
        if current not in (OLD_SHA, PREVIOUS_SHA, PREVIOUS_IMAGE_SHA, PREVIOUS_REVIEWED_SHA, PREVIOUS_NOTIFY_SHA, PREVIOUS_HANDOFF_SHA, NEW_SHA):
            raise RuntimeError('preflight_upgrade_unknown_previous_hash')
        if current != NEW_SHA:
            backup_name = 'autonomy_gate.before-' + current + '.py'
            try:
                backup = read_regular(scripts, backup_name)
                if digest(backup) != current:
                    raise RuntimeError('preflight_upgrade_backup_conflict')
            except FileNotFoundError:
                write_atomic(scripts, backup_name, old)
            if digest(read_regular(scripts, 'autonomy_gate.py')) != current:
                raise RuntimeError('preflight_upgrade_source_changed')
            write_atomic(scripts, 'autonomy_gate.py', new)
        if digest(read_regular(scripts, 'autonomy_gate.py')) != NEW_SHA:
            raise RuntimeError('preflight_upgrade_verification_failed')
        receipt = {'state': 'already_current' if current == NEW_SHA else 'updated', 'old_sha256': current,
                   'new_sha256': NEW_SHA, 'owner': 'root', 'mode': '0444'}
        write_atomic(scripts, 'autonomy_gate.upgrade-receipt.json', json.dumps(receipt).encode())
        print('PREFLIGHT_UPGRADE ' + json.dumps(receipt), flush=True)
        return receipt
    finally:
        for fd in (scripts, lock, home_fd):
            if fd is not None:
                os.close(fd)
