#!/usr/bin/env bash
# Read-only host preflight. Never prints environment variable values or credentials.
set -euo pipefail
printf '=== Ziwei isolated voice staging preflight ===\n'
date -Is
uname -sm
printf '\n[capacity]\n'
free -h || true
df -h / /opt 2>/dev/null || df -h /
printf '\n[Docker]\n'
if command -v docker >/dev/null; then
 docker version --format 'Client={{.Client.Version}} Server={{.Server.Version}}' 2>/dev/null || true
 docker compose version 2>/dev/null || true
 docker ps --format 'name={{.Names}} image={{.Image}} status={{.Status}} ports={{.Ports}}' || true
else echo 'docker not installed'; fi
printf '\n[listening TCP/UDP ports; IPs omitted]\n'
if command -v ss >/dev/null; then
 ss -lntH | awk '{print "TCP " $4}' | sed -E 's/^.*:([0-9]+)$/TCP port=\1/' | sort -u
 ss -lnuH | awk '{print "UDP " $4}' | sed -E 's/^.*:([0-9]+)$/UDP port=\1/' | sort -u
fi
printf '\n[tool availability]\n'
for cmd in git curl openssl caddy nginx livekit-server node; do
 if command -v "$cmd" >/dev/null; then echo "$cmd present"; else echo "$cmd absent"; fi
done
printf '\n[DNS / firewall / keys]\n'
echo 'Check DNS, firewall and secret *presence* manually; never print key values or docker inspect Environment.'
echo 'No files, services, containers, firewall or routing changed.'
