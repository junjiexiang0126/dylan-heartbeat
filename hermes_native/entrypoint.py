"""Validate and carefully adopt a Hermes profile before official bootstrap.

Runs as the container's initial privileged process, then delegates to
the official Hermes entrypoint. The Agent does not retain root privileges.
"""
import os
import pwd
import stat
import sys
from pathlib import Path

ALLOWED_HOMES = ("/opt/data", "/data/hermes_native")
MARKER_CONTENT = "ziwei-native-v1\n"


def repair_backup_ownership(home: Path, uid: int, gid: int) -> None:
    """Bind privileged repairs to checked descriptors, never mutable paths."""
    home_fd = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    backups_fd = config_fd = None
    try:
        try:
            backups_fd = os.open("backups", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=home_fd)
        except FileNotFoundError:
            return
        os.fchown(backups_fd, uid, gid)
        try:
            config_fd = os.open("config", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=backups_fd)
        except FileNotFoundError:
            return
        os.fchown(config_fd, uid, gid)
        for name in os.listdir(config_fd):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=config_fd)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise SystemExit("Unexpected config backup entry; refusing repair.")
                os.fchown(fd, uid, gid)
            finally:
                os.close(fd)
    except OSError as exc:
        raise SystemExit("Unsafe or inaccessible backup path; refusing repair.") from exc
    finally:
        for fd in (config_fd, backups_fd, home_fd):
            if fd is not None:
                os.close(fd)


def require_regular_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise SystemExit(f"Unrecognized profile file: {path}")


def validate_profile(home: Path) -> None:
    """Require explicit operator opt-in before adopting an unmarked profile.

    Official Hermes may reformat its live config, so byte-for-byte comparison
    against the original seed template is not a valid compatibility test.
    """
    if os.environ.get("ZIWEI_ADOPT_EXISTING_PROFILE") != "1":
        raise SystemExit(
            "Unmarked existing profile: verify its source, back it up and set "
            "ZIWEI_ADOPT_EXISTING_PROFILE=1 for one controlled deployment."
        )
    config = home / "config.yaml"
    require_regular_file(config)
    body = config.read_text(encoding="utf-8")
    if not all(signature in body for signature in
               ("ziwei-deepseek", "api_server", "DEEPSEEK_API_KEY")):
        raise SystemExit("Existing profile is not a recognized Ziwei Hermes config.")
    archive = home / "history_archive"
    if archive.exists() and archive.is_symlink():
        raise SystemExit("Refusing symlinked history archive.")
    print("[ziwei] Explicitly adopting compatible existing profile; retaining all files.")


def main() -> None:
    home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
    if str(home) not in ALLOWED_HOMES or home.is_symlink():
        raise SystemExit("Unsupported or symlinked profile path.")
    marker = home / ".ziwei-native-profile"
    if marker.exists():
        require_regular_file(marker)
        if marker.read_text(encoding="utf-8") != MARKER_CONTENT:
            raise SystemExit("Unexpected native profile marker; refusing startup.")
    elif home.exists() and any(home.iterdir()):
        validate_profile(home)

    home.mkdir(parents=True, exist_ok=True)
    if not marker.exists():
        with marker.open("x", encoding="utf-8") as stream:
            stream.write(MARKER_CONTENT)

    # Repair only the two known backup directories and existing regular
    # config backup files, never the full volume or archived history.
    user = pwd.getpwnam("hermes")
    repair_backup_ownership(home, user.pw_uid, user.pw_gid)

    if os.environ.get("ZIWEI_RUNTIME_GUARD") == "1":
        from runtime_guard import initialize
        initialize()

    os.execv("/opt/hermes/docker/entrypoint-dispatch.sh",
             ["/opt/hermes/docker/entrypoint-dispatch.sh", *sys.argv[1:]])


if __name__ == "__main__":
    main()
