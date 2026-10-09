"""Cheap preflight for the official Hermes Cron script/wakeAgent interface.

No model, scheduler, agent loop or second memory store. Fail closed, limit wake
opportunities, and inspect file evidence before accepting a task's completion.
"""
import fcntl
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

ACTIVE = {"pending", "in_progress"}
STATES = ACTIVE | {"completed", "failed", "waiting_user", "deferred"}


def evaluate(home: Path, now: datetime) -> dict:
    workspace = home / "workspace"
    state_path = home / "autonomy_gate_state.json"
    tasks_path = workspace / "tasks.json"
    jobs_path = home / "cron" / "jobs.json"
    # Bad/missing task documents fail closed instead of triggering paid repairs.
    tasks = json.loads(tasks_path.read_text())
    if not isinstance(tasks, list) or any(t.get("status") not in STATES for t in tasks):
        raise ValueError("Invalid task state document")
    if jobs_path.exists():
        jobs = json.loads(jobs_path.read_text())
        if isinstance(jobs, dict):
            jobs = jobs.get("jobs", [])
        if any(j.get("name", "").startswith("ziwei-") and int(j.get("failure_streak") or 0) >= 3 for j in jobs):
            return {"wakeAgent": False, "reason": "three consecutive failures; operator review needed"}
    changed = False
    for task in tasks:
        if task["status"] != "completed":
            continue
        paths = task.get("evidence", [])
        valid = bool(paths) and isinstance(paths, list)
        for item in paths if isinstance(paths, list) else []:
            p = (workspace / str(item)).resolve()
            valid = valid and p.is_relative_to(workspace.resolve()) and p.is_file() and p.stat().st_size > 0
        if not valid:
            task["status"] = "failed"
            task["verification"] = "claimed completion has no nonempty workspace file evidence"
            changed = True
    if changed:
        atomic_json(tasks_path, tasks)
    date = now.date().isoformat()
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get("date") != date:
        state = {"date": date, "wakes": 0}
    if int(state.get("wakes", 0)) >= 6:
        return {"wakeAgent": False, "reason": "six daily opportunities used"}
    active = [t for t in tasks if t["status"] in ACTIVE]
    diary_due = not (workspace / "diary" / (date + ".md")).exists()
    if not active and not diary_due:
        return {"wakeAgent": False, "reason": "idle; no active task and diary already present"}
    state["wakes"] += 1
    state["last_opportunity"] = now.isoformat()
    atomic_json(state_path, state)
    return {"wakeAgent": True, "time": now.isoformat(), "tasks": active,
            "diary_due": diary_due, "opportunity": state["wakes"],
            "note": "File presence is evidence of a saved artifact, not proof of external success."}


def atomic_json(path: Path, data):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".ziwei-")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    home = Path(os.environ["HERMES_HOME"])
    with (home / ".autonomy-gate.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            result = evaluate(home, datetime.now().astimezone())
        except (OSError, ValueError, TypeError, KeyError) as exc:
            result = {"wakeAgent": False, "reason": "preflight invalid; operator review needed", "error_type": type(exc).__name__}
        with (home / "logs" / "autonomy_preflight.jsonl").open("a") as log:
            log.write(json.dumps(result, ensure_ascii=False) + "\n")
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
