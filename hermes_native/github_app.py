"""GitHub App 身份认证（短期安装令牌）

为什么要有这个模块：仓库里长期用的是个人 PAT（GITHUB_TOKEN），它有两个硬伤——
改不了 `.github/workflows/*`、触发不了 Actions；而且是长期凭证、权限覆盖全部仓库。

这里实现 GitHub App 的正规链路：
  1. 用 App 私钥签 JWT（RS256，≤10 分钟）
  2. 用 JWT 换 installation access token（默认 1 小时）
  3. 缓存令牌，过期前 60 秒自动换新
  4. 提供 `token()` 给 git/HTTP 使用，`api()` 直接调 REST

凭证只从环境变量或文件读取，**绝不打印、不落盘、不写日志**。

环境变量（三选一给私钥）：
  GH_APP_ID                  App ID（数字）
  GH_APP_INSTALLATION_ID     安装 ID（数字）
  GH_APP_PRIVATE_KEY_B64     私钥 PEM 的 base64（推荐，Railway 友好，单行）
  GH_APP_PRIVATE_KEY         私钥 PEM 原文（允许把换行写成 \\n）
  GH_APP_PRIVATE_KEY_FILE    私钥 PEM 文件路径（权限应 600）

CLI：
  python3 -m hermes_native.github_app token   # 打印安装令牌（供 git 使用）
  python3 -m hermes_native.github_app check   # 只校验凭证是否齐全并换取一次
"""
from __future__ import annotations

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Mapping, Optional

API = "https://api.github.com"
JWT_TTL = 540          # 9 分钟，GitHub 上限 10 分钟
REFRESH_BEFORE = 60    # 提前 60 秒换新


class GitHubAppError(RuntimeError):
    pass


@dataclass
class Credentials:
    app_id: str
    installation_id: str
    private_key_pem: bytes = field(repr=False)

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Credentials":
        env = os.environ if env is None else env
        app_id = str(env.get("GH_APP_ID") or "").strip()
        inst = str(env.get("GH_APP_INSTALLATION_ID") or "").strip()
        if not app_id or not inst:
            raise GitHubAppError("GH_APP_ID / GH_APP_INSTALLATION_ID 未设置")

        pem_bytes: Optional[bytes] = None
        b64 = (env.get("GH_APP_PRIVATE_KEY_B64") or "").strip()
        if b64:
            try:
                pem_bytes = base64.b64decode(b64)
            except Exception as exc:  # noqa: BLE001
                raise GitHubAppError("GH_APP_PRIVATE_KEY_B64 不是合法 base64") from exc
        else:
            inline = env.get("GH_APP_PRIVATE_KEY") or ""
            if inline:
                pem_bytes = inline.replace("\\n", "\n").encode()
            else:
                path = (env.get("GH_APP_PRIVATE_KEY_FILE") or "").strip()
                if path:
                    with open(path, "rb") as fh:
                        pem_bytes = fh.read()

        if not pem_bytes:
            raise GitHubAppError("缺少私钥：设置 GH_APP_PRIVATE_KEY_B64 / GH_APP_PRIVATE_KEY / GH_APP_PRIVATE_KEY_FILE 之一")
        if b"PRIVATE KEY" not in pem_bytes:
            raise GitHubAppError("私钥内容不像 PEM（缺少 'PRIVATE KEY' 头）")
        return cls(app_id=app_id, installation_id=inst, private_key_pem=pem_bytes)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def make_jwt(creds: Credentials, now: Optional[float] = None, ttl: int = JWT_TTL) -> str:
    """RS256 JWT：iat 回拨 60 秒防时钟漂移，exp ≤ 10 分钟。"""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key = serialization.load_pem_private_key(creds.private_key_pem, password=None)
    issued = int((now if now is not None else time.time()) - 60)
    header = {"alg": "RS256", "typ": "JWT"}
    payload = {"iat": issued, "exp": issued + ttl + 60, "iss": int(creds.app_id)}
    signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}." \
                    f"{_b64url(json.dumps(payload, separators=(',', ':')).encode())}".encode()
    signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return signing_input.decode() + "." + _b64url(signature)


class InstallationToken:
    """线程安全的安装令牌缓存：过期前 60 秒自动换新。"""

    def __init__(self, creds: Credentials, opener=None):
        self._creds = creds
        self._lock = threading.Lock()
        self._token: Optional[str] = None
        self._expires_at: float = 0.0
        self._opener = opener or urllib.request.urlopen

    # 便于测试：不触网时替换
    def _exchange(self, jwt_token: str) -> dict:
        url = f"{API}/app/installations/{self._creds.installation_id}/access_tokens"
        req = urllib.request.Request(
            url, method="POST",
            headers={"Authorization": f"Bearer {jwt_token}",
                     "Accept": "application/vnd.github+json",
                     "User-Agent": "ziwei-hermes/1.0",
                     "X-GitHub-Api-Version": "2022-11-28"},
            data=b"{}")
        try:
            with self._opener(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # 把 GitHub 的说明带出来，便于诊断
            body = exc.read().decode(errors="replace")[:300]
            raise GitHubAppError(f"换取安装令牌失败 HTTP {exc.code}: {body}") from exc
        except urllib.error.URLError as exc:
            raise GitHubAppError(f"连不上 api.github.com: {exc.reason}") from exc

    def token(self, force: bool = False) -> str:
        with self._lock:
            now = time.time()
            if not force and self._token and now < self._expires_at - REFRESH_BEFORE:
                return self._token
            data = self._exchange(make_jwt(self._creds))
            token = data.get("token")
            expires = data.get("expires_at")
            if not token or not expires:
                raise GitHubAppError("安装令牌响应缺少 token/expires_at")
            # expires_at 形如 2026-10-17T23:00:00Z
            self._expires_at = time.mktime(time.strptime(expires, "%Y-%m-%dT%H:%M:%SZ")) - time.timezone + 0
            if self._expires_at <= now:          # 时区兜底：至少按 1 小时算
                self._expires_at = now + 3600
            self._token = token
            return token

    def api(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        """调用 REST；401 时强制换令牌重试一次。"""
        for attempt in (0, 1):
            req = urllib.request.Request(
                API + path, method=method,
                headers={"Authorization": f"token {self.token(force=attempt == 1)}",
                         "Accept": "application/vnd.github+json",
                         "User-Agent": "ziwei-hermes/1.0",
                         "X-GitHub-Api-Version": "2022-11-28",
                         "Content-Type": "application/json"},
                data=None if body is None else json.dumps(body).encode())
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    raw = resp.read().decode()
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as exc:
                if exc.code == 401 and attempt == 0:
                    continue
                raise GitHubAppError(f"{method} {path} → HTTP {exc.code}: {exc.read().decode(errors='replace')[:200]}") from exc
        raise GitHubAppError("unreachable")


_default: Optional[InstallationToken] = None
_default_lock = threading.Lock()


def client(env: Optional[Mapping[str, str]] = None) -> InstallationToken:
    global _default
    with _default_lock:
        if _default is None:
            _default = InstallationToken(Credentials.from_env(env))
        return _default


def available(env: Optional[Mapping[str, str]] = None) -> bool:
    """是否具备 App 凭证（不触网）。"""
    try:
        Credentials.from_env(env)
        return True
    except Exception:  # noqa: BLE001
        return False


def resolve_github_token(env: Optional[Mapping[str, str]] = None) -> str:
    """优先用 App 安装令牌；没有 App 凭证才回退旧 PAT。"""
    env = os.environ if env is None else env
    if available(env):
        return client(env).token()
    pat = (env.get("GITHUB_TOKEN") or "").strip()
    if not pat:
        raise GitHubAppError("既没有 App 凭证，也没有 GITHUB_TOKEN")
    return pat


def _main(argv: list) -> int:
    cmd = argv[1] if len(argv) > 1 else "check"
    if cmd == "token":
        print(resolve_github_token())
        return 0
    if cmd == "check":
        creds = Credentials.from_env()
        print(f"App ID: {creds.app_id} | Installation: {creds.installation_id} | 私钥: {len(creds.private_key_pem)} 字节")
        tok = InstallationToken(creds).token()
        print(f"安装令牌已获取：长度 {len(tok)}，前缀 {tok[:4]}…（不打印全文）")
        return 0
    import sys
    print("用法：python3 -m hermes_native.github_app [token|check]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    import sys
    raise SystemExit(_main(sys.argv))
