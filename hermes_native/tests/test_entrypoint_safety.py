"""Offline safety tests for the Hermes profile bootstrap wrapper."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "ziwei_entry", Path(__file__).resolve().parents[1] / "entrypoint.py"
)
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class EntrypointTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name) / "hermes_native"
        self.home.mkdir()
        patches = [
            patch.object(entry, "ALLOWED_HOMES", (str(self.home),)),
            patch.dict(os.environ, {"HERMES_HOME": str(self.home)}, clear=True),
            patch.object(entry.pwd, "getpwnam", return_value=type(
                "U", (), {"pw_uid": 10000, "pw_gid": 10000})()),
            patch.object(entry.os, "execv"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.temp.cleanup)

    def test_fresh_profile(self):
        entry.main()
        self.assertEqual(
            (self.home / ".ziwei-native-profile").read_text(),
            entry.MARKER_CONTENT,
        )

    def test_existing_without_optin_refused(self):
        (self.home / "config.yaml").write_text(
            "ziwei-deepseek api_server DEEPSEEK_API_KEY\n"
        )
        with self.assertRaises(SystemExit):
            entry.main()
        self.assertFalse((self.home / ".ziwei-native-profile").exists())

    def test_existing_modified_config_optin(self):
        (self.home / "config.yaml").write_text(
            "ziwei-deepseek:\n  key_env: DEEPSEEK_API_KEY\n"
            "platforms:\n  api_server:\n    port: 1234\n"
        )
        (self.home / "backups" / "config").mkdir(parents=True)
        with patch.dict(os.environ, {"ZIWEI_ADOPT_EXISTING_PROFILE": "1"}):
            with patch.object(entry.os, "fchown") as chown:
                entry.main()
        self.assertTrue((self.home / ".ziwei-native-profile").exists())
        self.assertEqual(chown.call_count, 2)

    def test_unrelated_profile_refused(self):
        (self.home / "config.yaml").write_text("not Ziwei\n")
        with patch.dict(os.environ, {"ZIWEI_ADOPT_EXISTING_PROFILE": "1"}):
            with self.assertRaises(SystemExit):
                entry.main()

    def test_refuses_symlinked_backup(self):
        (self.home / ".ziwei-native-profile").write_text(entry.MARKER_CONTENT)
        (self.home / "backups").symlink_to(self.home)
        with self.assertRaises(SystemExit):
            entry.main()

    def test_refuses_symlinked_existing_backup_file(self):
        (self.home / ".ziwei-native-profile").write_text(entry.MARKER_CONTENT)
        folder = self.home / "backups" / "config"
        folder.mkdir(parents=True)
        outside = self.home / "private"
        outside.write_text("untouched")
        (folder / "linked").symlink_to(outside)
        with patch.object(entry.os, "fchown") as chown:
            with self.assertRaises(SystemExit):
                entry.main()
        self.assertEqual(chown.call_count, 2)
        self.assertEqual(outside.read_text(), "untouched")

    def test_refuses_unexpected_nested_backup_directory(self):
        (self.home / ".ziwei-native-profile").write_text(entry.MARKER_CONTENT)
        folder = self.home / "backups" / "config"
        (folder / "unexpected").mkdir(parents=True)
        with patch.object(entry.os, "fchown"):
            with self.assertRaises(SystemExit):
                entry.main()

    def test_does_not_modify_backup_files(self):
        (self.home / ".ziwei-native-profile").write_text(entry.MARKER_CONTENT)
        (self.home / "backups" / "config").mkdir(parents=True)
        original = self.home / "backups" / "config" / "original"
        original.write_text("safe")
        with patch.object(entry.os, "fchown") as chown:
            entry.main()
        self.assertEqual(chown.call_count, 3)
        self.assertTrue(all(isinstance(call.args[0], int) for call in chown.call_args_list))
        self.assertEqual(original.read_text(), "safe")

    def test_refuses_hardlinked_backup_without_chowning_identity(self):
        (self.home / ".ziwei-native-profile").write_text(entry.MARKER_CONTENT)
        folder = self.home / "backups/config"
        folder.mkdir(parents=True)
        identity = self.home / "SOUL.md"
        identity.write_text("identity must remain protected")
        os.link(identity, folder / "linked")
        with patch.object(entry.os, "fchown") as chown:
            with self.assertRaises(SystemExit):
                entry.main()
        self.assertEqual(chown.call_count, 2)
        self.assertEqual(identity.read_text(), "identity must remain protected")

    def test_directory_swap_cannot_redirect_privileged_repair(self):
        folder = self.home / "backups/config"
        folder.mkdir(parents=True)
        (folder / "original").write_text("backup")
        outside = self.home / "outside"
        outside.mkdir()
        (outside / "private").write_text("untouched")
        touched = []

        def swap_on_directory(fd, uid, gid):
            touched.append(os.fstat(fd).st_ino)
            if len(touched) == 1:
                folder.parent.rename(self.home / "backups-saved")
                (self.home / "backups").symlink_to(outside, target_is_directory=True)
            # A mock avoids changing this test machine's ownership.

        with patch.object(entry.os, "fchown", side_effect=swap_on_directory):
            entry.repair_backup_ownership(self.home, os.getuid(), os.getgid())
        self.assertNotIn((outside / "private").stat().st_ino, touched)
        self.assertEqual(len(touched), 3)

    def test_refuses_fifo_backup_without_blocking(self):
        folder = self.home / "backups/config"
        folder.mkdir(parents=True)
        os.mkfifo(folder / "pipe")
        with patch.object(entry.os, "fchown") as chown:
            with self.assertRaises(SystemExit):
                entry.repair_backup_ownership(self.home, os.getuid(), os.getgid())
        self.assertEqual(chown.call_count, 2)


if __name__ == "__main__":
    unittest.main()
