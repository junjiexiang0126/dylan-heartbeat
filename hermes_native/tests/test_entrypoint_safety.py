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
            with patch.object(entry.os, "chown") as chown:
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

    def test_does_not_modify_backup_files(self):
        (self.home / ".ziwei-native-profile").write_text(entry.MARKER_CONTENT)
        (self.home / "backups" / "config").mkdir(parents=True)
        original = self.home / "backups" / "config" / "original"
        original.write_text("safe")
        with patch.object(entry.os, "chown") as chown:
            entry.main()
        self.assertEqual(chown.call_count, 2)
        self.assertEqual(original.read_text(), "safe")


if __name__ == "__main__":
    unittest.main()
