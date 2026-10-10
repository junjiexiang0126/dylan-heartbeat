"""Standalone owner-only OAuth UI (WSGI). Not wired into Hermes or deployed.

Run behind HTTPS reverse proxy with an exact callback URL. Never expose this
service publicly without TLS and rate limiting at the proxy.
"""
import hashlib
import hmac
import html
import json
import os
import secrets
import time
import urllib.parse
from http import HTTPStatus
from http.cookies import SimpleCookie
from wsgiref.simple_server import make_server

from google_oauth import OAuthError, from_environment

COOKIE = "ziwei_google_session"
STATE_COOKIE = "ziwei_google_oauth_state"
MAX_BODY = 4096
SESSION_AGE = 1800


def _b64url(value):
    import base64
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


class OwnerUI:
    def __init__(self, google, *, owner_key, signing_key, clock=time.time):
        if len(owner_key) < 32 or len(signing_key) < 32:
            raise ValueError("Owner and session keys must be at least 32 characters")
        self.google = google
        self.owner_key = owner_key.encode()
        self.signing_key = signing_key.encode()
        self.clock = clock
        self.callback_path = urllib.parse.urlsplit(google.redirect_uri).path

    def _sign(self, payload):
        return hmac.new(self.signing_key, payload.encode(), hashlib.sha256).hexdigest()

    def _make_session(self):
        expiry = str(int(self.clock()) + SESSION_AGE)
        nonce = secrets.token_urlsafe(20)
        data = expiry + "." + nonce
        return data + "." + self._sign(data)

    def _valid_session(self, value):
        if not value:
            return False
        parts = value.split(".")
        if len(parts) != 3:
            return False
        expiry, nonce, sig = parts
        if not expiry.isdecimal() or not nonce or len(sig) != 64:
            return False
        data = expiry + "." + nonce
        return int(expiry) >= self.clock() and hmac.compare_digest(sig, self._sign(data))

    @staticmethod
    def _cookies(env):
        cookies = SimpleCookie()
        try:
            cookies.load(env.get("HTTP_COOKIE", ""))
        except Exception:
            return {}
        return {key: morsel.value for key, morsel in cookies.items()}

    @staticmethod
    def _cookie(name, value, *, age=None):
        suffix = "; Max-Age=" + str(age) if age is not None else ""
        return f"{name}={value}; Secure; HttpOnly; SameSite=Lax; Path=/{suffix}"

    def _response(self, start_response, status, body, headers=()):
        payload = body.encode("utf-8")
        start_response(status, [
            ("Content-Type", "text/html; charset=utf-8"),
            ("Content-Length", str(len(payload))),
            ("Cache-Control", "no-store"),
            ("Referrer-Policy", "no-referrer"),
            ("X-Content-Type-Options", "nosniff"),
            ("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"),
            *headers,
        ])
        return [payload]

    def _page(self, title, body):
        return ('<!doctype html><html lang="zh"><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width,initial-scale=1">'
                '<title>' + html.escape(title) + '</title>'
                '<style>body{font:16px system-ui;max-width:36rem;margin:3rem auto;padding:1rem}'
                'button,input{padding:.7rem;font:inherit}form{margin:1rem 0}</style>'
                '<h1>' + html.escape(title) + '</h1>' + body + '</html>')

    def _post(self, env):
        length = env.get("CONTENT_LENGTH", "")
        if not length.isdecimal() or int(length) > MAX_BODY:
            raise ValueError("Invalid request body length")
        raw = env["wsgi.input"].read(int(length))
        if len(raw) != int(length):
            raise ValueError("Truncated request body")
        return urllib.parse.parse_qs(raw.decode("utf-8"), strict_parsing=True)

    def __call__(self, env, start_response):
        path = env.get("PATH_INFO", "")
        method = env.get("REQUEST_METHOD", "GET")
        cookies = self._cookies(env)
        logged = self._valid_session(cookies.get(COOKIE))
        # Exact HTTPS origin is enforced by the proxy; do not trust forwarded host.
        try:
            if path == "/google" and method == "GET":
                if not logged:
                    return self._response(start_response, "200 OK", self._page(
                        "连接知微 Google", '<p>仅供账号所有者使用。</p><form method="post" action="/google/login">'
                        '<input name="key" type="password" autocomplete="off" required>'
                        '<button>登录</button></form>'))
                token = cookies[COOKIE]
                csrf = self._sign("csrf:" + token)
                return self._response(start_response, "200 OK", self._page(
                    "Google Drive / Sheets", '<p>只申请 drive.file 权限，不访问整个云端硬盘。</p>'
                    '<form method="post" action="/google/connect"><input type="hidden" name="csrf" value="'
                    + csrf + '"><button>连接 Google</button></form>'
                    '<form method="post" action="/google/disconnect"><input type="hidden" name="csrf" value="'
                    + csrf + '"><button>断开本地连接</button></form>'))
            if path == "/google/login" and method == "POST":
                form = self._post(env)
                provided = form.get("key", [""])[0].encode()
                if not hmac.compare_digest(hashlib.sha256(provided).digest(),
                                           hashlib.sha256(self.owner_key).digest()):
                    return self._response(start_response, "403 Forbidden", self._page("登录失败", "请检查凭据。"))
                return self._response(start_response, "303 See Other", "",
                    [("Location", "/google"), ("Set-Cookie", self._cookie(COOKIE, self._make_session(), age=SESSION_AGE))])
            if path in ("/google/connect", "/google/disconnect") and method == "POST":
                if not logged:
                    return self._response(start_response, "403 Forbidden", "Forbidden")
                form = self._post(env)
                if not hmac.compare_digest(form.get("csrf", [""])[0],
                                           self._sign("csrf:" + cookies[COOKIE])):
                    return self._response(start_response, "403 Forbidden", "Forbidden")
                if path.endswith("disconnect"):
                    self.google.disconnect_local()
                    return self._response(start_response, "200 OK",
                        self._page("已断开", "<p>本地令牌已清除。请在 Google 账号权限页面撤销应用授权。</p>"))
                url = self.google.begin()
                state = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["state"][0]
                # Browser binding: callback must carry both Google state and same-site cookie.
                return self._response(start_response, "303 See Other", "",
                    [("Location", url), ("Set-Cookie", self._cookie(STATE_COOKIE, self._sign("oauth:" + state), age=600))])
            if path == self.callback_path and method == "GET":
                if not logged:
                    return self._response(start_response, "403 Forbidden", "Forbidden")
                params = urllib.parse.parse_qs(env.get("QUERY_STRING", ""), keep_blank_values=True)
                if "error" in params:
                    return self._response(start_response, "400 Bad Request", self._page("授权取消", "Google 未授予权限。"),
                        [("Set-Cookie", self._cookie(STATE_COOKIE, "", age=0))])
                state = params.get("state", [""])[0]
                code = params.get("code", [""])[0]
                if not state or not code or not hmac.compare_digest(
                        cookies.get(STATE_COOKIE, ""), self._sign("oauth:" + state)):
                    return self._response(start_response, "403 Forbidden", "Forbidden")
                self.google.finish(state=state, code=code)
                return self._response(start_response, "200 OK",
                    self._page("连接成功", "<p>Google 授权已安全保存。无需复制授权码。</p>"),
                    [("Set-Cookie", self._cookie(STATE_COOKIE, "", age=0))])
        except (OAuthError, ValueError, UnicodeError, KeyError):
            return self._response(start_response, "400 Bad Request",
                self._page("请求失败", "<p>授权未完成。请重新登录并重试。</p>"))
        return self._response(start_response, "404 Not Found", "Not found")


def main():
    owner = os.environ["ZIWEI_GOOGLE_OWNER_KEY"]
    signing = os.environ["ZIWEI_GOOGLE_SESSION_KEY"]
    google = from_environment()
    app = OwnerUI(google, owner_key=owner, signing_key=signing)
    # Loopback only: external HTTPS ingress requires explicit, reviewed proxy.
    with make_server("127.0.0.1", int(os.environ.get("ZIWEI_GOOGLE_LOCAL_PORT", "8765")), app) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
