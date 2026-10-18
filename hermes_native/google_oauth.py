"""Opt-in Google Drive/Sheets OAuth core. Not mounted as a public endpoint.

The host application MUST authenticate the owner before calling begin().
Never expose tokens, authorization codes or client secrets to Agent context/logs.
"""
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import stat
import time
import urllib.parse
import urllib.request
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

SCOPE = "https://www.googleapis.com/auth/drive.file"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_URL = "https://www.googleapis.com/drive/v3/files"
SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets"
STATE_TTL = 600


class OAuthError(Exception):
    pass


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _json_request(url, *, data=None, token=None, timeout=15):
    headers = {"Accept": "application/json"}
    if data is not None:
        data = urllib.parse.urlencode(data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        result = json.load(response)
    if not isinstance(result, dict):
        raise OAuthError("Unexpected Google API response")
    return result


class GoogleConnection:
    def __init__(self, *, directory, client_id, client_secret, redirect_uri, encryption_key,
                 request=_json_request, clock=time.time):
        if not client_id or not client_secret:
            raise OAuthError("Google OAuth client is not configured")
        parsed = urllib.parse.urlsplit(redirect_uri)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
            raise OAuthError("Redirect URI must be an absolute HTTPS URL")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.request = request
        self.clock = clock
        self.fernet = Fernet(encryption_key)
        self.directory = Path(directory)
        if self.directory.is_symlink():
            raise OAuthError("Refusing symlinked credential directory")
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.stat().st_mode & 0o077:
            raise OAuthError("Credential directory must be private (0700)")
        self.db = self.directory / "google_oauth.sqlite3"
        if self.db.is_symlink():
            raise OAuthError("Refusing symlinked credential database")
        if self.db.exists() and (not self.db.is_file() or self.db.stat().st_mode & 0o077):
            raise OAuthError("Credential database must be a private regular file (0600)")
        # Private SQLite journal files stay within the private directory.
        with self._connect() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS pending (state_hash TEXT PRIMARY KEY, "
                         "verifier BLOB NOT NULL, expires INTEGER NOT NULL)")
            conn.execute("CREATE TABLE IF NOT EXISTS credentials (id INTEGER PRIMARY KEY CHECK(id=1), "
                         "refresh_token BLOB NOT NULL, scope TEXT NOT NULL)")
        os.chmod(self.db, 0o600)

    def _connect(self):
        return sqlite3.connect(self.db, timeout=5)

    def begin(self):
        """Call only from an owner-authenticated action; never from public GET."""
        state = secrets.token_urlsafe(32)
        verifier = _b64(secrets.token_bytes(32))
        challenge = _b64(hashlib.sha256(verifier.encode("ascii")).digest())
        with self._connect() as conn:
            conn.execute("DELETE FROM pending WHERE expires < ?", (int(self.clock()),))
            conn.execute("INSERT INTO pending VALUES (?, ?, ?)",
                         (hashlib.sha256(state.encode()).hexdigest(),
                          self.fernet.encrypt(verifier.encode()), int(self.clock()) + STATE_TTL))
        params = {"client_id": self.client_id, "redirect_uri": self.redirect_uri,
                  "response_type": "code", "scope": SCOPE, "access_type": "offline",
                  "prompt": "consent", "state": state, "code_challenge": challenge,
                  "code_challenge_method": "S256"}
        return AUTH_URL + "?" + urllib.parse.urlencode(params)

    def finish(self, *, state, code):
        """Consume state once. The caller must validate callback path and Google errors."""
        if not isinstance(state, str) or not isinstance(code, str) or not state or not code:
            raise OAuthError("Missing authorization state or code")
        digest = hashlib.sha256(state.encode()).hexdigest()
        with self._connect() as conn:
            row = conn.execute("SELECT verifier, expires FROM pending WHERE state_hash=?", (digest,)).fetchone()
            conn.execute("DELETE FROM pending WHERE state_hash=?", (digest,))
        if row is None or row[1] < self.clock():
            raise OAuthError("Authorization expired or already consumed")
        try:
            verifier = self.fernet.decrypt(row[0]).decode("ascii")
        except InvalidToken as exc:
            raise OAuthError("Authorization state cannot be decrypted") from exc
        result = self.request(TOKEN_URL, data={
            "grant_type": "authorization_code", "client_id": self.client_id,
            "client_secret": self.client_secret, "redirect_uri": self.redirect_uri,
            "code": code, "code_verifier": verifier})
        refresh = result.get("refresh_token")
        granted = set(result.get("scope", "").split())
        if not isinstance(refresh, str) or not refresh or SCOPE not in granted:
            raise OAuthError("Missing offline refresh token or requested scope")
        with self._connect() as conn:
            conn.execute("INSERT OR REPLACE INTO credentials VALUES (1, ?, ?)",
                         (self.fernet.encrypt(refresh.encode()), SCOPE))
        return {"connected": True, "scope": SCOPE}

    def _access_token(self):
        with self._connect() as conn:
            row = conn.execute("SELECT refresh_token FROM credentials WHERE id=1").fetchone()
        if row is None:
            raise OAuthError("Google account is not connected")
        try:
            refresh = self.fernet.decrypt(row[0]).decode()
        except InvalidToken as exc:
            raise OAuthError("Stored credential cannot be decrypted") from exc
        result = self.request(TOKEN_URL, data={
            "grant_type": "refresh_token", "client_id": self.client_id,
            "client_secret": self.client_secret, "refresh_token": refresh})
        token = result.get("access_token")
        if not isinstance(token, str) or not token:
            raise OAuthError("Google did not return an access token")
        # Some providers rotate refresh tokens. Preserve new value when supplied.
        if result.get("refresh_token"):
            with self._connect() as conn:
                conn.execute("UPDATE credentials SET refresh_token=? WHERE id=1",
                             (self.fernet.encrypt(result["refresh_token"].encode()),))
        return token

    def list_authorized_files(self, page_size=50):
        """Only files Google allows under drive.file; not all user Drive files."""
        if not isinstance(page_size, int) or not 1 <= page_size <= 100:
            raise ValueError("page_size must be 1..100")
        query = urllib.parse.urlencode({"fields": "nextPageToken,files(id,name,mimeType)",
                                        "pageSize": page_size})
        return self.request(DRIVE_URL + "?" + query, token=self._access_token())

    def read_sheet(self, spreadsheet_id, range_a1):
        """Read only. Write APIs are intentionally absent until approval UI exists."""
        if not spreadsheet_id or not range_a1:
            raise ValueError("Spreadsheet ID and A1 range required")
        path = (SHEETS_URL + "/" + urllib.parse.quote(spreadsheet_id, safe="")
                + "/values/" + urllib.parse.quote(range_a1, safe=""))
        return self.request(path, token=self._access_token())

    def disconnect_local(self):
        """Remove local access. Also revoke the app in Google Account permissions."""
        with self._connect() as conn:
            conn.execute("DELETE FROM credentials WHERE id=1")
            conn.execute("DELETE FROM pending")


def from_environment():
    """Fail closed until explicitly configured; no credentials in repository."""
    required = ("ZIWEI_GOOGLE_CLIENT_ID", "ZIWEI_GOOGLE_CLIENT_SECRET",
                "ZIWEI_GOOGLE_REDIRECT_URI", "ZIWEI_GOOGLE_FERNET_KEY", "HERMES_HOME")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise OAuthError("Google connection not configured: " + ", ".join(missing))
    return GoogleConnection(
        directory=Path(os.environ["HERMES_HOME"]) / "private" / "google",
        client_id=os.environ["ZIWEI_GOOGLE_CLIENT_ID"],
        client_secret=os.environ["ZIWEI_GOOGLE_CLIENT_SECRET"],
        redirect_uri=os.environ["ZIWEI_GOOGLE_REDIRECT_URI"],
        encryption_key=os.environ["ZIWEI_GOOGLE_FERNET_KEY"].encode())
