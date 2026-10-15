"""Seed a new profile without overwriting it, then execute official Hermes.

No agent loop, proxy, memory store, scheduler or billing implementation lives here.
"""
import datetime
import hashlib
import os
from pathlib import Path

SHIPPED_AUTONOMY_GATE = {
    # Every reviewed copy this project has shipped. A persisted script whose
    # content is NOT in this set was edited by hand: leave it alone and say so,
    # rather than silently replacing an operator's file.
    "de3d8c5a784f2bf1bae8880e9991e99d49f4e4bbeb5145cfb1cfd4f551c6f6f1",  # 2026-10-10 reviewed
    "2cba28d19ce9b47bd1e6420112f9dff2c3cd5b211410b637e5252a7b312d96c9",  # 2026-10-15 idle action menu
}


def refresh_reviewed_script(script: Path, template: Path, home: Path) -> str:
    """Bring a reviewed Cron script up to the image's copy, but only when safe.

    The gate must never update silently: keep a byte-identical backup first, skip
    anything an operator edited by hand, and write down what happened. Never
    raises — a failed refresh must not stop the container from booting.
    """
    try:
        current = script.read_bytes()
        wanted = template.read_bytes()
    except OSError as exc:
        return f"unreadable ({exc.__class__.__name__})"
    if current == wanted:
        return "already current"
    if hashlib.sha256(current).hexdigest() not in SHIPPED_AUTONOMY_GATE:
        return "kept: hash is not a reviewed copy (hand-edited?)"
    backup_dir = home / "workspace" / "backups"
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"{script.stem}-before-refresh-{stamp}.py"
    tmp = script.with_name("." + script.name + ".new")
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup.write_bytes(current)
        tmp.write_bytes(wanted)
        os.chmod(tmp, 0o444)
        os.replace(tmp, script)
    except OSError as exc:
        try:
            tmp.unlink()
        except OSError:
            pass
        return f"kept: refresh failed ({exc.__class__.__name__})"
    return f"refreshed; previous copy saved as {backup.name}"


def note_refresh(home: Path, name: str, outcome: str) -> None:
    """Best-effort audit line; losing the sink must never break the boot."""
    try:
        log = home / "logs" / "autonomy_gate_refresh.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as stream:
            stream.write(f"{datetime.datetime.now().astimezone().isoformat(timespec='seconds')} {name}: {outcome}\n")
    except OSError:
        pass
    print(f"[seed] {name}: {outcome}", flush=True)


def seed(home: Path, template: Path) -> None:
    home.mkdir(parents=True, exist_ok=True)
    for name in ("workspace", "history_archive", "migration_manifests"):
        (home / name).mkdir(exist_ok=True)
    destination = home / "config.yaml"
    try:
        with destination.open("x", encoding="utf-8") as target:
            target.write(template.read_text(encoding="utf-8"))
    except FileExistsError:
        pass
    # Official Cron accepts scripts only below HERMES_HOME/scripts. Keep the
    # running profile's reviewed copy across builds; seed only when absent.
    script_dir = home / "scripts"
    if script_dir.is_symlink():
        raise RuntimeError("Refusing symlinked Cron script directory.")
    script_dir.mkdir(exist_ok=True)
    script = script_dir / "autonomy_gate.py"
    if script.is_symlink():
        raise RuntimeError("Refusing symlinked Cron preflight script.")
    try:
        with script.open("x", encoding="utf-8") as target:
            target.write(template.with_name("autonomy_gate.py").read_text(encoding="utf-8"))
    except FileExistsError:
        if not script.is_file():
            raise RuntimeError("Cron preflight is not a regular file.")
        # A newer image must be able to update this gate without an operator
        # running commands as root; reviewed copies only, backup first.
        note_refresh(home, script.name,
                     refresh_reviewed_script(script, template.with_name("autonomy_gate.py"), home))

    skill = home / "skills" / "ziwei-self-update"
    if skill.is_symlink():
        raise RuntimeError("Refusing symlinked self-update skill.")
    skill.mkdir(parents=True, exist_ok=True)
    destination = skill / "SKILL.md"
    if destination.is_symlink():
        raise RuntimeError("Refusing symlinked self-update instruction.")
    try:
        with destination.open("x", encoding="utf-8") as target:
            target.write(template.with_name("self-update-skill.md").read_text(encoding="utf-8"))
    except FileExistsError:
        pass


def check_native() -> None:
    from gateway.config import load_gateway_config, Platform
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from tools.write_approval import write_approval_enabled
    configuration = load_gateway_config()
    api = configuration.platforms[Platform.API_SERVER]
    if not api.enabled or api.extra.get("tool_progress_events") is not False:
        raise RuntimeError("Native API configuration is invalid; review the persistent config.")
    # Skills and ordinary memory changes are authorized by the operator. Core
    # application patches use the independent tested promotion controller.
    from hermes_cli.config import load_config
    config = load_config()
    if not write_approval_enabled("memory"):
        if not config.get("security", {}).get("protected_instruction_files", True):
            raise RuntimeError("Autonomous memory requires protected instruction files.")
        # Hermes exempts its own profile from the project-instruction gate;
        # the actual core boundary is the native file-tool safe-root filter.
        expected = (Path(os.environ["HERMES_HOME"]) / "workspace").resolve()
        roots = [Path(p).resolve() for p in os.environ.get("HERMES_WRITE_SAFE_ROOT", "").split(os.pathsep) if p]
        if roots != [expected]:
            raise RuntimeError("Autonomous memory requires workspace-only file writes.")
    provider = resolve_runtime_provider(requested="ziwei-deepseek")
    if provider.get("base_url", "").rstrip("/") != "https://api.deepseek.com/v1":
        raise RuntimeError("DeepSeek provider is not configured for the official endpoint.")
    if not provider.get("api_key"):
        raise RuntimeError("DeepSeek credential is missing.")


if __name__ == "__main__":
    if not os.environ.get("DEEPSEEK_API_KEY"):
        raise SystemExit("DEEPSEEK_API_KEY must be supplied by the hosting secret store.")
    if len(os.environ.get("API_SERVER_KEY", "")) < 32:
        raise SystemExit("Supply a distinct random API_SERVER_KEY of at least 32 characters.")
    seed(Path(os.environ.get("HERMES_HOME", "/opt/data")), Path(__file__).with_name("config.yaml"))
    check_native()
    # Reuse Hermes's own singleton s6 slot, including persistent boot intent.
    # Keep the container main alive independently of Gateway restarts.
    from hermes_cli.service_manager import S6ServiceManager
    manager = S6ServiceManager()
    if not Path("/run/service/gateway-default").exists():
        manager.register_profile_gateway("default", start_now=True)
    else:
        manager.start("gateway-default")
    os.execvp("sleep", ["sleep", "infinity"])
