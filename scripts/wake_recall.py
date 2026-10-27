#!/usr/bin/env python3
"""醒来第一步：按「今天要干的事」去旧笔记里找相关的那几段。

用途：接在自主唤醒的第 0.5 步。每次醒来先跑它，拿到 1–3 段真正相关的旧笔记，
再决定要不要动手。找不到就明确输出「无相关旧笔记」，不硬凑。

用法：
  python3 scripts/wake_recall.py              # 自动取今天的事
  python3 scripts/wake_recall.py 考研 备考      # 手动给关键词
  python3 scripts/wake_recall.py --top 5

注意：
- 查询词会发给嵌入模型（百炼）。所以只从任务标题、日期、公开笔记标题里取词，
  **绝不拿日记原文、地址、账号当查询词**。
- 输出总长控制在 ~900 字内，避免把上下文又撑大。
"""
import argparse
import json
import math
import sys
from datetime import date
from pathlib import Path

WS = Path("/opt/data/workspace")
DB = WS / "notes" / "semantic.sqlite"
MAX_CHARS = 900


def today_queries():
    """从任务表和今天的东西里凑查询词，不碰日记正文。"""
    words = []
    tf = WS / "workspace" if False else WS / "tasks.json"
    if not tf.exists():
        tf = Path("/opt/data/workspace/tasks.json")
    try:
        data = json.loads(tf.read_text())
        items = data if isinstance(data, list) else data.get("tasks", [])
        for t in items:
            if str(t.get("status", "")).lower() in ("pending", "in_progress", "waiting_user"):
                title = t.get("title") or ""
                if title:
                    words.append(title)
    except Exception:
        pass
    if not words:
        words.append(date.today().strftime("%Y-%m-%d"))
    return words


def load_index():
    """把库里所有块的 (path, heading, text, vec) 读出来。只读。"""
    import sqlite3

    c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    out = []
    for path, heading, text, vec in c.execute(
        "SELECT path, heading, text, vec FROM chunks WHERE vec IS NOT NULL AND light='green'"
    ):
        out.append((path, heading, text, json.loads(vec)))
    return out


def cos(a, b):
    d = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return d / (na * nb) if na and nb else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("words", nargs="*")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--threshold", type=float, default=0.35)
    a = ap.parse_args()

    queries = a.words or today_queries()
    q = " ".join(queries)[:200]

    sys.path.insert(0, str(WS / "scripts"))
    import importlib.util

    spec = importlib.util.spec_from_file_location("es", WS / "scripts" / "embed_sync.py")
    es = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(es)

    if not DB.exists():
        print("向量库不存在，跳过检索。")
        return 0

    try:
        vs, _ = es.embed([q], es.key())
        qv = vs[0]
    except Exception as e:
        print("检索失败（嵌入不可用）：%s" % str(e)[:120])
        return 0

    scored = []
    for path, heading, text, vec in load_index():
        scored.append((cos(qv, vec), path, heading, text))
    scored.sort(reverse=True)

    picked, seen, budget = [], set(), 0
    for score, path, heading, text in scored:
        if score < a.threshold or path in seen:
            continue
        seen.add(path)
        snippet = " ".join(text.split())[:220]
        block = "[%.2f] %s · %s\n%s" % (score, path, (heading or "")[:36], snippet)
        if budget + len(block) > MAX_CHARS:
            break
        picked.append(block)
        budget += len(block)
        if len(picked) >= a.top:
            break

    print("醒来检索：查询「%s」" % q[:80])
    if not picked:
        print("无相关旧笔记。")
        return 0
    for b in picked:
        print(b)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
