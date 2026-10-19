#!/bin/bash
# 还原演练：拿最近一份每日备份，还原到临时目录，比对条数与完整性。全程不碰线上库。
set -u
SRC=$(ls -1dt /opt/backups/20*/ 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "没有找到每日备份"; exit 2; }
DEST=/tmp/restore-drill-$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
echo "  备份源: $SRC"
echo "  还原到: $DEST"

pass=0; bad=0
for f in state.db chat.sqlite moments.sqlite work.sqlite; do
  [ -f "$SRC$f" ] || { echo "  - $f 备份里没有，跳过"; continue; }
  cp "$SRC$f" "$DEST/$f"
  out=$(python3 - "$DEST/$f" "$f" <<'PY'
import sqlite3, sys
path, name = sys.argv[1], sys.argv[2]
try:
    c = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
    integ = c.execute('pragma integrity_check').fetchone()[0]
    table = 'posts' if name == 'moments.sqlite' else 'messages'
    try:
        n = c.execute('select count(*) from %s' % table).fetchone()[0]
    except Exception:
        n = 0
    print('%s %d' % (integ, n))
except Exception as exc:
    print('error 0')
PY
)
  set -- $out
  live=$(python3 - "$f" <<'PY'
import sqlite3, sys
name = sys.argv[1]
paths = {'state.db': '/opt/hermes-data/state.db',
         'chat.sqlite': '/opt/ziwei-web-data/chat.sqlite',
         'moments.sqlite': '/opt/ziwei-web-data/moments.sqlite',
         'work.sqlite': '/opt/ziwei-web-data/work.sqlite'}
table = 'posts' if name == 'moments.sqlite' else 'messages'
try:
    c = sqlite3.connect('file:%s?mode=ro' % paths[name], uri=True)
    print(c.execute('select count(*) from %s' % table).fetchone()[0])
except Exception:
    print(-1)
PY
)
  if [ "$1" = "ok" ]; then
    echo "  ✓ $f  integrity=ok  还原条目=$2  线上条目=$live"
    pass=$((pass+1))
  else
    echo "  ✗ $f  还原后校验失败（$1）"
    bad=$((bad+1))
  fi
done

echo ""
echo "  演练结果：通过 $pass 个，失败 $bad 个"
echo "  临时目录保留在 $DEST（可自行删除）"
[ "$bad" -eq 0 ] || exit 1
