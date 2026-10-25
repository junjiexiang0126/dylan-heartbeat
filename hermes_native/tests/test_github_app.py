"""github_app 单测：JWT 结构、换令牌、缓存与刷新、401 重试、凭证来源。

不触网：用自签 RSA 私钥 + 假 opener。
"""
import base64
import io
import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from hermes_native import github_app as ga


def _new_key_pem() -> bytes:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption())


class FakeResp:
    def __init__(self, payload: dict, status: int = 201):
        self._body = json.dumps(payload).encode()
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class CredentialsTests(unittest.TestCase):
    def setUp(self):
        self.pem = _new_key_pem()
        self.b64 = base64.b64encode(self.pem).decode()

    def test_from_b64(self):
        c = ga.Credentials.from_env({"GH_APP_ID": "1", "GH_APP_INSTALLATION_ID": "2",
                                     "GH_APP_PRIVATE_KEY_B64": self.b64})
        self.assertEqual((c.app_id, c.installation_id), ("1", "2"))
        self.assertIn(b"PRIVATE KEY", c.private_key_pem)

    def test_from_inline_with_escaped_newlines(self):
        inline = self.pem.decode().replace("\n", "\\n")
        c = ga.Credentials.from_env({"GH_APP_ID": "1", "GH_APP_INSTALLATION_ID": "2",
                                     "GH_APP_PRIVATE_KEY": inline})
        self.assertIn(b"PRIVATE KEY", c.private_key_pem)

    def test_from_file(self):
        with tempfile.NamedTemporaryFile("wb", suffix=".pem", delete=False) as fh:
            fh.write(self.pem); path = fh.name
        try:
            c = ga.Credentials.from_env({"GH_APP_ID": "1", "GH_APP_INSTALLATION_ID": "2",
                                         "GH_APP_PRIVATE_KEY_FILE": path})
            self.assertIn(b"PRIVATE KEY", c.private_key_pem)
        finally:
            os.unlink(path)

    def test_missing_key_is_explicit(self):
        with self.assertRaises(ga.GitHubAppError):
            ga.Credentials.from_env({"GH_APP_ID": "1", "GH_APP_INSTALLATION_ID": "2"})
        with self.assertRaises(ga.GitHubAppError):
            ga.Credentials.from_env({"GH_APP_INSTALLATION_ID": "2", "GH_APP_PRIVATE_KEY_B64": self.b64})


class JwtTests(unittest.TestCase):
    def setUp(self):
        self.pem = _new_key_pem()
        self.creds = ga.Credentials("42", "7", self.pem)

    def test_three_segments_and_claims(self):
        tok = ga.make_jwt(self.creds, now=1_800_000_000)
        parts = tok.split(".")
        self.assertEqual(len(parts), 3)
        pad = lambda s: s + "=" * (-len(s) % 4)
        payload = json.loads(base64.urlsafe_b64decode(pad(parts[1])))
        self.assertEqual(payload["iss"], 42)
        self.assertLess(payload["iat"], 1_800_000_000)
        self.assertLessEqual(payload["exp"] - payload["iat"], 600)

    def test_signature_verifies(self):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        tok = ga.make_jwt(self.creds)
        head, body, sig = tok.split(".")
        pad = lambda s: s + "=" * (-len(s) % 4)
        # 公钥从私钥导出后验签
        key = serialization.load_pem_private_key(self.pem, password=None)
        key.public_key().verify(base64.urlsafe_b64decode(pad(sig)),
                                f"{head}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256())


class TokenCacheTests(unittest.TestCase):
    def setUp(self):
        self.creds = ga.Credentials("42", "7", _new_key_pem())
        self.calls = []

    def _opener(self, expires_iso):
        def opener(req, timeout=30):
            self.calls.append(req.full_url)
            return FakeResp({"token": "ghs_fake_" + str(len(self.calls)),
                             "expires_at": expires_iso})
        return opener

    def test_caches_until_near_expiry(self):
        future = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3600))
        t = ga.InstallationToken(self.creds, opener=self._opener(future))
        first = t.token(); second = t.token()
        self.assertEqual(first, second)
        self.assertEqual(len(self.calls), 1)

    def test_refreshes_when_expiring_soon(self):
        now = 1792800000.0
        soon = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + 10))
        t = ga.InstallationToken(self.creds, opener=self._opener(soon))
        # Keep key generation/JWT work and scheduler pauses from turning the
        # near-expiry fixture into an already-expired response (1h fallback).
        with patch.object(ga.time, "time", return_value=now):
            t.token(); t.token()
        self.assertEqual(len(self.calls), 2)

    def test_force_refresh(self):
        future = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3600))
        t = ga.InstallationToken(self.creds, opener=self._opener(future))
        t.token(); t.token(force=True)
        self.assertEqual(len(self.calls), 2)

    @unittest.skipUnless(hasattr(time, 'tzset'), 'requires POSIX timezone support')
    def test_utc_expiry_is_correct_in_dst_and_non_dst_timezones(self):
        import calendar
        for zone in ('UTC', 'Asia/Bangkok', 'America/Los_Angeles'):
            for stamp in ('2026-01-24T00:00:10Z', '2026-10-24T00:00:10Z'):
                with self.subTest(zone=zone, stamp=stamp):
                    self.calls.clear()
                    expected = calendar.timegm(time.strptime(stamp, '%Y-%m-%dT%H:%M:%SZ'))
                    try:
                        with patch.dict(os.environ, {'TZ': zone}):
                            time.tzset()
                            token = ga.InstallationToken(self.creds, opener=self._opener(stamp))
                            with patch.object(ga.time, 'time', return_value=expected - 10):
                                token.token(); token.token()
                            self.assertEqual(token._expires_at, expected)
                            self.assertEqual(len(self.calls), 2)
                    finally:
                        time.tzset()


class ResolveTests(unittest.TestCase):
    def setUp(self):
        self.pem = _new_key_pem()
        self.env = {"GH_APP_ID": "42", "GH_APP_INSTALLATION_ID": "7",
                    "GH_APP_PRIVATE_KEY_B64": base64.b64encode(self.pem).decode(),
                    "GITHUB_TOKEN": "ghp_old_pat"}

    def test_prefers_app_token(self):
        future = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3600))
        with patch.object(ga, "_default", None), \
             patch.object(ga.InstallationToken, "token", return_value="ghs_app"):
            self.assertEqual(ga.resolve_github_token(self.env), "ghs_app")

    def test_falls_back_to_pat(self):
        env = {"GITHUB_TOKEN": "ghp_old_pat"}
        with patch.object(ga, "_default", None):
            self.assertEqual(ga.resolve_github_token(env), "ghp_old_pat")

    def test_no_credentials_raises(self):
        with patch.object(ga, "_default", None):
            with self.assertRaises(ga.GitHubAppError):
                ga.resolve_github_token({})


if __name__ == "__main__":
    unittest.main()
