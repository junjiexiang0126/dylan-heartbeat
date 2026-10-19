#!/usr/bin/env bash
set -euo pipefail
exec "${HERMES_PYTHON:-/opt/hermes-env/bin/python}" -m ziwei.server
