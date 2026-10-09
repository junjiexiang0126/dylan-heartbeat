"""Seed a new profile without overwriting it, then execute official Hermes.

No agent loop, proxy, memory store, scheduler or billing implementation lives here.
"""
import os
from pathlib import Path


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


def check_native() -> None:
    from gateway.config import load_gateway_config, Platform
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from tools.write_approval import write_approval_enabled
    configuration = load_gateway_config()
    api = configuration.platforms[Platform.API_SERVER]
    if not api.enabled or api.extra.get("tool_progress_events") is not False:
        raise RuntimeError("Native API configuration is invalid; review the persistent config.")
    if not all(write_approval_enabled(s) for s in ("memory", "skills")):
        raise RuntimeError("Native write approval is unavailable or disabled; refusing startup.")
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
    os.execvp("hermes", ["hermes", "gateway", "run"])
