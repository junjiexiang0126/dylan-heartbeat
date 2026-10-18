#!/usr/bin/env bash
# 新机恢复：把搬家包铺回数据卷，起服务，然后交给 verify.sh 验收。
# 用法: bash deploy/restore.sh /path/to/out [--force]
set -euo pipefail

SRC="${1:?用法: restore.sh <备份目录> [--force]}"
FORCE="${2:-}"
HERMES_DATA="${HERMES_DATA:-/opt/hermes-data}"
WEB_DATA="${WEB_DATA:-/opt/ziwei-web-data}"

if [ -z "$FORCE" ]; then
  for d in "$HERMES_DATA" "$WEB_DATA"; do
    if [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
      echo "目标非空：$d —— 为防止覆盖，已停止。确认要覆盖请加 --force" >&2
      exit 3
    fi
  done
fi

NATIVE_TGZ="$(ls -1t "$SRC"/native-*.tar.gz 2>/dev/null | head -1)"
[ -n "$NATIVE_TGZ" ] || { echo "找不到 native-*.tar.gz" >&2; exit 4; }
WEB_TGZ="$(ls -1t "$SRC"/web-*.tar.gz 2>/dev/null | head -1 || true)"
MANIFEST="$(ls -1t "$SRC"/MANIFEST-*.txt 2>/dev/null | head -1 || true)"

echo "== 1/4 校验包完整性 =="
if [ -n "$MANIFEST" ]; then
  for f in "$NATIVE_TGZ" ${WEB_TGZ:-}; do
    want="$(grep " $(basename "$f") " "$MANIFEST" | awk '{print $1}')"
    got="$(sha256sum "$f" | cut -d' ' -f1)"
    [ "$want" = "$got" ] || { echo "校验失败：$(basename "$f")" >&2; exit 5; }
    echo "  ok $(basename "$f")"
  done
fi

echo "== 2/4 铺原生数据 =="
mkdir -p "$HERMES_DATA"
TMP="$(mktemp -d)"
tar xzf "$NATIVE_TGZ" -C "$TMP"
cp -a "$TMP/native/." "$HERMES_DATA/"
rm -rf "$TMP"

echo "== 3/4 铺网页数据 =="
if [ -n "$WEB_TGZ" ]; then
  mkdir -p "$WEB_DATA"
  TMP="$(mktemp -d)"
  tar xzf "$WEB_TGZ" -C "$TMP"
  cp -a "$TMP/web/." "$WEB_DATA/"
  rm -rf "$TMP"
fi

echo "== 4/4 起服务 =="
docker compose -f deploy/docker-compose.yml up -d --build
sleep 20
docker compose -f deploy/docker-compose.yml ps

echo
echo "数据已铺好。下面跑验收（身份 / 记忆 / 聊天库 / 通道 / 网页）："
bash deploy/verify.sh "$SRC"
