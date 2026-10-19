"""Real WAL databases and isolated files; never inspect or change host containers."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[2] / 'deploy/tools/snapshot.py'
spec = importlib.util.spec_from_file_location('host_snapshot', MODULE)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class HostSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.native, self.web = self.root / 'native', self.root / 'web'
        self.native.mkdir(); self.web.mkdir()
        self.backups = self.root / 'backups'
        self.connections = []
        self.addCleanup(lambda: [connection.close() for connection in self.connections])
        for rel in snapshot.REQUIRED_DBS:
            path = self.root / rel
            connection = sqlite3.connect(path)
            connection.execute('pragma journal_mode=wal')
            connection.execute('create table records (value text)')
            connection.execute('insert into records values (?)', ('committed WAL: ' + rel,))
            connection.commit()
            self.connections.append(connection)
        for rel, data in {
            'config.yaml': b'agent: {max_turns: 24}\n', 'SOUL.md': b'identity',
            'memories/MEMORY.md': b'persisted memory', 'cron/jobs.json': b'[]',
            'scripts/autonomy_gate.py': b'print("gate")\n',
            'autonomy_gate.json': b'{"daily_opportunities":15}',
            'workspace/outbox/photo.png': b'\x89PNG\r\n\x1a\nfixture',
            'skills/custom/SKILL.md': b'custom skill', '.env': b'PRIVATE=fixture-secret\r\n',
            'audio_cache/voice.bin': b'voice',
        }.items():
            path = self.native / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        attachment = self.web / 'attachments/image.bin'
        attachment.parent.mkdir(); attachment.write_bytes(b'private attachment')
        (self.web / 'auth.json').write_text('{"fixture":true}')
        self.env_files = {}
        for role in ('hermes', 'web'):
            path = self.root / (role + '.env')
            path.write_bytes(b'PRIVATE=fixture-secret\r\n')
            self.env_files[role] = path

    def make(self, **kwargs):
        return snapshot.create(self.backups, self.native, self.web, self.env_files,
                               inspect=lambda name: '[{"Id":"fixture","Config":{"Env":["PRIVATE=fixture-secret"]}}]',
                               **kwargs)

    def test_wal_snapshot_and_full_file_tree_restore_roundtrip(self):
        target = self.make()
        manifest = snapshot.verify(target)
        self.assertEqual(manifest['consistency'], 'online-per-database-not-global')
        self.assertEqual(set(manifest['databases']), set(snapshot.REQUIRED_DBS))
        destination = self.root / 'restored'
        snapshot.restore(target, destination)
        for rel in snapshot.REQUIRED_DBS:
            with closing(sqlite3.connect(destination / rel)) as connection:
                self.assertEqual(connection.execute('select value from records').fetchone()[0],
                                 'committed WAL: ' + rel)
            self.assertFalse((destination / (rel + '-wal')).exists())
        for rel in ('workspace/outbox/photo.png', 'skills/custom/SKILL.md', 'scripts/autonomy_gate.py',
                    '.env', 'autonomy_gate.json', 'audio_cache/voice.bin', 'memories/MEMORY.md'):
            self.assertEqual((destination / 'native' / rel).read_bytes(), (self.native / rel).read_bytes())
        self.assertEqual((destination / 'web/attachments/image.bin').read_bytes(), b'private attachment')
        self.assertEqual((destination / 'meta/hermes.env').read_bytes(), self.env_files['hermes'].read_bytes())

    def test_missing_database_fails_and_does_not_prune_old_backup(self):
        old = self.make()
        path = old / 'manifest.json'
        info = json.loads(path.read_text())
        info['created_at'] = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        path.write_text(json.dumps(info))
        (self.web / 'work.sqlite').unlink()
        with self.assertRaises(FileNotFoundError):
            self.make()
        self.assertTrue(old.exists())
        self.assertTrue(list(self.backups.glob('.incomplete-*/FAILED.json')))

    def test_corrupt_database_fails_instead_of_printing_success(self):
        for connection in self.connections:
            connection.close()
        self.connections.clear()
        (self.web / 'moments.sqlite').write_bytes(b'not a sqlite file')
        with self.assertRaises(sqlite3.DatabaseError):
            self.make()
        self.assertFalse(list(self.backups.glob('daily-*')))

    def test_private_snapshot_permissions(self):
        target = self.make()
        self.assertEqual(self.backups.stat().st_mode & 0o777, 0o700)
        for path in [target, *target.rglob('*')]:
            if not path.is_symlink():
                self.assertEqual(path.stat().st_mode & 0o077, 0, str(path))

    def test_corruption_is_refused_before_restore_writes_anything(self):
        target = self.make()
        (target / 'native/SOUL.md').write_text('changed')
        destination = self.root / 'restored'
        with self.assertRaisesRegex(ValueError, 'hash_mismatch'):
            snapshot.restore(target, destination)
        self.assertFalse(destination.exists())

    def test_live_and_nonempty_restore_destinations_are_refused(self):
        target = self.make()
        for destination in (self.native, self.web, self.root, target / 'nested'):
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                snapshot.restore(target, destination)
        extra = self.root / 'nonempty'; extra.mkdir(); (extra / 'keep').write_text('keep')
        with self.assertRaisesRegex(ValueError, 'not_empty'):
            snapshot.restore(target, extra)
        self.assertEqual((extra / 'keep').read_text(), 'keep')

    def test_retention_only_deletes_completed_old_daily_snapshots(self):
        old = self.make()
        permanent = self.make(kind='prechange', label='before-change')
        unknown = self.backups / 'daily-unknown'; unknown.mkdir(); (unknown / 'keep').write_text('keep')
        for folder in (old, permanent):
            path = folder / 'manifest.json'
            info = json.loads(path.read_text())
            info['created_at'] = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
            path.write_text(json.dumps(info))
        latest = self.make()
        self.assertFalse(old.exists())
        self.assertTrue(permanent.exists())
        self.assertTrue(unknown.exists())
        self.assertTrue(latest.exists())

    def test_inspect_failure_prevents_complete_backup(self):
        def unavailable(name):
            raise subprocess.CalledProcessError(1, ['docker', 'inspect'])
        with self.assertRaises(subprocess.CalledProcessError):
            snapshot.create(self.backups, self.native, self.web, self.env_files, inspect=unavailable)
        self.assertFalse(list(self.backups.glob('daily-*')))

    def test_cli_wrappers_use_private_paths_and_never_print_secrets(self):
        directory = self.root / 'bin'; directory.mkdir()
        docker = directory / 'docker'
        docker.write_text('#!/bin/sh\nprintf \'[{"Id":"fixture","Config":{"Env":["PRIVATE=fixture-secret"]}}]\\n\'\n')
        docker.chmod(0o700)
        env = dict(os.environ, PATH=str(directory) + os.pathsep + os.environ['PATH'],
                   HERMES_DATA=str(self.native), ZIWEI_WEB_DATA_DIR=str(self.web),
                   ZIWEI_HERMES_ENV_FILE=str(self.env_files['hermes']),
                   ZIWEI_WEB_ENV_FILE=str(self.env_files['web']), ZIWEI_RUNTIME_DIR=str(self.root / 'no-runtime'))
        script = MODULE.with_name('backup.sh')
        result = subprocess.run(['bash', str(script), '--root', str(self.backups)],
                                env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'complete')
        self.assertNotIn('fixture-secret', result.stdout + result.stderr)
        (self.web / 'work.sqlite').unlink()
        result = subprocess.run(['bash', str(script), '--root', str(self.backups)],
                                env=env, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('"status": "complete"', result.stdout)
        self.assertNotIn('fixture-secret', result.stdout + result.stderr)
