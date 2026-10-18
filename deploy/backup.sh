#!/usr/bin/env bash
# 旧机导出：不停服务，全部取一致性快照。
# 用法: bash deploy/backup.sh /path/to/out
set -euo pipefail

OUT="${1:?用法: backup.sh <输出目录>}"
HERMES_HOME="${HERMES_HOME:-/data/hermes_native}"
WEB_DATA="${ZIWEI_WEB_DATA_DIR:-/opt/ziwei-web-data}"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M)"
WORK="$(mktemp -d)"

snapshot_db() { # $1=源库 $2=目标文件
  python3 - "$1" "$2" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect('file:%s?mode=ro' % src, uri=True)
d = sqlite3.connect(dst)
with d:
    s.backup(d)
d.close(); s.close()
PY
}

echo "== 1/4 原生数据（state.db 一致性快照 + 身份/记忆/任务/技能）=="
mkdir -p "$WORK/native"
snapshot_db "$HERMES_HOME/state.db" "$WORK/native/state.db"
for item in memories SOUL.md config.yaml .env cron workspace skills; do
  [ -e "$HERMES_HOME/$item" ] && cp -a "$HERMES_HOME/$item" "$WORK/native/" || true
done
# 不把历史备份塞进搬家包（体积大且会混淆回退点）
rm -rf "$WORK/native/workspace/tmp" "$WORK/native/workspace/dev" 2>/dev/null || true

echo "== 2/4 网页数据 =="
if [ -d "$WEB_DATA" ]; then
  mkdir -p "$WORK/web"
  for item in sessions.json auth.json; do
    [ -f "$WEB_DATA/$item" ] && cp -a "$WEB_DATA/$item" "$WORK/web/" || true
  done
  [ -d "$WEB_DATA/attachments" ] && cp -a "$WEB_DATA/attachments" "$WORK/web/" || true
  for db in "$WEB_DATA"/*.db; do [ -f "$db" ] && snapshot_db "$db" "$WORK/web/$(basename "$db")"; done
fi

echo "== 3/4 打包 =="
tar czf "$OUT/native-$STAMP.tar.gz" -C "$WORK" native
[ -d "$WORK/web" ] && tar czf "$OUT/web-$STAMP.tar.gz" -C "$WORK" web || true

echo "== 4/4 清单（校验值 + 条数，不记任何密钥明文）=="
{
  echo "# 搬家包清单 $STAMP"
  echo "host: $(hostname)"
  for f in "$OUT"/native-$STAMP.tar.gz "$OUT"/web-$STAMP.tar.gz; do
    [ -f "$f" ] && echo "$(sha256sum "$f" | cut -d' ' -f1)  $(basename "$f")  $(stat -c %s "$f") 字节"
  done
  echo "identity SOUL.md: $(sha256sum "$WORK/native/SOUL.md" 2>/dev/null | cut -d' ' -f1)"
  echo "memory MEMORY.md: $(sha256sum "$WORK/native/memories/MEMORY.md" 2>/dev/null | cut -d' ' -f1)"
  echo "memory USER.md:   $(sha256sum "$WORK/native/memories/USER.md" 2>/dev/null | cut -d' ' -f1)"
  python3 - "$WORK/native/state.db" <<'PY'
import sqlite3, sys
c = sqlite3.connect('file:%s?mode=ro' % sys.argv[1], uri=True)
print('integrity:', c.execute('pragma integrity_check').fetchone()[0])
print('messages:', c.execute('select count(*) from messages').fetchone()[0])
print('max_ts:', c.execute('select max(timestamp) from messages').fetchone()[0])
PY
} > "$OUT/MANIFEST-$STAMP.txt"

rm -rf "$WORK"
echo "完成：$OUT"
ls -la "$OUT" | tail -4
echo "注意：密钥请单独从受保护的环境文件复制（.env），不要贴进聊天、不要提交仓库。"
