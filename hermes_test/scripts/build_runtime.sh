#!/usr/bin/env bash
set -euo pipefail
cd /opt/hermes
python - <<'PY'
import hashlib,pathlib
expected={'pyproject.toml':'cadde2f6a92574d292103f43abf66408b1d841cd9ea332ca7f3e3dfc5dcc87fd','uv.lock':'2bc4db483e9cba927cd7147f9ccbb09635f85bb3f1f36d6e9d51d06b65d1c67e'}
for name,digest in expected.items():
    if hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()!=digest: raise SystemExit('Dependency hash mismatch: '+name)
PY
# Official PM environment builder, frozen lock, only MCP extra.
# Media, browser and computer-control executables are not needed by this restricted worker.
python -m pm.build_env --source /opt/hermes --out /opt/hermes-env --python "$(command -v python)" --extra mcp --no-install-project
