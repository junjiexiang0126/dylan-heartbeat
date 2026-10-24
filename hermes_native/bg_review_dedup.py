"""Opt-in exact-input background review cache, at Hermes's worker factory.

The idle queue and native run admission are left intact. No reservation exists
until a target actually starts. Only a completed, single-request, tool-free
no-op is reusable: writes, tool reads, failures, cancellation and unknown inputs
always require another review. State is bounded, process-local and cold after
restart. See notes/bg-review-dedup-v1-acceptance.md for the contract and evidence.
"""
from __future__ import annotations

import contextvars
import copy
import functools
import hashlib
import hmac
import inspect
import json
import logging
import math
import os
import threading
import time
import uuid
import weakref
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("ziwei.bg_review_dedup")
WARN_API_CALLS = 6
MAX_CONSECUTIVE_FAILURES = 3
FAILURE_COOLDOWN_SECONDS = 300
DEFAULT_FORCE_INTERVAL_SECONDS = 6 * 3600
IN_FLIGHT_TIMEOUT_SECONDS = 30 * 60
MAX_LANES = 256
MAX_PENDING_EXPLICIT = 32
MAX_INPUT_BYTES = 32 * 1024 * 1024
LOG_NAME = "bg_review_dedup_log.jsonl"
LOG_ROTATE_BYTES = 5 * 1024 * 1024
_HASH_KEY = os.urandom(32)  # prevent dictionary attacks on private input hashes
_log_lock = threading.Lock()
_attempt = contextvars.ContextVar("ziwei_review_attempt", default=None)


def _home() -> Path:
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home())


def _json(value: Any) -> bytes:
    # Never stringify unknown objects: repr can alias inputs or expose secrets.
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _hash(value: bytes) -> str:
    return hmac.new(_HASH_KEY, value, hashlib.sha256).hexdigest()


def _record(event: dict) -> None:
    """Only caller-constructed enum labels, keyed digests and numeric usage."""
    try:
        with _log_lock:
            path = _home() / LOG_NAME
            if path.exists() and path.stat().st_size > LOG_ROTATE_BYTES:
                path.replace(path.with_name(LOG_NAME + ".1"))
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"ts": round(time.time(), 3), **event}) + "\n")
    except Exception:
        # Instrumentation must never affect chat/review execution. No exception
        # text: file paths and serializer errors may contain private input.
        logger.debug("bg_review_dedup: audit append unavailable")


def _dedup_enabled(cfg: dict | None) -> bool:
    value = (cfg or {}).get("dedup_enabled", False)
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return value is True


def _force_interval(cfg: dict | None) -> int:
    try:
        return max(1, int((cfg or {}).get("dedup_force_interval_seconds")
                          or DEFAULT_FORCE_INTERVAL_SECONDS))
    except (TypeError, ValueError, OverflowError):
        return DEFAULT_FORCE_INTERVAL_SECONDS


def _load_task_cfg(br: Any) -> dict:
    return br.load_background_review_settings()[1] or {}


def _fingerprint(agent: Any, messages: list, prompt: str, cfg: dict,
                 review_memory: bool, review_skills: bool) -> tuple[str, str]:
    """Return (profile/session/scope lane, exact input hash), or raise to run.

    Both review kinds include the ENTIRE snapshot (tool calls, arguments and
    results included), both memories, all skill files, cached prefix, tool
    schemas, local configuration and live memory state. No post-edit absorption.
    Routed runtimes and external memory cannot currently prove equivalence.
    """
    root = _home().resolve()
    session = getattr(agent, "session_id", None)
    if not isinstance(session, str) or not session:
        raise ValueError("unbound session")
    if not isinstance(messages, list) or not isinstance(prompt, str):
        raise ValueError("unknown input shape")
    if cfg.get("extra_tools"):
        raise ValueError("external tool dependencies")
    if any(cfg.get(k) not in (None, "", "auto") for k in ("provider", "model")):
        raise ValueError("routed runtime")
    manager = getattr(agent, "_memory_manager", None)
    if manager is not None and getattr(manager, "_has_external", True):
        raise ValueError("external memory")
    prefix = getattr(agent, "_cached_system_prompt", None)
    if not isinstance(prefix, str) or not prefix:
        raise ValueError("unresolved prefix")
    # Same-model replay is byte-stable only for a pinned HTTP runtime. Other
    # backends/plugin routing must use Hermes normally until separately proven.
    runtime = agent._current_main_runtime()
    if runtime.get("credential_pool") or getattr(agent, "_credential_pool", None):
        raise ValueError("dynamic credential routing")
    if runtime.get("api_mode") not in (None, "chat_completions"):
        raise ValueError("unverified backend")
    runtime = {k: runtime.get(k) for k in
               ("model", "provider", "api_mode", "base_url", "api_key", "request_overrides")}
    attrs = ("model", "provider", "platform", "session_start", "tools",
             "enabled_toolsets", "disabled_toolsets", "reasoning_config",
             "ephemeral_system_prompt", "prefill_messages", "request_overrides",
             "_memory_enabled", "_user_profile_enabled", "providers_allowed",
             "providers_ignored", "providers_order", "provider_sort",
             "provider_require_parameters", "provider_data_collection")
    parent = {k: getattr(agent, k, None) for k in attrs}
    if isinstance(parent["session_start"], datetime):
        parent["session_start"] = parent["session_start"].isoformat()
    store = getattr(agent, "_memory_store", None)
    memory = {k: getattr(store, k, None) for k in
              ("memory_entries", "user_entries", "_system_prompt_snapshot",
               "memory_char_limit", "user_char_limit", "memory_enabled", "user_profile_enabled")}
    # Length-framed JSON prevents concatenation ambiguity; content hashes detect
    # equal-size edits even if timestamps were restored. Any unreadable/symlink
    # input bypasses optimization, never becomes an equivalent 'missing' value.
    files = {}
    paths = [root / rel for rel in ("memories/MEMORY.md", "memories/USER.md", "config.yaml")]
    skills = root / "skills"
    if skills.is_symlink():
        raise ValueError("linked skill root")
    if skills.exists():
        def unreadable(error):
            raise error
        for current, dirs, names in os.walk(skills, followlinks=False, onerror=unreadable):
            if any((Path(current) / d).is_symlink() for d in dirs):
                raise ValueError("linked skill directory")
            paths.extend(Path(current) / n for n in names)
    size = 0
    for path in sorted(paths):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("linked input")
        try:
            if path.stat().st_size + size > MAX_INPUT_BYTES:
                raise ValueError("input too large")
            data = path.read_bytes()
        except FileNotFoundError:
            # A missing optional file is distinct from an empty one.
            files[str(path.relative_to(root))] = None
            continue
        size += len(data)
        if size > MAX_INPUT_BYTES:
            raise ValueError("input too large")
        files[str(path.relative_to(root))] = _hash(data)
    scope = [bool(review_memory), bool(review_skills)]
    lane = _hash(_json([str(root), session, scope]))
    payload = _json([lane, messages, prompt, cfg, prefix, parent, memory, runtime, files])
    if len(payload) > MAX_INPUT_BYTES:
        raise ValueError("snapshot too large")
    return lane, _hash(payload)


@dataclass
class _Lane:
    fingerprint: str
    completed_at: float | None = None
    failures: int = 0
    retry_at: float = 0.0


class _DedupState:
    """Owned tickets; late/duplicate completions cannot settle another run."""
    def __init__(self):
        self.lock = threading.Lock()
        self.lanes: OrderedDict[str, _Lane] = OrderedDict()
        self.in_flight: dict[str, tuple[str, _Lane, float]] = {}

    def acquire(self, lane, fingerprint, now, interval):
        with self.lock:
            for ticket, (_, _, stamp) in list(self.in_flight.items()):
                if now - stamp >= IN_FLIGHT_TIMEOUT_SECONDS:
                    del self.in_flight[ticket]
            entry = self.lanes.get(lane)
            if entry is None or entry.fingerprint != fingerprint:
                entry = self.lanes[lane] = _Lane(fingerprint)
            self.lanes.move_to_end(lane)
            while len(self.lanes) > MAX_LANES:
                self.lanes.popitem(last=False)
            active = any(item[0] == lane for item in self.in_flight.values())
            # A pending result is not proof of successful review. Concurrent
            # invocations run normally rather than being silently discarded.
            if not active:
                if entry.failures >= MAX_CONSECUTIVE_FAILURES:
                    if now < entry.retry_at:
                        return None, "failure_cooldown"
                    entry.failures = 0  # bounded recovery probe after cooldown
                if entry.completed_at is not None and now - entry.completed_at < interval:
                    return None, "completed_identical_input"
            ticket = uuid.uuid4().hex
            self.in_flight[ticket] = (lane, entry, now)
            return ticket, "concurrent_unproven" if active else "review_required"

    def finish(self, ticket, *, reusable, failed, now):
        with self.lock:
            owned = self.in_flight.pop(ticket, None)
            if owned is None:
                return False
            lane, owned_entry, started = owned
            entry = self.lanes.get(lane)
            if entry is not owned_entry:
                return False
            # An overlapping task may still change stores; don't publish a
            # reusable result until there is no other worker in this lane.
            active = any(item[0] == lane for item in self.in_flight.values())
            entry.completed_at = (now if reusable and not active and
                                  now - started < IN_FLIGHT_TIMEOUT_SECONDS else None)
            if failed:
                entry.failures += 1
                if entry.failures >= MAX_CONSECUTIVE_FAILURES:
                    entry.retry_at = now + FAILURE_COOLDOWN_SECONDS
            else:
                entry.failures = 0
            return True


@dataclass
class _Attempt:
    returned_ok: bool = False
    tool_free: bool = False
    usage: dict = field(default_factory=dict)
    result: str | None = None


def _usage_number(usage, key):
    try:
        value = float(usage.get(key) or 0)
        return max(0, int(value)) if math.isfinite(value) else 0
    except (TypeError, ValueError, OverflowError):
        return 0


def _explicit_admission_wrapper(original):
    """Preserve /refine requests while native one-run-per-Agent admission is busy.

    FIFO per Agent, each item with its own cloned input and Context. Native
    tokens remain the sole execution fence; never clear or expire another run.
    This queue is process-local, like Hermes's native idle queue.
    """
    signature = inspect.signature(original)
    lock = threading.RLock()
    pending = weakref.WeakKeyDictionary()

    def dispatch(agent, queue):
        while True:
            with lock:
                if not queue:
                    pending.pop(agent, None)
                    return
                current = getattr(agent, "_background_review_run", None)
                if current is None or current.request_done.is_set():
                    context, arguments = queue.popleft()
                    try:
                        context.run(original, agent, **arguments)
                    except Exception:
                        # Native spawn releases its OWN token on setup failure.
                        _record({"event": "explicit_dispatch", "result": "setup_error"})
                        logger.warning("Queued explicit review failed to start")
                    continue
            # No lock held across provider execution or waiting. A hung native
            # worker is never declared dead merely because a timer elapsed.
            current.request_done.wait(timeout=1.0)

    @functools.wraps(original)
    def spawn_now(agent, *args, **kwargs):
        bound = signature.bind(agent, *args, **kwargs)
        bound.apply_defaults()
        explicit = bound.arguments.get("explicit") or bound.arguments.get("focus") is not None
        with lock:
            current = getattr(agent, "_background_review_run", None)
            try:
                queue = pending.get(agent)
            except TypeError:
                # Unknown non-weak-referenceable integration stubs keep their
                # native behavior; never break a caller to add bookkeeping.
                return original(agent, *args, **kwargs)
            busy = current is not None and not current.request_done.is_set()
            if explicit and (busy or queue):
                if queue is not None and len(queue) >= MAX_PENDING_EXPLICIT:
                    raise RuntimeError("Too many pending explicit reviews; retry after current reviews finish")
                arguments = copy.deepcopy({k: v for k, v in bound.arguments.items() if k != "self"})
                item = (contextvars.copy_context(), arguments)
                if queue is None:
                    queue = pending[agent] = deque()
                    queue.append(item)
                    try:
                        threading.Thread(target=dispatch, args=(agent, queue), daemon=True,
                                         name="bg-review-explicit-queue").start()
                    except Exception:
                        pending.pop(agent, None)
                        raise
                else:
                    queue.append(item)
                _record({"event": "trigger", "decision": "queue", "reason": "explicit_waiting_for_native_run"})
                return None
            return original(agent, *args, **kwargs)
    return spawn_now


def install() -> bool:
    try:
        from run_agent import AIAgent
        import agent.background_review as br
        return install_on_class(AIAgent, br)
    except Exception:
        logger.warning("bg_review_dedup: compatible Hermes unavailable; reviews unchanged")
        return False


def install_on_class(cls: Any, br: Any) -> bool:
    """Patch the worker factory shared by immediate, explicit and idle paths.

    Target closures own their native run token and ticket; ContextVar is used
    only INSIDE that target to collect completion/return evidence. It is never
    relied on to transport reservation ownership through the idle queue.
    """
    if getattr(br, "_ziwei_bg_dedup_installed", False):
        return True
    required = ("spawn_background_review_thread", "_log_review_completion",
                "build_cache_parity_fork", "finish_background_review_run")
    if not all(callable(getattr(br, name, None)) for name in required):
        return False
    factory = br.spawn_background_review_thread
    signature = inspect.signature(factory)
    if not all(name in signature.parameters for name in
               ("agent", "messages_snapshot", "task_cfg", "review_run", "explicit")):
        return False
    original_log = br._log_review_completion
    original_build = br.build_cache_parity_fork
    state = _DedupState()
    original_now = getattr(cls, "_spawn_background_review_now", None)
    explicit_wrapper = None
    if callable(original_now) and all(name in inspect.signature(original_now).parameters
                                      for name in ("self", "messages_snapshot", "explicit")):
        explicit_wrapper = _explicit_admission_wrapper(original_now)

    @functools.wraps(original_log)
    def log_completion(usage, result):
        attempt = _attempt.get()
        if attempt is not None:
            try:
                attempt.usage = dict(usage or {})
                attempt.result = result if result in ("none", "memory", "skill", "skill+memory", "error") else "unknown"
            except Exception:
                attempt.result = "unknown"
        return original_log(usage, result)

    @functools.wraps(original_build)
    def build_fork(*args, **kwargs):
        built = original_build(*args, **kwargs)
        attempt = _attempt.get()
        if attempt is None:
            return built
        fork = built[0]
        original_run = fork.run_conversation

        @functools.wraps(original_run)
        def observed_run(*a, **kw):
            history = kw.get("conversation_history") or []
            prior_tools = sum(len(m.get("tool_calls") or []) for m in history if isinstance(m, dict))
            try:
                result = original_run(*a, **kw)
                # Hermes may log `none` even when its turn returned a partial
                # or error envelope. Require affirmative turn-level success.
                attempt.returned_ok = (isinstance(result, dict) and result.get("completed") is True
                                       and not any(result.get(k) for k in
                                                   ("error", "failed", "partial", "interrupted", "cleanup_errors")))
                messages = result.get("messages") if isinstance(result, dict) else None
                attempt.tool_free = (isinstance(messages, list) and
                                     sum(len(m.get("tool_calls") or []) for m in messages
                                         if isinstance(m, dict)) == prior_tools)
                return result
            finally:
                fork.run_conversation = original_run
        try:
            fork.run_conversation = observed_run
        except Exception:
            # Unable to observe a future/immutable fork: no reusable proof.
            attempt.returned_ok = False
        return built

    @functools.wraps(factory)
    def spawn_thread(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        inputs = bound.arguments
        agent = inputs["agent"]
        run = inputs["review_run"]
        try:
            cfg = inputs.get("task_cfg")
            cfg = copy.deepcopy(_load_task_cfg(br) if cfg is None else cfg)
            # Freeze the exact config passed to the native factory/worker.
            inputs["task_cfg"] = cfg
        except Exception:
            return factory(*args, **kwargs)
        target, prompt = factory(*bound.args, **bound.kwargs)
        # Capture explicit/focus at the invocation, never in an Agent slot.
        explicit = inputs.get("explicit") or inputs.get("focus") is not None

        def native_target():
            try:
                return target()
            finally:
                # Also cover native early-return paths before its own finally.
                br.finish_background_review_run(agent, run)

        def tracked_target():
            # Respect invocation overrides AND a subsequently disabled global
            # gate. Read in the worker's propagated profile context.
            try:
                current_cfg = _load_task_cfg(br)
                enabled = _dedup_enabled(cfg) and _dedup_enabled(current_cfg)
                if explicit or not enabled or run is None:
                    _record({"event": "trigger", "decision": "run", "reason":
                             "explicit" if explicit else "dedup_disabled_or_unbound"})
                    return native_target()
                # Hermes normalizes/merges messages in place during its fork.
                # Retain the ORIGINAL input for post-run equivalence checks.
                frozen_messages = copy.deepcopy(inputs["messages_snapshot"])
                lane, fp = _fingerprint(agent, frozen_messages, prompt, cfg,
                                        inputs["review_memory"], inputs["review_skills"])
                ticket, reason = state.acquire(lane, fp, time.monotonic(), _force_interval(cfg))
            except Exception:
                _record({"event": "trigger", "decision": "run", "reason": "unproven_input"})
                return native_target()
            _record({"event": "trigger", "lane": lane, "fingerprint": fp,
                     "decision": "run" if ticket else "skip", "reason": reason})
            if ticket is None:
                br.finish_background_review_run(agent, run)
                return
            attempt = _Attempt()
            context_token = _attempt.set(attempt)
            raised = False
            try:
                return native_target()
            except BaseException:
                raised = True
                raise
            finally:
                _attempt.reset(context_token)
                # All bookkeeping is fail-open and cannot retry target().
                try:
                    unchanged = (lane, fp) == _fingerprint(
                        agent, frozen_messages, prompt, cfg,
                        inputs["review_memory"], inputs["review_skills"])
                    cancelled = run.cancel_requested.is_set()
                    calls = _usage_number(attempt.usage, "api_calls")
                    failed = raised or cancelled or not attempt.returned_ok or attempt.result in (None, "error", "unknown")
                    reusable = (not failed and unchanged and attempt.tool_free
                                and attempt.result == "none" and calls == 1)
                    settled = state.finish(ticket, reusable=reusable, failed=failed, now=time.monotonic())
                    _record({"event": "complete", "ticket": ticket, "lane": lane,
                             "fingerprint": fp, "settled": settled, "reusable": reusable,
                             "result": "failed" if failed else "completed",
                             **{key: _usage_number(attempt.usage, key) for key in
                                ("api_calls", "input_tokens", "output_tokens", "cache_read_tokens")}})
                    if calls > WARN_API_CALLS:
                        logger.warning("Background review used %d API calls; recorded without interruption", calls)
                except Exception:
                    state.finish(ticket, reusable=False, failed=True, now=time.monotonic())
                    _record({"event": "complete", "ticket": ticket, "result": "unproven_completion"})
        def isolated_target():
            # A queued/nested explicit or disabled target may inherit another
            # review's Context. Never let its usage settle that outer review.
            token = _attempt.set(None)
            try:
                return tracked_target()
            finally:
                _attempt.reset(token)
        return isolated_target, prompt

    br.spawn_background_review_thread = spawn_thread
    br._log_review_completion = log_completion
    br.build_cache_parity_fork = build_fork
    if explicit_wrapper is not None:
        cls._spawn_background_review_now = explicit_wrapper
    br._ziwei_bg_dedup_installed = True
    cls._ziwei_bg_dedup_state = state
    return True
