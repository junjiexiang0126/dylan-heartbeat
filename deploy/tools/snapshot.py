#!/usr/bin/env python3
"""Private host snapshots. No service stops, restarts or live restores.

Each SQLite database is an online-consistent snapshot; several databases and
ordinary files are NOT a single application-wide transaction. Quiesce writers
outside this program when a migration requires that stronger guarantee.
"""
import argparse
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import uuid

FORMAT = 'ziwei-host-snapshot-v1'
REQUIRED_DBS = ('native/state.db', 'web/chat.sqlite', 'web/moments.sqlite', 'web/work.sqlite')


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def db_snapshot(source, target):
    if source.is_symlink() or not source.is_file():
        raise ValueError('database_not_regular')
    deadline = time.monotonic() + 30
    def progress(*args):
        if time.monotonic() > deadline:
            raise TimeoutError('database_snapshot_timeout')
    with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)) as src:
        dst = sqlite3.connect(target)
        try:
            src.backup(dst, pages=256, progress=progress, sleep=0.05)
            rows = dst.execute('pragma integrity_check').fetchall()
            if rows != [('ok',)]:
                raise ValueError('database_integrity_failed')
        finally:
            dst.close()


def record(entries, destination, relative, source_info, kind, **extra):
    entry = {'path': relative, 'kind': kind, 'mode': stat.S_IMODE(source_info.st_mode) & 0o777,
             'uid': source_info.st_uid, 'gid': source_info.st_gid, **extra}
    if kind == 'file':
        entry.update(bytes=destination.stat().st_size, sha256=digest(destination))
        with destination.open('rb') as stream:
            os.fsync(stream.fileno())
    elif kind == 'symlink':
        entry['target'] = os.readlink(destination)
    entries.append(entry)


def copy_tree(source, destination, prefix, entries, databases):
    if source.is_symlink() or not source.is_dir():
        raise ValueError('source_directory_not_regular')
    destination.mkdir(mode=0o700)
    record(entries, destination, prefix, source.stat(), 'directory')
    for current, directories, files in os.walk(source, followlinks=False):
        current = Path(current)
        relative = current.relative_to(source)
        target_dir = destination / relative
        for name in sorted(directories[:]):
            original = current / name
            target = target_dir / name
            rel = str(Path(prefix) / relative / name)
            if original.is_symlink():
                target.symlink_to(os.readlink(original))
                record(entries, target, rel, original.lstat(), 'symlink')
                directories.remove(name)
            else:
                target.mkdir(mode=0o700)
                record(entries, target, rel, original.stat(), 'directory')
        for name in sorted(files):
            original = current / name
            target = target_dir / name
            rel = str(Path(prefix) / relative / name)
            info = original.lstat()
            # SQLite backup incorporates the committed WAL. Never restore stale sidecars.
            if name.endswith(('-wal', '-shm', '-journal')):
                base = original.with_name(name.rsplit('-', 1)[0])
                if base.suffix in ('.db', '.sqlite', '.sqlite3') and base.is_file():
                    continue
            if stat.S_ISLNK(info.st_mode):
                target.symlink_to(os.readlink(original))
                record(entries, target, rel, info, 'symlink')
            elif stat.S_ISREG(info.st_mode):
                if original.suffix in ('.db', '.sqlite', '.sqlite3'):
                    db_snapshot(original, target)
                    databases.append(rel)
                else:
                    shutil.copyfile(original, target, follow_symlinks=False)
                target.chmod(0o600)
                record(entries, target, rel, info, 'file')
            else:
                raise ValueError('unsupported_special_file')


def docker_inspect(container):
    value = subprocess.run(['docker', 'inspect', container], check=True,
                           capture_output=True, text=True, timeout=15)
    payload = json.loads(value.stdout)
    if not isinstance(payload, list) or not payload:
        raise ValueError('invalid_container_inspect')
    return json.dumps(payload, ensure_ascii=False, indent=2)


def manifest_path(root, relative):
    path = Path(relative)
    if path.is_absolute() or not path.parts or any(p in ('..', '.') for p in path.parts):
        raise ValueError('invalid_manifest_path')
    target = root / path
    # A preserved symlink may point outside a profile; never follow it when verifying.
    target.parent.resolve().relative_to(root.resolve())
    return target


def verify(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('invalid_snapshot_root')
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest.get('format') != FORMAT or manifest.get('status') != 'complete':
        raise ValueError('incomplete_snapshot')
    entries = manifest.get('entries')
    if not isinstance(entries, list):
        raise ValueError('invalid_manifest')
    seen = set()
    for entry in entries:
        relative = entry['path']
        if relative in seen:
            raise ValueError('duplicate_manifest_path')
        seen.add(relative)
        target = manifest_path(root, relative)
        kind = entry['kind']
        if kind == 'symlink':
            if not target.is_symlink() or os.readlink(target) != entry['target']:
                raise ValueError('symlink_mismatch')
        elif kind == 'directory':
            if target.is_symlink() or not target.is_dir():
                raise ValueError('directory_mismatch')
        elif kind == 'file':
            if target.is_symlink() or not target.is_file():
                raise ValueError('file_missing')
            if target.stat().st_size != entry['bytes'] or digest(target) != entry['sha256']:
                raise ValueError('file_hash_mismatch')
        else:
            raise ValueError('invalid_manifest_kind')
    if not set(REQUIRED_DBS) <= set(manifest.get('databases', [])):
        raise ValueError('required_database_missing')
    for relative in manifest['databases']:
        if relative not in seen:
            raise ValueError('unlisted_database')
        path = manifest_path(root, relative)
        if path.is_symlink() or not path.is_file():
            raise ValueError('database_not_regular')
        with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
            if connection.execute('pragma integrity_check').fetchall() != [('ok',)]:
                raise ValueError('database_integrity_failed')
    return manifest


def prune_daily(root, now):
    removed = []
    cutoff = now - timedelta(days=7)
    for candidate in Path(root).glob('daily-*'):
        if candidate.is_symlink() or not candidate.is_dir():
            continue
        try:
            info = json.loads((candidate / 'manifest.json').read_text())
            if (info.get('format') != FORMAT or info.get('status') != 'complete'
                    or info.get('kind') != 'daily'):
                continue
            created = datetime.fromisoformat(info['created_at'])
            if created.tzinfo is None or created >= cutoff:
                continue
        except (OSError, ValueError, KeyError, TypeError):
            continue
        shutil.rmtree(candidate)
        removed.append(candidate.name)
    return removed


def create(root, native, web, env_files, runtime=None, *, kind='daily', label='manual', inspect=docker_inspect):
    if kind not in ('daily', 'prechange') or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', label):
        raise ValueError('invalid_snapshot_label')
    root, native, web = map(Path, (root, native, web))
    sources = {'native': native, 'web': web}
    if runtime is not None and Path(runtime).exists():
        sources['runtime'] = Path(runtime)
    for source in sources.values():
        if root.resolve().is_relative_to(source.resolve()):
            raise ValueError('backup_root_inside_source')
    if root.is_symlink():
        raise ValueError('backup_root_symlink')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    now = datetime.now(timezone.utc)
    suffix = now.strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:8]
    final = root / (('daily-' if kind == 'daily' else 'pre-' + label + '-') + suffix)
    partial = root / ('.incomplete-' + suffix)
    partial.mkdir(mode=0o700)
    entries, databases = [], []
    try:
        # All four stores are required. A missing store is a failed backup, never success.
        for relative in REQUIRED_DBS:
            role, name = relative.split('/', 1)
            source = sources[role] / name
            if source.is_symlink() or not source.is_file():
                raise FileNotFoundError('required_database_missing')
        for name in ('config.yaml', 'SOUL.md', 'cron/jobs.json', 'scripts/autonomy_gate.py'):
            profile_file = native / name
            if profile_file.is_symlink() or not profile_file.is_file() or not profile_file.stat().st_size:
                raise FileNotFoundError('required_profile_file_missing')
            profile_file.resolve().relative_to(native.resolve())
        if (native / 'memories').is_symlink() or not (native / 'memories').is_dir():
            raise FileNotFoundError('required_memory_directory_missing')
        for role, source in sources.items():
            copy_tree(source, partial / role, role, entries, databases)
        for role, source in env_files.items():
            source = Path(source)
            if source.is_symlink() or not source.is_file():
                raise FileNotFoundError('required_environment_file_missing')
            relative = 'meta/' + role + '.env'
            target = partial / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(source, target)
            target.chmod(0o600)
            record(entries, target, relative, source.stat(), 'file')
        for container in ('ziwei-hermes', 'ziwei-web'):
            relative = 'meta/' + container + '.inspect.json'
            target = partial / relative
            private_write(target, inspect(container))
            record(entries, target, relative, target.stat(), 'file')
        notes = partial / 'ROLLBACK.md'
        private_write(notes, '''# 回滚前必须完成的检查

此备份含明文密钥，只在宿主私有目录保存，不上传 Git 或聊天。
在线备份保证各 SQLite 库单独一致；四个库与普通文件没有全局事务快照保证。

1. 同时停止 ziwei-web 和 ziwei-hermes，并确认所有写入进程已退出。
2. 先保留故障现场、原数据目录和容器定义，不覆盖当前目录。
3. 用 snapshot.py verify 校验本备份；restore 只能写入指定的新建/空目录。
4. 在新目录验证身份、记忆、四个库、文件及配置；manifest 含原 UID/GID 和模式。
5. 明确将容器挂载改指已验证的恢复目录后再启动。直接 docker start 会使用旧挂载。
6. 同时核对所用镜像与 inspect 中 Image ID；未核实 revision 不可声称恢复了指定源码提交。
7. 健康检查、登录、聊天、附件和一次自主活动分别验收，不以 health 200 代替完整验收。

本工具不会自动停止、修改或启动真实容器，也不会向原持久目录还库。
''')
        record(entries, notes, 'ROLLBACK.md', notes.stat(), 'file')
        manifest = {'format': FORMAT, 'status': 'complete', 'kind': kind, 'label': label,
                    'created_at': now.isoformat(), 'consistency': 'online-per-database-not-global',
                    'sources': {k: str(v) for k, v in sources.items()},
                    'databases': databases, 'entries': entries}
        private_write(partial / 'manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        verify(partial)
        for folder in [*sorted((p for p in partial.rglob('*') if p.is_dir() and not p.is_symlink()),
                               key=lambda p: len(p.parts), reverse=True), partial]:
            fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        partial.rename(final)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except Exception as exc:
        private_write(partial / 'FAILED.json', json.dumps({'status': 'failed', 'error_type': type(exc).__name__}))
        raise
    # Retention is only reached after a complete, hash/integrity-verified new snapshot.
    if kind == 'daily':
        prune_daily(root, now)
    return final


def restore(backup, destination):
    """Restore to a NEW/EMPTY staging directory only. Never reuse live source paths."""
    backup, destination = Path(backup), Path(destination)
    manifest = verify(backup)
    if (destination.is_symlink() or destination.resolve().is_relative_to(backup.resolve())
            or backup.resolve().is_relative_to(destination.resolve())):
        raise ValueError('invalid_restore_destination')
    for value in manifest['sources'].values():
        source = Path(value).resolve()
        target = destination.resolve()
        if target == source or target.is_relative_to(source) or source.is_relative_to(target):
            raise ValueError('restore_overlaps_live_source')
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError('restore_destination_not_empty')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    for entry in manifest['entries']:
        source = manifest_path(backup, entry['path'])
        target = manifest_path(destination, entry['path'])
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if entry['kind'] == 'directory':
            target.mkdir(exist_ok=True, mode=0o700)
        elif entry['kind'] == 'symlink':
            target.symlink_to(entry['target'])
        else:
            shutil.copyfile(source, target)
            target.chmod(0o600)
    shutil.copyfile(backup / 'manifest.json', destination / 'manifest.json')
    (destination / 'manifest.json').chmod(0o600)
    verify(destination)
    # Set recorded ownership/modes only after content verification, inside this new tree.
    for entry in reversed(manifest['entries']):
        target = manifest_path(destination, entry['path'])
        if os.geteuid() == 0:
            os.chown(target, entry['uid'], entry['gid'], follow_symlinks=False)
        elif (entry['uid'], entry['gid']) != (os.getuid(), os.getgid()):
            raise PermissionError('restore_requires_recorded_owner')
        if entry['kind'] != 'symlink':
            target.chmod(entry['mode'])
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    make = sub.add_parser('create')
    make.add_argument('--kind', choices=('daily', 'prechange'), default='daily')
    make.add_argument('--label', default='manual')
    make.add_argument('--root', default=os.environ.get('BACKUP_ROOT', '/opt/backups'))
    for name in ('verify', 'restore'):
        p = sub.add_parser(name)
        p.add_argument('backup')
        if name == 'restore':
            p.add_argument('destination')
    args = parser.parse_args()
    try:
        if args.operation == 'create':
            target = create(args.root, os.environ.get('HERMES_DATA', '/opt/hermes-data'),
                            os.environ.get('ZIWEI_WEB_DATA_DIR', '/opt/ziwei-web-data'),
                            {'hermes': os.environ.get('ZIWEI_HERMES_ENV_FILE', '/opt/ziwei-hermes.env'),
                             'web': os.environ.get('ZIWEI_WEB_ENV_FILE', '/opt/ziwei-web.env')},
                            os.environ.get('ZIWEI_RUNTIME_DIR', '/opt/ziwei-runtime'),
                            kind=args.kind, label=args.label)
            print(json.dumps({'status': 'complete', 'path': str(target)}))
        elif args.operation == 'verify':
            verify(Path(args.backup))
            print(json.dumps({'status': 'verified'}))
        else:
            target = restore(args.backup, args.destination)
            print(json.dumps({'status': 'restored_to_staging', 'path': str(target)}))
        return 0
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
