"""Background review deduplication — V1 (feature/bg-review-dedup-v1).

Goal: cut redundant background_review forks without touching review
capability itself. A fork is skipped only when the review targets are
byte-identical to what the last completed review already saw, and no
forced periodic review is due. Explicit (/refine) reviews always run.

Mechanics (see hermes_native/patches/README.md):
- Fingerprint: sha256 over memories/MEMORY.md + memories/USER.md + the
  skills tree (relative path, mtime_ns, size). Pure file reads, no model
  calls; only hashes ever leave this module.
- The fingerprint is re-sampled AFTER a review completes, so a review's
  own memory edits do not re-trigger the next review (self-edit loop).
- Forced floor: after dedup_force_interval_seconds (default 6h) without
  a real review, the next trigger runs even with an unchanged
  fingerprint — "no file changes" alone never starves periodic checks.
- In-flight: one fork per fingerprint process-wide; a second trigger for
  the same fingerprint while under review is skipped, not queued.
  Entries older than 30 minutes are purged as stale (leaked by a fork
  that never started, e.g. a dropped idle-queue deferral).
- Failures: an errored review does not count as done; the next trigger
  retries, bounded to MAX_CONSECUTIVE_FAILURES consecutive failures per
  fingerprint. Every failure is recorded.
- V1 does NOT cap review API calls: a completed review with more than
  WARN_API_CALLS calls logs a warning and is recorded; nothing is
  interrupted.
- Every decision and completion is appended to
  <hermes-home>/bg_review_dedup_log.jsonl: trigger reason, skip reason,
  api calls, tokens, result. No chat content is ever logged.

Config (auxiliary.background_review, all optional):
  dedup_enabled: true            # set false to bypass dedup entirely
  dedup_force_interval_seconds: 21600
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("ziwei.bg_review_dedup")

WARN_API_CALLS = 6
MAX_CONSECUTIVE_FAILURES = 3
DEFAULT_FORCE_INTERVAL_SECONDS = 6 * 3600
IN_FLIGHT_TIMEOUT_SECONDS = 30 * 60
LOG_NAME = "bg_review_dedup_log.jsonl"
LOG_ROTATE_BYTES = 5 * 1024 * 1024

_fp_local = threading.local()


def _home() -> Path:
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home())


def _fingerprint(agent: Any = None) -> str:
    """Fingerprint of the review targets. File reads only; never raises."""
    h = hashlib.sha256()
    root = _home()
    for rel in ("memories/MEMORY.md", "memories/USER.md"):
        h.update(rel.encode("utf-8"))
        try:
            h.update((root / rel).read_bytes())
        except OSError:
            h.update(b"\x00missing")
    skills = root / "skills"
    if skills.is_dir():
        for path in sorted(skills.rglob("*.md")):
            try:
                st = path.stat()
            except OSError:
                continue
            h.update(str(path.relative_to(skills)).encode("utf-8"))
            h.update(str(st.st_mtime_ns).encode("utf-8"))
            h.update(str(st.st_size).encode("utf-8"))
    return h.hexdigest()


def _record(event: Dict[str, Any]) -> None:
    """Append one JSONL line under the hermes home. Best effort."""
    try:
        path = _home() / LOG_NAME
        try:
            if path.exists() and path.stat().st_size > LOG_ROTATE_BYTES:
                path.replace(path.with_name(LOG_NAME + ".1"))
        except OSError:
            pass
        line = json.dumps({"ts": round(time.time(), 3), **event},
                          ensure_ascii=False, default=str)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        logger.debug("bg_review_dedup: log append failed", exc_info=True)


def _load_task_cfg(br_module: Any) -> Dict[str, Any]:
    try:
        _enabled, cfg = br_module.load_background_review_settings()
        return cfg or {}
    except Exception:
        return {}


def _dedup_enabled(task_cfg: Optional[Dict[str, Any]]) -> bool:
    """Local truthy check: no Hermes utils import, so tests and the
    module behave identically everywhere. Unset means enabled."""
    value = (task_cfg or {}).get("dedup_enabled")
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() not in ("", "0", "false", "no", "off")
    return bool(value)


def _force_interval(task_cfg: Optional[Dict[str, Any]]) -> int:
    try:
        return int((task_cfg or {}).get("dedup_force_interval_seconds")
                   or DEFAULT_FORCE_INTERVAL_SECONDS)
    except (TypeError, ValueError):
        return DEFAULT_FORCE_INTERVAL_SECONDS


class _DedupState:
    """Process-wide dedup state. Every method is lock-protected."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.last_fingerprint: Optional[str] = None
        self.last_run_at: float = 0.0
        self.in_flight: Dict[str, float] = {}
        self.consecutive_failures: int = 0

    def acquire(self, fingerprint: str, explicit: bool, now: float,
                force_interval: int) -> Tuple[bool, str]:
        """Decide whether this trigger runs; reserve the fingerprint when it does."""
        with self.lock:
            for fp, stamp in list(self.in_flight.items()):
                if now - stamp > IN_FLIGHT_TIMEOUT_SECONDS:
                    del self.in_flight[fp]
            if explicit:
                self.in_flight[fingerprint] = now
                return True, "explicit"
            if fingerprint in self.in_flight:
                return False, "already_in_flight"
            if self.last_run_at <= 0:
                self.in_flight[fingerprint] = now
                return True, "first_review"
            if now - self.last_run_at >= force_interval:
                self.in_flight[fingerprint] = now
                return True, "force_interval"
            if fingerprint != self.last_fingerprint:
                self.in_flight[fingerprint] = now
                return True, "fingerprint_changed"
            if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                return False, "failure_retry_exhausted"
            if self.consecutive_failures > 0:
                self.in_flight[fingerprint] = now
                return True, "retry_after_failure"
            return False, "unchanged_fingerprint"

    def finish(self, fingerprint: str, post_fingerprint: Optional[str], result: str) -> None:
        with self.lock:
            self.in_flight.pop(fingerprint, None)
            self.last_run_at = time.time()
            if result in ("error", "error_no_usage"):
                # A failed review does not count as done: remember the fingerprint
                # that failed so the next trigger takes the bounded retry path.
                self.consecutive_failures += 1
                self.last_fingerprint = fingerprint
            else:
                self.consecutive_failures = 0
                # Re-sampled post-review: the review's own edits must not retrigger.
                self.last_fingerprint = post_fingerprint or fingerprint


def _complete(state: _DedupState, fingerprint: str) -> None:
    """Runs in the review thread's finally: record usage, warn over budget, settle state."""
    usage = getattr(_fp_local, "usage", None)
    result = getattr(_fp_local, "result", None)
    if usage is None:
        result = "error_no_usage"
    calls = int((usage or {}).get("api_calls") or 0)
    if calls > WARN_API_CALLS:
        # V1: record and warn only — never interrupt a running review.
        logger.warning(
            "Background review used %d API calls (> %d). V1 records only; no cap applied.",
            calls, WARN_API_CALLS,
        )
    try:
        post_fingerprint = _fingerprint()
    except Exception:
        post_fingerprint = None
    state.finish(fingerprint, post_fingerprint, result or "error_no_usage")
    _record({
        "event": "complete", "fingerprint": fingerprint,
        "post_fingerprint": post_fingerprint,
        "result": result or "error_no_usage", "api_calls": calls,
        "input_tokens": int((usage or {}).get("input_tokens") or 0),
        "output_tokens": int((usage or {}).get("output_tokens") or 0),
        "cache_read_tokens": int((usage or {}).get("cache_read_tokens") or 0),
    })


def install() -> bool:
    """Wire dedup onto the real Hermes agent class. Called from web_bridge.install()."""
    try:
        from run_agent import AIAgent
        import agent.background_review as br
    except Exception:
        logger.warning("bg_review_dedup: Hermes modules unavailable; not installed", exc_info=True)
        return False
    return install_on_class(AIAgent, br)


def install_on_class(cls: Any, br_module: Any) -> bool:
    """Wire dedup onto an agent class and a background_review module.

    Split out from install() so tests can wire fakes without Hermes.
    """
    if getattr(cls, "_ziwei_bg_dedup_installed", False):
        return True
    state = _DedupState()
    original_spawn = cls._spawn_background_review
    original_spawn_thread = br_module.spawn_background_review_thread
    original_log_completion = br_module._log_review_completion

    def _spawn(self, messages_snapshot, review_memory=False, review_skills=False,
               focus=None, task_cfg=None, explicit=False, *args, **kwargs):
        try:
            if task_cfg is None:
                task_cfg = _load_task_cfg(br_module)
            if not _dedup_enabled(task_cfg):
                _record({"event": "trigger", "session": getattr(self, "session_id", "?"),
                         "decision": "run", "reason": "dedup_disabled"})
                return original_spawn(self, messages_snapshot, *args, task_cfg=task_cfg, **kwargs)
            fingerprint = _fingerprint(self)
            run, reason = state.acquire(
                fingerprint, bool(explicit or (focus or "").strip()), time.time(),
                _force_interval(task_cfg))
            _record({"event": "trigger", "session": getattr(self, "session_id", "?"),
                     "fingerprint": fingerprint,
                     "decision": "run" if run else "skip", "reason": reason})
            if not run:
                return None
            # Stash for the thread wrapper: the deferred (idle-queue) path spawns
            # later and must settle the SAME fingerprint that was approved here.
            self._ziwei_bg_dedup_fp = fingerprint
            return original_spawn(self, messages_snapshot, *args,
                                  review_memory=review_memory, review_skills=review_skills,
                                  focus=focus, task_cfg=task_cfg, explicit=explicit, **kwargs)
        except Exception:
            # Fail-open: a broken dedup must never block a review.
            logger.warning("bg_review_dedup: trigger wrapper failed; running review unchanged",
                            exc_info=True)
            return original_spawn(self, messages_snapshot, *args, **kwargs)

    def _spawn_thread(agent, messages_snapshot, **kwargs):
        target, prompt = original_spawn_thread(agent, messages_snapshot, **kwargs)
        fingerprint = getattr(agent, "_ziwei_bg_dedup_fp", None) or _fingerprint(agent)

        def _tracked_target():
            _fp_local.usage = None
            _fp_local.result = None
            try:
                target()
            finally:
                _complete(state, fingerprint)

        return _tracked_target, prompt

    def _log_completion(usage, result):
        try:
            _fp_local.usage = dict(usage or {})
            _fp_local.result = result
        except Exception:
            pass
        return original_log_completion(usage, result)

    cls._spawn_background_review = _spawn
    br_module.spawn_background_review_thread = _spawn_thread
    br_module._log_review_completion = _log_completion
    cls._ziwei_bg_dedup_installed = True
    cls._ziwei_bg_dedup_state = state
    return True
