#!/bin/bash
# 守望：每分钟看一眼家里还在不在。断了先自己救，救不活就推送到她手机。
# 状态记在 /var/lib/ziwei-watchdog/state.json，避免每次失败都轰炸。
set -u
STATE_DIR=/var/lib/ziwei-watchdog
STATE=$STATE_DIR/state.json
mkdir -p "$STATE_DIR"
PUSH_TOKEN=$(cat /opt/push/token 2>/dev/null)
PUSH_URL=http://127.0.0.1:3010/push/send
COOLDOWN=1800   # 同一类告警 30 分钟内只发一次

now=$(date +%s)
read_state() { python3 - "$STATE" <<'PY'
import json, sys, os
p = sys.argv[1]
try:
    print(json.dumps(json.load(open(p))))
except Exception:
    print(json.dumps({'fails': 0, 'restarts': [], 'last_alert': 0}))
PY
}
save_state() { printf '%s' "$1" > "$STATE"; }

notify() { # notify <标题> <正文>
  [ -n "$PUSH_TOKEN" ] || return 0
  curl -s -X POST -H "X-Push-Token: $PUSH_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"title\":\"$1\",\"body\":\"$2\",\"url\":\"/\"}" "$PUSH_URL" >/dev/null 2>&1 || true
}

health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:8642/health 2>/dev/null)
web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3001/ 2>/dev/null)
push=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3010/push/vapid-public 2>/dev/null)
wecom_env=$(docker exec ziwei-hermes sh -c 'tr "\0" "\n" < /proc/1/environ | grep -c ^WECOM' 2>/dev/null || echo 0)

st=$(read_state)
fails=$(echo "$st" | python3 -c 'import json,sys;print(json.load(sys.stdin)["fails"])')
last_alert=$(echo "$st" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("last_alert",0))')

bad=""
[ "$health" = "200" ] || bad="$bad 网关($health)"
[ "$web" = "200" ] || bad="$bad 网页($web)"
[ "$push" = "200" ] || bad="$bad 推送($push)"

if [ -z "$bad" ]; then
  # 一切正常：清计数，只在从坏到好时说一声
  if [ "$fails" -ge 3 ]; then
    notify "知微回来了" "刚才有点问题，现在网关、网页、推送都正常了。"
  fi
  save_state '{"fails": 0, "restarts": [], "last_alert": 0}'
  exit 0
fi

fails=$((fails + 1))
restarted=0
if [ "$fails" -ge 3 ] && [ "$health" != "200" ]; then
  docker restart ziwei-hermes >/dev/null 2>&1 && restarted=1
  sleep 20
  health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:8642/health 2>/dev/null)
  [ "$health" = "200" ] && restarted=2
fi

if [ $((now - last_alert)) -ge "$COOLDOWN" ]; then
  if [ "$restarted" = "2" ]; then
    notify "刚重启过一次" "出问题的是：$bad。已经自动重启，网关恢复了。如果反复出现，可能要你看一眼。"
  elif [ "$restarted" = "1" ] || [ "$fails" -ge 3 ]; then
    notify "知微这边出问题了" "异常：$bad。已尝试重启$([ "$restarted" = "1" ] && echo "但没救活")。时间 $(date '+%H:%M')。"
  fi
  last_alert=$now
fi

save_state "{\"fails\": $fails, \"restarts\": [], \"last_alert\": $last_alert, \"last_bad\": \"$bad\", \"at\": $now}"
exit 0
