import importlib.util
import os
import tempfile
import unittest
import urllib.parse
from pathlib import Path

from cryptography.fernet import Fernet

MODULE = Path(__file__).parents[1] / "google_oauth.py"
spec = importlib.util.spec_from_file_location("ziwei_google_oauth", MODULE)
google = importlib.util.module_from_spec(spec)
spec.loader.exec_module(google)


class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls = []
        self.now = 1000

        def request(url, *, data=None, token=None):
            self.calls.append((url, data, token))
            if data and data["grant_type"] == "authorization_code":
                return {"refresh_token": "PRIVATE_REFRESH", "scope": google.SCOPE,
                        "access_token": "SHORT_ACCESS"}
            if data and data["grant_type"] == "refresh_token":
                return {"access_token": "SHORT_ACCESS"}
            return {"files": [{"id": "authorized-file"}]} if "drive" in url else {"values": [["ok"]]}

        self.service = google.GoogleConnection(
            directory=Path(self.tmp.name) / "private",
            client_id="example-client", client_secret="example-secret",
            redirect_uri="https://example.com/google/callback",
            encryption_key=Fernet.generate_key(), request=request, clock=lambda: self.now)

    def tearDown(self):
        self.tmp.cleanup()

    def _start(self):
        url = self.service.begin()
        parsed = urllib.parse.urlsplit(url)
        q = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(q["scope"], [google.SCOPE])
        self.assertEqual(q["code_challenge_method"], ["S256"])
        self.assertNotIn("client_secret", q)
        return q["state"][0]

    def test_one_time_pkce_state_and_encrypted_storage(self):
        state = self._start()
        self.assertEqual(self.service.finish(state=state, code="one-time-code")["connected"], True)
        with self.assertRaises(google.OAuthError):
            self.service.finish(state=state, code="replay")
        self.assertNotIn(b"PRIVATE_REFRESH", self.service.db.read_bytes())
        self.assertEqual(self.service.db.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.service.directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.service.list_authorized_files()["files"][0]["id"], "authorized-file")
        self.assertEqual(self.service.read_sheet("id", "Sheet 1!A1:B2")["values"], [["ok"]])
        self.assertTrue(any(x[1] and x[1].get("code_verifier") for x in self.calls))
        self.assertTrue(any(x[1] and x[1].get("grant_type") == "refresh_token" for x in self.calls))

    def test_expiry_and_invalid_state(self):
        state = self._start()
        with self.assertRaises(google.OAuthError):
            self.service.finish(state="wrong", code="code")
        self.now += 601
        with self.assertRaises(google.OAuthError):
            self.service.finish(state=state, code="code")
        self.assertFalse(self.calls)

    def test_no_refresh_token_is_not_accepted(self):
        self.service.request = lambda url, **kw: {"access_token": "short", "scope": google.SCOPE}
        with self.assertRaises(google.OAuthError):
            self.service.finish(state=self._start(), code="code")
        with self.assertRaises(google.OAuthError):
            self.service.list_authorized_files()

    def test_no_broad_scope(self):
        self.service.request = lambda url, **kw: {"refresh_token": "r",
                                                 "scope": "https://www.googleapis.com/auth/drive"}
        with self.assertRaises(google.OAuthError):
            self.service.finish(state=self._start(), code="code")

    def test_disconnect_removes_local_credential(self):
        self.service.finish(state=self._start(), code="code")
        self.service.disconnect_local()
        with self.assertRaises(google.OAuthError):
            self.service.read_sheet("id", "A1")

    def test_symlinked_directory_refused(self):
        other = Path(self.tmp.name) / "real"
        other.mkdir()
        link = Path(self.tmp.name) / "link"
        link.symlink_to(other, target_is_directory=True)
        with self.assertRaises(google.OAuthError):
            google.GoogleConnection(directory=link, client_id="id", client_secret="secret",
                redirect_uri="https://example.com/cb", encryption_key=Fernet.generate_key())

    def test_plain_http_redirect_refused(self):
        with self.assertRaises(google.OAuthError):
            google.GoogleConnection(directory=Path(self.tmp.name) / "another",
                client_id="id", client_secret="secret",
                redirect_uri="http://example.com/cb", encryption_key=Fernet.generate_key())

    def test_no_write_api(self):
        self.assertFalse(hasattr(self.service, "update_sheet"))
        self.assertFalse(hasattr(self.service, "delete_file"))


if __name__ == "__main__":
    unittest.main()
