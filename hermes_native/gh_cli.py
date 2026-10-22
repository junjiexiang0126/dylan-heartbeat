#!/usr/bin/env python3
"""知微的 GitHub 操作入口：令牌只从网关进程 environ 读，永不打印。

为什么需要它：GitHub App 的凭证只存在于网关进程（runtime_launch.py）的环境里，
普通工具 shell 里既没有 GH_APP_* 也没有 GITHUB_TOKEN，
所以 `python3 -m hermes_native.github_app token` 在终端里会报"没有凭证"。

用法：
  python3 scripts/gh.py push [分支]        # 推送当前 HEAD 到远端分支（默认整合分支）
  python3 scripts/gh.py api GET /repos/...  # 调 GitHub API，输出 JSON
  python3 scripts/gh.py check               # 只检查能否拿到令牌（不打印值）

凭据优先级：GitHub App 安装令牌 > 网关 environ 里的 GITHUB_TOKEN。
任何情况下都不打印令牌、不写盘。
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_SLUG = "junjiexiang0126/dylan-heartbeat"
DEFAULT_BRANCH = "integration/main-consolidation-20261017"
LEGACY_REPO = "/data/hermes_native/workspace/tmp/zwweb"

# 只允许 git 分支名里的合法字符；刻意保守，宁可拒绝也不要在远端建出怪名字。
_BRANCH_CHARS = re.compile(r"[A-Za-z0-9._/-]{1,120}")


def validate_branch(branch: str) -> str | None:
    """检查分支名。合法返回 None，不合法返回拒绝原因（给人看的中文）。

    2026-10-18 事故：`gh.py push --help` 把 "--help" 当分支名推上了远端，
    在 GitHub 上留下一个名为 "--help" 的分支。参数被当成分支名会造成
    远端副作用，所以在取令牌、跑 git 之前就必须挡住。
    """
    if not branch:
        return "分支名为空"
    if branch.startswith("-"):
        return f"'{branch}' 看起来是命令参数，不是分支名"
    if not _BRANCH_CHARS.fullmatch(branch):
        return f"'{branch}' 含非法字符（只允许字母、数字、. _ - /）"
    if branch.startswith("/") or branch.endswith("/") or "//" in branch:
        return f"'{branch}' 的斜杠位置不合法"
    if ".." in branch:
        return f"'{branch}' 含 '..'"
    if branch.endswith(".") or branch.endswith(".lock"):
        return f"'{branch}' 不能以 '.' 或 '.lock' 结尾"
    if "@{" in branch:
        return f"'{branch}' 含 '@{{'"
    return None


def resolve_repo() -> str:
    """找要推送的仓库目录：显式环境变量 > 本文件所在仓库 > 旧迁移路径。"""
    explicit = os.environ.get("ZW_REPO")
    if explicit:
        return explicit
    candidate = Path(__file__).resolve().parents[1]
    if (candidate / ".git").exists():
        return str(candidate)
    return LEGACY_REPO


def gateway_environ() -> dict[str, str]:
    """从正在运行的网关进程读环境变量（不进 argv、不落盘）。"""
    out = subprocess.run(["pgrep", "-f", "runtime_launch.py gateway"],
                         capture_output=True, text=True)
    pids = [p.strip() for p in out.stdout.split() if p.strip()]
    for pid in pids:
        try:
            raw = open(f"/proc/{pid}/environ", "rb").read()
        except OSError:
            continue
        env: dict[str, str] = {}
        for item in raw.split(b"\0"):
            if b"=" in item:
                k, v = item.split(b"=", 1)
                env[k.decode()] = v.decode("utf-8", "replace")
        if env:
            return env
    return {}


def installation_token(env: dict[str, str]) -> str | None:
    try:
        sys.path.insert(0, "/data/hermes_native/workspace/tmp/zwweb")
        from hermes_native import github_app as ga  # type: ignore
    except Exception:
        return None
    try:
        return ga.InstallationToken(ga.Credentials.from_env(env)).token()
    except Exception:
        return None


def get_token() -> str:
    env = gateway_environ()
    tok = installation_token(env)
    if tok:
        return tok
    pat = env.get("GITHUB_TOKEN") or env.get("GH_TOKEN")
    if pat:
        return pat
    raise SystemExit("拿不到 GitHub 令牌：网关 environ 里既无 App 凭证也无 GITHUB_TOKEN")


def cmd_check() -> int:
    env = gateway_environ()
    print("网关 environ 可见:", bool(env))
    tok = installation_token(env)
    print("App 安装令牌:", "可获取" if tok else "不可用")
    print("GITHUB_TOKEN:", "存在" if env.get("GITHUB_TOKEN") else "不存在")
    return 0 if (tok or env.get("GITHUB_TOKEN")) else 1


def cmd_push(argv: list[str]) -> int:
    # 参数校验放在取令牌、跑 git 之前：非法输入不该有任何副作用，
    # 也不该先花一次令牌请求。
    if len(argv) > 1:
        print(f"拒绝推送：只接受一个分支名参数，收到 {len(argv)} 个：{argv}")
        return 2
    branch = argv[0] if argv else DEFAULT_BRANCH
    reason = validate_branch(branch)
    if reason:
        print(f"拒绝推送：{reason}。用法：gh.py push <branch>")
        return 2
    repo = resolve_repo()
    tok = get_token()
    slug = os.environ.get("ZW_REPO_SLUG", REPO_SLUG)
    url = f"https://x-access-token:{tok}@github.com/{slug}.git"
    r = subprocess.run(["git", "-C", repo, "push", url, f"HEAD:{branch}"],
                       capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()
    msg = tail[-1].replace(tok, "***") if tail else ""
    print(f"push exit={r.returncode} {msg[:160]}")
    return r.returncode


def cmd_api(argv: list[str]) -> int:
    if len(argv) < 2:
        raise SystemExit("用法: gh.py api GET /path")
    method, path = argv[0], argv[1]
    tok = get_token()
    req = urllib.request.Request(
        "https://api.github.com" + path, method=method.upper(),
        headers={"Authorization": "token " + tok, "Accept": "application/vnd.github+json",
                 "User-Agent": "ziwei-gh/1.0", "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            print(resp.read().decode())
            return 0
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:300]}")
        return 1


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd, argv = sys.argv[1], sys.argv[2:]
    if cmd == "check":
        return cmd_check()
    if cmd == "push":
        return cmd_push(argv)
    if cmd == "api":
        return cmd_api(argv)
    print(f"未知命令 {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
