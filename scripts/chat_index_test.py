#!/usr/bin/env python3
"""聊天记录本地向量测试（只读，不碰原始库，不碰线上服务）。

目的：验证「用本地嵌入模型把聊天切片入库」能不能准确找回旧对话，
以及在本机（2 核 / 3G 内存）上的速度与内存占用。

产物：/opt/data/workspace/notes/chat_test.sqlite（独立测试库，可随时删）
原始数据：只读打开 /opt/data/state.db，不写、不改、不移动。

用法：
  python3 scripts/chat_index_test.py --limit 2000
  python3 scripts/chat_index_test.py --search "天台 星星"
"""
import argparse
import json
import os
import resource
import sqlite3
import time

STATE = "/opt/data/state.db"
OUT = "/opt/data/workspace/notes/chat_test.sqlite"
MODEL = "BAAI/bge-small-zh-v1.5"
CHUNK = 400


def chunk_text(t):
    t = " ".join(t.split())
    if len(t) <= CHUNK:
        return [t]
    return [t[i : i + CHUNK] for i in range(0, len(t), CHUNK)]


def build(limit):
    from fastembed import TextEmbedding

    src = sqlite3.connect("file:%s?mode=ro" % STATE, uri=True)
    rows = src.execute(
        """SELECT session_id, role, content, timestamp FROM messages
           WHERE role IN ('user','assistant') AND length(content) > 8
           ORDER BY rowid DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    print("取到 %d 条消息（只读，未修改原始库）" % len(rows))

    pieces = []
    for sid, role, content, ts in rows:
        for i, c in enumerate(chunk_text(content)):
            pieces.append((sid, role, ts, i, c))
    print("切成 %d 块（每块 ≤%d 字）" % (len(pieces), CHUNK))

    t0 = time.time()
    model = TextEmbedding(model_name=MODEL)
    t_load = time.time() - t0

    if os.path.exists(OUT):
        os.remove(OUT)
    db = sqlite3.connect(OUT)
    db.execute(
        """CREATE TABLE chunks(id INTEGER PRIMARY KEY, session_id TEXT, role TEXT,
           ts REAL, part INT, text TEXT, vec TEXT)"""
    )

    t1 = time.time()
    batch, done = [], 0
    for sid, role, ts, part, c in pieces:
        batch.append((sid, role, ts, part, c))
        if len(batch) >= 64:
            vs = list(model.embed([b[4] for b in batch]))
            db.executemany(
                "INSERT INTO chunks(session_id,role,ts,part,text,vec) VALUES(?,?,?,?,?,?)",
                [(b[0], b[1], b[2], b[3], b[4], json.dumps([float(x) for x in v])) for b, v in zip(batch, vs)],
            )
            done += len(batch)
            batch = []
    if batch:
        vs = list(model.embed([b[4] for b in batch]))
        db.executemany(
            "INSERT INTO chunks(session_id,role,ts,part,text,vec) VALUES(?,?,?,?,?,?)",
            [(b[0], b[1], b[2], b[3], b[4], json.dumps([float(x) for x in v])) for b, v in zip(batch, vs)],
        )
        done += len(batch)
    db.commit()
    t_embed = time.time() - t1

    size = os.path.getsize(OUT) / 1e6
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(
        "完成：%d 块，模型加载 %.1fs，嵌入 %.1fs（%.0f 块/秒），库 %.1f MB，峰值内存 %.0f MB"
        % (done, t_load, t_embed, done / max(t_embed, 0.01), size, rss)
    )
    db.close()


def search(q, top=5):
    import math

    from fastembed import TextEmbedding

    model = TextEmbedding(model_name=MODEL)
    qv = list(model.embed([q]))[0]
    db = sqlite3.connect("file:%s?mode=ro" % OUT, uri=True)
    out = []
    for sid, role, ts, text, vec in db.execute(
        "SELECT session_id,role,ts,text,vec FROM chunks"
    ):
        v = json.loads(vec)
        d = sum(a * b for a, b in zip(qv, v))
        na = math.sqrt(sum(a * a for a in qv))
        nb = math.sqrt(sum(b * b for b in v))
        out.append((d / (na * nb) if na and nb else 0.0, role, ts, text))
    out.sort(reverse=True)
    print("查询：%s（库内 %d 块）\n" % (q, len(out)))
    for score, role, ts, text in out[:top]:
        print("[%.3f] %s · %s" % (score, role, time.strftime("%m-%d %H:%M", time.localtime(ts or 0)) if ts else "-"))
        print("   ", text[:160])
        print()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=2000)
    ap.add_argument("--search")
    ap.add_argument("--top", type=int, default=5)
    a = ap.parse_args()
    if a.search:
        search(a.search, a.top)
    else:
        build(a.limit)
