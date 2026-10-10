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
    invalid_completions = []
    for task in tasks:
        if task["status"] != "completed":
            continue
        paths = task.get("evidence", [])
        valid = bool(paths) and isinstance(paths, list)
        for item in paths if isinstance(paths, list) else []:
            p = (workspace / str(item)).resolve()
            valid = valid and p.is_relative_to(workspace.resolve()) and p.is_file() and p.stat().st_size > 0
        if not valid:
            invalid_completions.append(task.get("id"))
    if invalid_completions:
        # The gate lock is not shared by native file/kanban tools. Rewriting
        # tasks.json here can silently discard a concurrent Agent update.
        # Pause instead; retain the original task document for reconciliation.
        return {"wakeAgent": False,
                "reason": "completed task lacks scoped nonempty file evidence; operator review needed",
                "invalid_completions": invalid_completions}
    date = now.date().isoformat()
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get("date") != date:
        state = {"date": date, "wakes": 0}
    if int(state.get("wakes", 0)) >= 6:
        return {"wakeAgent": False, "reason": "six daily opportunities used"}
    active = [t for t in tasks if t["status"] in ACTIVE]
    diary = workspace / "diary" / (date + ".md")
    diary_due = not (diary.is_file() and not diary.is_symlink() and diary.stat().st_size > 0)
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
    home = None
    try:
        home = Path(os.environ["HERMES_HOME"])
        with (home / ".autonomy-gate.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = evaluate(home, datetime.now().astimezone())
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        # Hermes treats a nonzero script exit as prompt context and may still
        # invoke the model. Always return a successful wakeAgent=false gate.
        result = {"wakeAgent": False, "reason": "preflight invalid; operator review needed", "error_type": type(exc).__name__}
    try:
        with (home / "logs" / "autonomy_preflight.jsonl").open("a") as log:
            log.write(json.dumps(result, ensure_ascii=False) + "\n")
    except (OSError, TypeError):
        pass  # Losing an audit sink must not turn the gate into a paid run.
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
