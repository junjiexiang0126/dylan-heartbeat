#!/usr/bin/env bash
# Host-only snapshot; schedule separately. This script does not install cron.
set -euo pipefail
umask 077
export TZ="${TZ:-Asia/Bangkok}"
exec python3 "$(dirname "$0")/snapshot.py" create --kind daily "$@"
