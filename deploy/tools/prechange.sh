#!/usr/bin/env bash
# Pre-change snapshots are never removed by the daily retention policy.
set -euo pipefail
umask 077
export TZ="${TZ:-Asia/Bangkok}"
label="${1:-manual}"
if [ "$#" -gt 0 ]; then shift; fi
exec python3 "$(dirname "$0")/snapshot.py" create --kind prechange --label "$label" "$@"
