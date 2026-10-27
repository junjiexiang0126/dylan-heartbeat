#!/usr/bin/env python3
"""语义检索：notes/semantic.sqlite 里那堆向量终于能查了。

用法:
  python3 scripts/semantic_search.py 婚礼
  python3 scripts/semantic_search.py 她说想留泰国 --top 8
  python3 scripts/semantic_search.py 心潮 驱力 --green-only

注意：只读库，不改任何东西；查询文本会发给嵌入模型（百炼）。
所以别拿住址、账号、日记原文当查询词——那是红灯内容，和库里的规矩一致。
"""
import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path

WS = Path("/opt/data/workspace")
DB = WS / "notes" / "semantic.sqlite"


def load_rows(green_only=True):
    c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    q = "SELECT path, heading, text, vec, light FROM chunks WHERE vec IS NOT NULL"
    if green_only:
        q += " AND light='green'"
    for path, heading, text, vec, light in c.execute(q):
        yield path, heading, text, json.loads(vec), light


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="+")
    ap.add_argument("--top", type=int, default=6)
    ap.add_argument("--green-only", action="store_true", default=True)
    ap.add_argument("--all-lights", action="store_true")
    a = ap.parse_args()
    q = " ".join(a.query)

    sys.path.insert(0, str(WS / "scripts"))
    import importlib.util
    spec = importlib.util.spec_from_file_location("es", WS / "scripts" / "embed_sync.py")
    es = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(es)

    vs, _usage = es.embed([q], es.key())
    qv = vs[0]

    scored = []
    for path, heading, text, vec, light in load_rows(not a.all_lights):
        scored.append((cosine(qv, vec), path, heading, text))
    scored.sort(reverse=True)

    if not scored:
        print("库里没有向量；先跑 embed_sync.py --run")
        return 1
    print("查询：%s   命中库内 %d 块\n" % (q, len(scored)))
    for score, path, heading, text in scored[: a.top]:
        snippet = " ".join(text.split())[:220]
        print("[%.3f] %s · %s" % (score, path, (heading or "")[:40]))
        print("        %s" % snippet)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
