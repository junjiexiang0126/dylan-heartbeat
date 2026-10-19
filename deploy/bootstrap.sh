#!/bin/bash
# 新机器一键重建（知微之家，2026-10-19 实演练通过）
#
# 用法：在一台全新的 Ubuntu 上，以 root 执行
#   bash bootstrap.sh <备份目录或 tar.gz> <域名>
# 例：bash bootstrap.sh /root/backup-20261019.tar.gz zhiweilove.me
#
# 已验证的坑（2026-10-19 踩过两次）：
#   1) 启动容器时**不要**自己写 command，必须用镜像默认入口，否则容器以 126 退出；
#   2) 微信四项凭据必须通过容器环境变量（--env-file / compose env_file）传入，
#      只写 $HERMES_HOME/.env 不会启动 wecom 适配器；
#   3) docker compose up 不能接管手工 docker run 出来的同名容器，必须先 stop+rm。
set -euo pipefail

BACKUP=${1:?请给出备份目录或 tar.gz}
DOMAIN=${2:-zhiweilove.me}

echo "== 1/8 基础依赖 =="
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 caddy python3 python3-pip curl rsync
systemctl enable --now docker caddy

echo "== 2/8 目录 =="
mkdir -p /opt/hermes-data /opt/ziwei-web-data /opt/ziwei-tools /opt/backups /opt/push

echo "== 3/8 取代码并构建镜像 =="
rm -rf /tmp/rebuild && mkdir -p /tmp/rebuild && cd /tmp/rebuild
curl -sL -o repo.tgz "https://codeload.github.com/junjiexiang0126/dylan-heartbeat/tar.gz/refs/heads/main"
tar xzf repo.tgz && cd dylan-heartbeat-main
docker build -t ziwei-hermes:local hermes_native
docker build -t ziwei-web:integration ziwei_web
echo "  镜像构建完成（约 6G 磁盘）"

echo "== 4/8 还原数据 =="
if [ -d "$BACKUP" ]; then
  cp -a "$BACKUP"/state.db /opt/hermes-data/ 2>/dev/null || true
  cp -a "$BACKUP"/meta/. /opt/hermes-data/ 2>/dev/null || true
  cp -a "$BACKUP"/chat.sqlite "$BACKUP"/moments.sqlite "$BACKUP"/work.sqlite /opt/ziwei-web-data/ 2>/dev/null || true
  cp -a "$BACKUP"/host/. /root/host-restore/ 2>/dev/null || true
else
  tar xzf "$BACKUP" -C /root/ && cp -a /root/20*/. /root/host-restore/ 2>/dev/null || true
fi
mkdir -p /opt/hermes-data/workspace
echo "  数据已就位（若备份里含 workspace 请自行 rsync 过去）"

echo "== 5/8 恢复宿主配置 =="
[ -f /root/host-restore/Caddyfile ] && cp /root/host-restore/Caddyfile /etc/caddy/Caddyfile
[ -d /root/host-restore/ziwei-tools ] && cp -a /root/host-restore/ziwei-tools/. /opt/ziwei-tools/ && chmod 700 /opt/ziwei-tools/*.sh /opt/ziwei-tools/*.py
for unit in /root/host-restore/ziwei-*.service /root/host-restore/ziwei-*.timer; do
  [ -f "$unit" ] && cp "$unit" /etc/systemd/system/
done
systemctl daemon-reload
[ -f /root/host-restore/crontab.txt ] && crontab /root/host-restore/crontab.txt

echo "== 6/8 恢复推送身份 =="
mkdir -p /opt/push
[ -f /root/host-restore/push-vapid.json ] && cp /root/host-restore/push-vapid.json /opt/push/vapid.json && chmod 600 /opt/push/vapid.json
[ -f /root/host-restore/push-token ] && cp /root/host-restore/push-token /opt/push/token && chmod 600 /opt/push/token
[ -f /root/host-restore/push-subs.sqlite ] && cp /root/host-restore/push-subs.sqlite /opt/push/subs.sqlite
echo "  推送密钥已恢复（缺了要重新订阅手机）"

echo "== 7/8 起服务（用镜像默认入口，别写 command）=="
cd /tmp/rebuild/dylan-heartbeat-main
docker rm -f ziwei-hermes ziwei-web >/dev/null 2>&1 || true
docker run -d --name ziwei-hermes --restart unless-stopped \
  -p 127.0.0.1:8642:8642 \
  -v /opt/hermes-data:/opt/data -v /opt/ziwei-runtime:/opt/ziwei-runtime \
  --env-file /opt/ziwei-hermes.env ziwei-hermes:local
docker run -d --name ziwei-web --restart unless-stopped \
  -p 127.0.0.1:3001:3000 \
  -v /opt/ziwei-web-data:/webdata \
  --env-file /opt/ziwei-web.env ziwei-web:integration
systemctl reload caddy || systemctl restart caddy

echo "== 8/8 验收 =="
sleep 30
/opt/ziwei-tools/verify.sh || echo "  ⚠ 验收未全绿，逐项看上面输出"
echo
echo "完成后手工确认："
echo "  1) https://$DOMAIN 能打开并登录"
echo "  2) 微信发一句能收到回复（wecom 由环境变量启动）"
echo "  3) 手机推送仍能收到（订阅记录随 push-subs.sqlite 恢复）"
