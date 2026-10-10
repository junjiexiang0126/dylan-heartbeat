import importlib.util
import io
import sys
import types
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).parents[1] / "google_owner_ui.py"
sys.path.insert(0, str(MODULE.parent))
spec = importlib.util.spec_from_file_location("google_owner_ui_test", MODULE)
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


class FakeGoogle:
    redirect_uri = "https://example.com/google/callback"
    def __init__(self):
        self.started = 0
        self.finished = 0
        self.disconnected = 0

    def begin(self):
        self.started += 1
        return "https://accounts.google.com/o/oauth2/v2/auth?state=unique-state"

    def finish(self, *, state, code):
        self.finished += 1
        if state != "unique-state" or code != "one-time-code":
            raise ui.OAuthError("Invalid")
        return {"connected": True}

    def disconnect_local(self):
        self.disconnected += 1


class OwnerUITests(unittest.TestCase):
    def setUp(self):
        self.google = FakeGoogle()
        self.app = ui.OwnerUI(self.google, owner_key="o" * 40, signing_key="s" * 40,
                              clock=lambda: 1000)

    def call(self, path, method="GET", form=None, cookie="", query=""):
        body = urllib.parse.urlencode(form or {}).encode()
        headers = {}
        def start(status, hs):
            headers["status"] = status
            headers.update({k: v for k, v in hs})
        env = {"PATH_INFO": path, "REQUEST_METHOD": method,
               "QUERY_STRING": query, "CONTENT_LENGTH": str(len(body)),
               "wsgi.input": io.BytesIO(body), "HTTP_COOKIE": cookie}
        payload = b"".join(self.app(env, start)).decode()
        return headers, payload

    def login(self):
        h, _ = self.call("/google/login", "POST", {"key": "o" * 40})
        self.assertEqual(h["status"], "303 See Other")
        return h["Set-Cookie"].split(";")[0]

    def test_unauthenticated_connect_denied(self):
        h, _ = self.call("/google/connect", "POST", {"csrf": "x"})
        self.assertEqual(h["status"], "403 Forbidden")
        self.assertEqual(self.google.started, 0)

    def test_bad_password_rejected(self):
        h, _ = self.call("/google/login", "POST", {"key": "wrong"})
        self.assertEqual(h["status"], "403 Forbidden")

    def test_csrf_required_for_connect_and_disconnect(self):
        cookie = self.login()
        h, _ = self.call("/google/connect", "POST", {"csrf": "bad"}, cookie)
        self.assertEqual(h["status"], "403 Forbidden")
        self.assertEqual(self.google.started, 0)
        h, _ = self.call("/google/disconnect", "POST", {"csrf": "bad"}, cookie)
        self.assertEqual(h["status"], "403 Forbidden")
        self.assertEqual(self.google.disconnected, 0)

    def test_callback_requires_browser_cookie_and_session(self):
        cookie = self.login()
        csrf = self.app._sign("csrf:" + cookie.split("=", 1)[1])
        h, _ = self.call("/google/connect", "POST", {"csrf": csrf}, cookie)
        self.assertEqual(h["status"], "303 See Other")
        self.assertEqual(self.google.started, 1)
        state_cookie = h["Set-Cookie"].split(";")[0]
        query = "state=unique-state&code=one-time-code"
        h, _ = self.call("/google/callback", cookie=cookie, query=query)
        self.assertEqual(h["status"], "403 Forbidden")
        self.assertEqual(self.google.finished, 0)
        h, _ = self.call("/google/callback", cookie=cookie + "; " + state_cookie, query=query)
        self.assertEqual(h["status"], "200 OK")
        self.assertEqual(self.google.finished, 1)
        self.assertEqual(h["Cache-Control"], "no-store")
        self.assertEqual(h["Referrer-Policy"], "no-referrer")

    def test_google_error_does_not_exchange_code(self):
        cookie = self.login()
        h, _ = self.call("/google/callback", cookie=cookie, query="error=access_denied")
        self.assertEqual(h["status"], "400 Bad Request")
        self.assertEqual(self.google.finished, 0)

    def test_session_tamper_rejected(self):
        cookie = self.login()
        h, _ = self.call("/google", cookie=cookie + "tampered")
        self.assertIn("登录", h["status"] + _)
        h, _ = self.call("/google/disconnect", "POST", {"csrf": "x"}, cookie + "tampered")
        self.assertEqual(h["status"], "403 Forbidden")


if __name__ == "__main__":
    unittest.main()
