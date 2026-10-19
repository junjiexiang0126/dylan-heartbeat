#!/bin/bash
# 知微之家 · 每日备份（宿主执行）
# 库用 sqlite backup API 做一致快照；配置与密钥文件一并留；保留 7 天。
set -u

ROOT=/opt/backups
STAMP=$(date +%Y%m%d-%H%M)
OUT="$ROOT/$STAMP"
mkdir -p "$OUT"

python3 - "$OUT" <<'PY'
import json, os, sqlite3, sys
out = sys.argv[1]
targets = {
    'state.db':        '/opt/hermes-data/state.db',
    'chat.sqlite':     '/opt/ziwei-web-data/chat.sqlite',
    'moments.sqlite':  '/opt/ziwei-web-data/moments.sqlite',
    'work.sqlite':     '/opt/ziwei-web-data/work.sqlite',
}
report = {}
for name, path in targets.items():
    if not os.path.isfile(path):
        report[name] = 'missing'
        continue
    try:
        src = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
        dst = sqlite3.connect(os.path.join(out, name))
        src.backup(dst)
        dst.close(); src.close()
        c = sqlite3.connect(os.path.join(out, name))
        ok = c.execute('pragma integrity_check').fetchone()[0]
        n = c.execute("select count(*) from messages").fetchone()[0] if name != 'moments.sqlite' else c.execute('select count(*) from posts').fetchone()[0]
        c.close()
        report[name] = {'bytes': os.path.getsize(os.path.join(out, name)), 'integrity': ok, 'rows': n}
    except Exception as exc:
        report[name] = 'error:%s' % type(exc).__name__
print(json.dumps(report, ensure_ascii=False))
PY

# 身份、记忆、定时、密钥
mkdir -p "$OUT/meta"
cp -a /opt/hermes-data/config.yaml "$OUT/meta/" 2>/dev/null
cp -a /opt/hermes-data/SOUL.md "$OUT/meta/" 2>/dev/null
cp -a /opt/hermes-data/memories "$OUT/meta/" 2>/dev/null
cp -a /opt/hermes-data/cron/jobs.json "$OUT/meta/" 2>/dev/null
cp -a /opt/ziwei-web.env "$OUT/meta/" 2>/dev/null
cp -a /opt/ziwei-hermes.env "$OUT/meta/" 2>/dev/null
find /opt/hermes-data/skills -name SKILL.md | sed 's|/opt/hermes-data/||' | sort > "$OUT/meta/skills-list.txt"

# 2026-10-19 增补：宿主侧配置，换机器必需
mkdir -p "$OUT/host"
cp -a /opt/push/vapid.json "$OUT/host/push-vapid.json" 2>/dev/null      # 推送身份，丢了要重新订阅
cp -a /opt/push/token "$OUT/host/push-token" 2>/dev/null                 # 推送发送凭据
cp -a /opt/push/subs.sqlite "$OUT/host/push-subs.sqlite" 2>/dev/null     # 已订阅设备
cp -a /etc/caddy/Caddyfile "$OUT/host/Caddyfile" 2>/dev/null             # 反代与证书配置
cp -a /etc/systemd/system/ziwei-*.service "$OUT/host/" 2>/dev/null       # 自定义服务单元
cp -a /etc/systemd/system/ziwei-*.timer "$OUT/host/" 2>/dev/null
crontab -l > "$OUT/host/crontab.txt" 2>/dev/null                          # 备份任务与清理
cp -a /opt/ziwei-tools "$OUT/host/ziwei-tools" 2>/dev/null                # 运维脚本本体

chmod -R go-rwx "$OUT"
find /opt/hermes-data/skills -name SKILL.md >/dev/null 2>&1 || true

# 容器定义（能照着重建）
for c in ziwei-hermes ziwei-web; do
  docker inspect "$c" > "$OUT/meta/$c.inspect.json" 2>/dev/null
done

# 保留 7 天
find "$ROOT" -maxdepth 1 -type d -name '20*' -mtime +7 -exec rm -rf {} + 2>/dev/null

echo "backup done: $OUT ($(du -sh "$OUT" | cut -f1))"
