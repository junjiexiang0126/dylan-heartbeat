"""Validate the profile location before the official first-boot setup touches it."""
import os
import pwd
from pathlib import Path
home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
if str(home) not in ("/opt/data", "/data/hermes_native") or home.is_symlink():
    raise SystemExit("Unsupported or symlinked profile path; refusing initialization.")
marker = home / ".ziwei-native-profile"
if home.exists() and any(home.iterdir()) and not marker.is_file():
    # Adopt only our own failed pre-entrypoint initialization. Never overwrite
    # its config or accept unrelated profiles/archives.
    config_path = home / "config.yaml"
    if config_path.is_symlink() or not config_path.is_file():
        raise SystemExit("Unrecognized nonempty profile directory; refusing initialization.")
    # Before the official setup activates its dependency environment, use only
    # the standard library. Matching the exact seed is deliberately strict.
    existing = config_path.read_bytes()
    expected = Path(__file__).with_name("config.yaml").read_bytes()
    if existing != expected:
        raise SystemExit("Existing profile does not match this deployment; refusing initialization.")
    archive = home / "history_archive"
    if archive.exists() and (archive.is_symlink() or any(archive.iterdir())):
        raise SystemExit("Unmarked profile contains archived history; manual review required.")
    print("[ziwei] Recognized incomplete native initialization; preserving all existing files.")
home.mkdir(parents=True, exist_ok=True)
if not marker.exists():
    with marker.open("x") as stream:
        stream.write("ziwei-native-v1\n")
# The official setup repairs its canonical directories. Its config backup
# folder also needs repair after the previous entrypoint-bypassing startup.
backups = home / "backups"
if backups.exists():
    paths = [backups, *backups.rglob("*")]
    if any(path.is_symlink() for path in paths):
        raise SystemExit("Refusing permission repair through a backup symlink.")
    user = pwd.getpwnam("hermes")
    for path in paths:
        os.chown(path, user.pw_uid, user.pw_gid)
# Keep PID 1 and hand all setup/supervision to the official entrypoint.
os.execv("/opt/hermes/docker/entrypoint-dispatch.sh",
         ["/opt/hermes/docker/entrypoint-dispatch.sh", *os.sys.argv[1:]])
