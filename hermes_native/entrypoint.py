"""Validate the profile location before the official first-boot setup touches it."""
import os
from pathlib import Path

home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
if str(home) not in ("/opt/data", "/data/hermes_native") or home.is_symlink():
    raise SystemExit("Unsupported or symlinked profile path; refusing initialization.")
marker = home / ".ziwei-native-profile"
if home.exists() and any(home.iterdir()) and not marker.is_file():
    raise SystemExit("Unrecognized nonempty profile directory; refusing to overwrite it.")
home.mkdir(parents=True, exist_ok=True)
if not marker.exists():
    with marker.open("x") as stream:
        stream.write("ziwei-native-v1\n")
# Keep PID 1 and hand all setup/supervision to the official entrypoint.
os.execv("/opt/hermes/docker/entrypoint-dispatch.sh",
         ["/opt/hermes/docker/entrypoint-dispatch.sh", *os.sys.argv[1:]])
