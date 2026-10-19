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
# Native kanban also uses waiting_front for work blocked on the Web frontend.
# Recognize it as a waiting state, without treating it as runnable work.
STATES = ACTIVE | {"completed", "failed", "waiting_user", "waiting_front", "deferred"}


def _daily_opportunities():
    """每天允许的自主唤醒次数：读 $HERMES_HOME/autonomy_gate.json，默认 15。"""
    path = os.path.join(os.environ.get("HERMES_HOME", "/opt/data"), "autonomy_gate.json")
    try:
        with open(path, encoding="utf-8") as fh:
            value = int(json.load(fh).get("daily_opportunities", 15))
        return max(1, min(48, value))
    except Exception:
        return 15



def evaluate(home: Path, now: datetime) -> dict:
    workspace = home / "workspace"
    state_path = home / "autonomy_gate_state.json"
    tasks_path = workspace / "tasks.json"
    jobs_path = home / "cron" / "jobs.json"
    # Bad/missing task documents fail closed instead of triggering paid repairs.
    tasks = json.loads(tasks_path.read_text())
    if not isinstance(tasks, list) or any(not isinstance(t, dict) or t.get("status") not in STATES for t in tasks):
        raise ValueError("Invalid task state document")
    if jobs_path.exists():
        jobs = json.loads(jobs_path.read_text())
        if isinstance(jobs, dict):
            jobs = jobs.get("jobs", [])
        if any(j.get("name", "").startswith("ziwei-") and int(j.get("failure_streak") or 0) >= 3 for j in jobs):
            return {"wakeAgent": False, "reason": "three consecutive failures; operator review needed"}
    invalid_completions = []
    waived_evidence = []
    for task in tasks:
        if task["status"] != "completed":
            continue
        # 历史遗留：这条规则生效前完成的、没留存产物。显式豁免并记进日志，
        # 不伪造证据，也不让一条旧账把整台机器锁死。
        if task.get("evidence_waived"):
            waived_evidence.append(task.get("id"))
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
    if int(state.get("wakes", 0)) >= _daily_opportunities():
        return {"wakeAgent": False, "reason": "daily opportunities used"}
    active = [t for t in tasks if t["status"] in ACTIVE]
    diary = workspace / "diary" / (date + ".md")
    diary_due = not (diary.is_file() and not diary.is_symlink() and diary.stat().st_size > 0)
    # An idle opportunity is still an opportunity: the agent chooses among the
    # actions below instead of the gate deciding that nothing may happen. The
    # daily opportunities, the failure pause, the evidence checks and the
    # lock all still apply, and the counter is never reset here.
    idle = not active and not diary_due
    state["wakes"] += 1
    state["last_opportunity"] = now.isoformat()
    atomic_json(state_path, state)
    return {"wakeAgent": True, "time": now.isoformat(), "tasks": active,
            "waived_evidence": waived_evidence,
            "diary_due": diary_due, "idle": idle, "opportunity": state["wakes"],
            "available_actions": ["contact_user", "rest", "self_directed_task",
                                  "publish_moment", "write_diary"],
            "choice": "chosen for this actual moment; doing nothing is allowed",
            "moment_daily_post_limit": 2,
            "write_long_term_memory": False,
            "diary": "optional short entry; never copy the whole Moments store",
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
    now = datetime.now().astimezone()
    try:
        home = Path(os.environ["HERMES_HOME"])
        with (home / ".autonomy-gate.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = evaluate(home, now)
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        # Hermes treats a nonzero script exit as prompt context and may still
        # invoke the model. Always return a successful wakeAgent=false gate.
        result = {"wakeAgent": False, "reason": "preflight invalid; operator review needed", "error_type": type(exc).__name__}
    # Every refusal needs a timestamp too; do not log exception messages or data.
    result.setdefault("time", now.isoformat())
    try:
        with (home / "logs" / "autonomy_preflight.jsonl").open("a") as log:
            log.write(json.dumps(result, ensure_ascii=False) + "\n")
    except (OSError, TypeError):
        pass  # Losing an audit sink must not turn the gate into a paid run.
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
