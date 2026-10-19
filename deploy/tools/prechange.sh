#!/bin/bash
# 改动前的快照：./prechange.sh <标签>
# 做四样：库一致性快照、配置与密钥文件副本、容器定义、回滚说明。
set -u
LABEL=${1:-manual}
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=/opt/backups/pre-${LABEL}-${STAMP}
mkdir -p "$OUT"

python3 - "$OUT" <<'PY'
import os, sqlite3, sys
out = sys.argv[1]
for name, path in {
    'state.db': '/opt/hermes-data/state.db',
    'chat.sqlite': '/opt/ziwei-web-data/chat.sqlite',
    'moments.sqlite': '/opt/ziwei-web-data/moments.sqlite',
    'work.sqlite': '/opt/ziwei-web-data/work.sqlite',
}.items():
    if not os.path.isfile(path):
        continue
    src = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
    dst = sqlite3.connect(os.path.join(out, name))
    src.backup(dst); dst.close(); src.close()
    print('  ', name, os.path.getsize(os.path.join(out, name)), 'B')
PY

mkdir -p "$OUT/meta"
cp -a /opt/hermes-data/config.yaml /opt/hermes-data/SOUL.md /opt/hermes-data/memories "$OUT/meta/" 2>/dev/null
cp -a /opt/hermes-data/cron/jobs.json /opt/ziwei-hermes.env /opt/ziwei-web.env "$OUT/meta/" 2>/dev/null
chmod -R go-rwx "$OUT"
for c in ziwei-hermes ziwei-web; do docker inspect "$c" > "$OUT/meta/$c.inspect.json" 2>/dev/null; done
cat > "$OUT/回滚说明.txt" <<EOF
回滚步骤（改了容器或库才需要）：
1) 停服务：docker stop ziwei-hermes
2) 还库：cp $OUT/state.db /opt/hermes-data/state.db（网页库同理，路径见下）
   网页：cp $OUT/chat.sqlite /opt/ziwei-web-data/chat.sqlite
3) 还配置：cp $OUT/meta/config.yaml /opt/hermes-data/config.yaml
4) 起服务：docker start ziwei-hermes
5) 验：curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8642/health
容器被删可从 meta/ziwei-hermes.inspect.json 还原参数，或按 deploy/docker-compose.host.yml 重建。
EOF
echo "snapshot: $OUT"
