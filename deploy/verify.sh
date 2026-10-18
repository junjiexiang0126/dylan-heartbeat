#!/usr/bin/env bash
# 五项验收：身份 / 记忆 / 聊天库 / 通道 / 网页。全绿才算搬完。
# 用法: bash deploy/verify.sh [/path/to/out]
set -uo pipefail

SRC="${1:-}"
HERMES_DATA="${HERMES_DATA:-/opt/hermes-data}"
DOMAIN="${DOMAIN:-zhiweilove.me}"
FAIL=0
ok()   { echo "  [ok]   $1"; }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

MANIFEST=""
[ -n "$SRC" ] && MANIFEST="$(ls -1t "$SRC"/MANIFEST-*.txt 2>/dev/null | head -1 || true)"

want_of() { [ -n "$MANIFEST" ] && grep "^$1" "$MANIFEST" | head -1 | awk -F': *' '{print $2}'; }

echo "== 1. 身份 =="
got="$(sha256sum "$HERMES_DATA/SOUL.md" 2>/dev/null | cut -d' ' -f1)"
want="$(want_of 'identity SOUL.md')"
if [ -n "$got" ] && { [ -z "$want" ] || [ "$got" = "$want" ]; }; then
  ok "SOUL.md ${got:0:16}… ($(wc -c < "$HERMES_DATA/SOUL.md") 字节)"
else
  bad "SOUL.md 不一致：got=${got:0:16} want=${want:0:16}"
fi

echo "== 2. 记忆 =="
for pair in "MEMORY.md:memory MEMORY.md" "USER.md:memory USER.md"; do
  name="${pair%%:*}"; key="${pair#*:}"
  g="$(sha256sum "$HERMES_DATA/memories/$name" 2>/dev/null | cut -d' ' -f1)"
  w="$(want_of "$key")"
  if [ -n "$g" ] && { [ -z "$w" ] || [ "$g" = "$w" ]; }; then ok "$name ${g:0:16}…"; else bad "$name 不一致"; fi
done

echo "== 3. 聊天库 =="
python3 - "$HERMES_DATA/state.db" "${MANIFEST:-}" <<'PY'
import sqlite3, sys, re
db, manifest = sys.argv[1], sys.argv[2]
try:
    c = sqlite3.connect('file:%s?mode=ro' % db, uri=True)
    integ = c.execute('pragma integrity_check').fetchone()[0]
    n = c.execute('select count(*) from messages').fetchone()[0]
except Exception as e:
    print('  [FAIL] 打不开 %s: %s' % (db, e)); raise SystemExit(1)
want = None
if manifest:
    txt = open(manifest, encoding='utf-8').read()
    m = re.search(r'^messages:\s*(\d+)', txt, re.M)
    if m: want = int(m.group(1))
print('  [%s] integrity=%s messages=%d%s' % ('ok' if integ == 'ok' else 'FAIL', integ, n,
      '' if want is None else '（旧机 %d）' % want))
if integ != 'ok' or (want is not None and n < want):
    raise SystemExit(1)
PY
[ $? -ne 0 ] && FAIL=$((FAIL+1)) || true

echo "== 4. 通道 =="
h="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://hermes.$DOMAIN/health" || true)"
[ "$h" = "200" ] && ok "https://hermes.$DOMAIN/health -> 200" || bad "原生 API 健康检查 -> ${h:-无响应}"
if docker logs ziwei-hermes 2>&1 | grep -q "wecom connected"; then
  ok "微信（企业微信长连接）已连上"
else
  bad "微信未连上（看 docker logs ziwei-hermes）"
fi

echo "== 5. 网页 =="
w="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || true)"
[ "$w" = "200" ] && ok "https://$DOMAIN/ -> 200" || bad "网页 -> ${w:-无响应}"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "五项全绿：这套房子可以住了。"
else
  echo "有 $FAIL 项未通过 —— 不许宣称搬完，按上面提示逐项修。"
  exit 1
fi
