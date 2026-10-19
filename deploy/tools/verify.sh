#!/bin/bash
# 一键验收：五项检查。全绿退出 0，否则退出 1。
# 用法：verify.sh [--quiet]
set -u
QUIET=${1:-}
ok=0; fail=0
say() { [ "$QUIET" = "--quiet" ] || echo "$@"; }
chk() { # chk <名称> <0=通过|非0=失败> <细节>
  if [ "$2" -eq 0 ]; then ok=$((ok+1)); say "  ✓ $1  $3"; else fail=$((fail+1)); say "  ✗ $1  $3"; fi
}

# 1 身份
SH=$(sha256sum /opt/hermes-data/SOUL.md 2>/dev/null | cut -d' ' -f1)
SZ=$(stat -c%s /opt/hermes-data/SOUL.md 2>/dev/null || echo 0)
[ -n "$SH" ] && [ "$SZ" -gt 3000 ]; chk "身份 SOUL.md" $? "$SZ 字节 ${SH:0:12}"

# 2 记忆
M1=$(sha256sum /opt/hermes-data/memories/MEMORY.md 2>/dev/null | cut -d' ' -f1)
M2=$(sha256sum /opt/hermes-data/memories/USER.md 2>/dev/null | cut -d' ' -f1)
[ -n "$M1" ] && [ -n "$M2" ] && [ $(stat -c%s /opt/hermes-data/memories/MEMORY.md) -gt 1000 ]; chk "长期记忆" $? "MEMORY ${M1:0:8} / USER ${M2:0:8}"

# 3 聊天库
DB=/opt/hermes-data/state.db
INT=$(python3 - "$DB" <<'PY'
import sqlite3, sys
try:
    c = sqlite3.connect('file:%s?mode=ro' % sys.argv[1], uri=True)
    print(c.execute('pragma integrity_check').fetchone()[0], c.execute('select count(*) from messages').fetchone()[0])
except Exception:
    print('error 0')
PY
)
set -- $INT
[ "$1" = "ok" ] && [ "${2:-0}" -gt 1000 ]; chk "聊天库" $? "${2} 条 / integrity=$1"

# 4 通道（微信）
ENVF=$(docker exec ziwei-hermes sh -c 'tr "\0" "\n" < /proc/1/environ | grep -c ^WECOM' 2>/dev/null || echo 0)
ENABLED=$(docker exec ziwei-hermes sh -c 'hermes config get platforms.wecom.enabled' 2>/dev/null | tail -1)
[ "${ENVF:-0}" -ge 4 ] && [ "$ENABLED" = "true" ]; chk "微信通道" $? "env ${ENVF:-0} 项 / enabled=$ENABLED"

# 5 网页
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://zhiweilove.me/ 2>/dev/null)
API=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://zhiweilove.me/api/moments 2>/dev/null)
[ "$CODE" = "200" ] && [ "$API" = "401" ]; chk "网页" $? "首页 $CODE / 未登录接口 $API(应为401)"

say ""
say "  通过 $ok 项，失败 $fail 项"
[ "$fail" -eq 0 ] || exit 1
