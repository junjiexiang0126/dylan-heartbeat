"""Exact-input cache contract tests. Native integration is in the opt-in file."""
import copy
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bg_review_dedup as d


class FakeBR:
    def __init__(self):
        self.cfg = {"dedup_enabled": True}
        self.calls = 0
        self.logs = []
        self.error = False
        self.partial = False
        self.tool = False
        self.api_calls = 1
        self.normalize_snapshot = False
        self.target_calls = 0
        self.target_error = None
        self.mutate = lambda: None

    def load_background_review_settings(self):
        return True, self.cfg

    def finish_background_review_run(self, agent, run):
        if run is not None:
            run.request_done.set()

    def _log_review_completion(self, usage, result):
        self.logs.append((usage, result))

    def build_cache_parity_fork(self, agent, task_cfg=None, *, max_iterations=16):
        def run_conversation(**kw):
            self.calls += self.api_calls
            self.mutate()
            if self.error:
                raise RuntimeError("private error text")
            messages = copy.deepcopy(kw["conversation_history"])
            if self.tool:
                messages.append({"role": "assistant", "tool_calls": [{"id": "new"}]})
            return {"completed": not self.partial, "partial": self.partial, "messages": messages}
        return SimpleNamespace(run_conversation=run_conversation), {}, False

    def spawn_background_review_thread(self, agent, messages_snapshot, review_memory=False,
                                      review_skills=False, focus=None, task_cfg=None,
                                      review_run=None, explicit=False):
        prompt = "memory" if review_memory else "skill"
        if focus:
            prompt += focus
        def target():
            self.target_calls += 1
            if self.target_error is not None:
                raise self.target_error
            if review_run.cancel_requested.is_set():
                return
            if self.normalize_snapshot:
                messages_snapshot[0]["content"] += " normalized by Hermes"
            fork, _, _ = self.build_cache_parity_fork(agent, task_cfg)
            try:
                fork.run_conversation(conversation_history=messages_snapshot)
                self._log_review_completion({"api_calls": self.api_calls, "input_tokens": 12}, "none")
            except RuntimeError:
                self._log_review_completion({"api_calls": self.api_calls}, "error")
        return target, prompt


class Contract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "memories").mkdir()
        (self.root / "memories/MEMORY.md").write_text("memory")
        (self.root / "skills").mkdir()
        (self.root / "skills/SKILL.md").write_text("skill")
        patch = mock.patch.object(d, "_home", return_value=self.root)
        patch.start()
        self.addCleanup(patch.stop)
        self.br = FakeBR()
        self.cls = type("Agent", (), {})
        self.assertTrue(d.install_on_class(self.cls, self.br))
        self.state = self.cls._ziwei_bg_dedup_state
        self.agent = SimpleNamespace(session_id="private-session", _cached_system_prompt="private-prefix",
                                     tools=[], model="test", provider="test",
                                     _current_main_runtime=lambda: {"api_mode": "chat_completions"})
        self.messages = [{"role": "user", "content": "private-conversation"}]

    def factory(self, **kw):
        run = SimpleNamespace(cancel_requested=threading.Event(), request_done=threading.Event())
        target, prompt = self.br.spawn_background_review_thread(
            kw.pop("agent", self.agent), copy.deepcopy(kw.pop("messages", self.messages)), review_run=run, **kw)
        return target, run

    def trigger(self, **kw):
        target, run = self.factory(**kw)
        target()
        self.assertTrue(run.request_done.is_set())
        return run

    def events(self):
        return [json.loads(line) for line in (self.root / d.LOG_NAME).read_text().splitlines()]

    def test_completed_identical_input_skips_api(self):
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 1)
        self.assertEqual(self.events()[-1]["reason"], "completed_identical_input")

    def test_new_dialogue_is_reviewed(self):
        self.trigger()
        self.messages.append({"role": "user", "content": "new"})
        self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_native_snapshot_normalization_does_not_defeat_cache(self):
        self.br.normalize_snapshot = True
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 1)
        self.assertEqual(self.messages[0]["content"], "private-conversation")

    def test_inherited_collector_cannot_capture_explicit_or_disabled_run(self):
        for kw in ({"explicit": True}, {"task_cfg": {"dedup_enabled": False}}):
            outer = d._Attempt()
            token = d._attempt.set(outer)
            try:
                self.trigger(**kw)
                self.assertIs(d._attempt.get(), outer)
                self.assertIsNone(outer.result)
                self.assertFalse(outer.returned_ok)
            finally:
                d._attempt.reset(token)

    def test_external_memory_is_unproven(self):
        self.agent._memory_manager = SimpleNamespace(_has_external=True)
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_over_budget_records_without_interruption(self):
        self.br.api_calls = 9
        with self.assertLogs("ziwei.bg_review_dedup", level="WARNING") as logs:
            self.trigger()
        self.assertEqual(self.br.calls, 9)
        self.assertTrue(any("9 API calls" in line for line in logs.output))

    def test_force_interval_validation(self):
        self.assertEqual(d._force_interval({"dedup_force_interval_seconds": -1}), 1)
        self.assertEqual(d._force_interval({"dedup_force_interval_seconds": "bad"}), d.DEFAULT_FORCE_INTERVAL_SECONDS)

    def test_new_tool_result_is_reviewed(self):
        self.trigger()
        self.messages.append({"role": "tool", "content": "new result", "tool_call_id": "a"})
        self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_prior_tool_usage_is_part_of_snapshot(self):
        self.messages.append({"role": "assistant", "tool_calls": [{"id": "old", "function": {"name": "read_file"}}]})
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 1)
        self.messages[-1]["tool_calls"][0]["function"]["name"] = "memory"
        self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_memory_skill_combined_are_distinct(self):
        self.trigger(review_memory=True)
        self.trigger(review_skills=True)
        self.trigger(review_memory=True, review_skills=True)
        self.assertEqual(self.br.calls, 3)

    def test_scope_flags_can_be_positional(self):
        run = SimpleNamespace(cancel_requested=threading.Event(), request_done=threading.Event())
        target, _ = self.br.spawn_background_review_thread(self.agent, self.messages, True, False, None, None, run, False)
        target()
        self.trigger(review_memory=True)
        self.assertEqual(self.br.calls, 1)

    def test_explicit_always_bypasses_cache(self):
        self.trigger()
        self.trigger(explicit=True)
        self.trigger(explicit=True, focus="private-focus")
        self.trigger(focus="")
        self.assertEqual(self.br.calls, 4)

    def test_disabled_and_default_are_compatible(self):
        for cfg in ({}, {"dedup_enabled": False}):
            self.br.cfg = cfg
            self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 4)
        self.assertFalse(self.state.in_flight)

    def test_disable_between_factory_and_worker(self):
        self.trigger()
        target, _ = self.factory()
        self.br.cfg = {"dedup_enabled": False}
        target()
        self.assertEqual(self.br.calls, 2)

    def test_unstarted_targets_create_no_reservations(self):
        self.factory(); self.factory()
        self.assertFalse(self.state.in_flight)
        self.assertFalse(self.state.lanes)

    def test_interleaved_explicit_cannot_settle_other_ticket(self):
        target, _ = self.factory()
        self.trigger(explicit=True)
        target()
        self.trigger()
        self.assertEqual(self.br.calls, 2)
        self.assertIsNone(d._attempt.get())
        self.assertFalse(hasattr(self.agent, "_ziwei_bg_dedup_fp"))

    def test_multisession_same_content_does_not_collide(self):
        self.trigger()
        second = copy.copy(self.agent)
        second.session_id = "second"
        self.trigger(agent=second); self.trigger(agent=second)
        self.assertEqual(self.br.calls, 2)

    def test_profile_isolation(self):
        self.trigger()
        other = self.root / "profile"
        other.mkdir()
        with mock.patch.object(d, "_home", return_value=other):
            self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_memory_change_even_equal_size_runs(self):
        self.trigger()
        (self.root / "memories/MEMORY.md").write_text("MEMORY")
        self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_skill_reference_change_runs(self):
        self.trigger()
        (self.root / "skills/reference.txt").write_text("new")
        self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_config_and_prefix_changes_run(self):
        self.trigger()
        self.br.cfg["max_input_tokens"] = 42
        self.trigger()
        self.agent._cached_system_prompt = "changed"
        self.trigger()
        self.assertEqual(self.br.calls, 3)

    def test_review_write_not_absorbed(self):
        self.br.mutate = lambda: (self.root / "memories/MEMORY.md").write_text("updated")
        self.trigger()
        self.br.mutate = lambda: None
        self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_tool_read_cannot_be_cached(self):
        self.br.tool = True
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_multicall_not_cached(self):
        self.br.api_calls = 2
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 4)

    def test_partial_none_is_not_success(self):
        self.br.partial = True
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_failure_cooldown_then_recovery(self):
        self.br.error = True
        for _ in range(d.MAX_CONSECUTIVE_FAILURES):
            self.trigger()
        self.trigger()
        self.assertEqual(self.br.calls, 3)
        self.assertEqual(self.events()[-1]["reason"], "failure_cooldown")
        self.br.error = False
        with mock.patch.object(d.time, "monotonic", return_value=d.time.monotonic() + d.FAILURE_COOLDOWN_SECONDS + 1):
            self.trigger()
        self.assertEqual(self.br.calls, 4)

    def test_changed_input_recovers_without_cooldown(self):
        self.br.error = True
        for _ in range(3):
            self.trigger()
        self.br.error = False
        self.messages.append({"role": "user", "content": "new"})
        self.trigger()
        self.assertEqual(self.br.calls, 4)

    def test_cancelled_run_never_cached(self):
        target, run = self.factory()
        run.cancel_requested.set()
        target()
        self.trigger()
        self.assertEqual(self.br.calls, 1)

    def test_force_interval_requires_real_review(self):
        self.trigger()
        with mock.patch.object(d.time, "monotonic", return_value=d.time.monotonic() + d.DEFAULT_FORCE_INTERVAL_SECONDS + 1):
            self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_unknown_input_is_fail_open(self):
        self.messages[0]["unknown"] = object()
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_unreadable_input_is_fail_open(self):
        with mock.patch.object(Path, "read_bytes", side_effect=PermissionError):
            self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_symlink_input_is_fail_open(self):
        (self.root / "skills/link").symlink_to(self.root / "memories")
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_main_alias_without_model_reuses_completed_input(self):
        self.br.cfg.update(provider="main", model="")
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 1)

    def test_main_alias_with_concrete_model_is_unproven(self):
        self.br.cfg.update(provider="main", model="another-model")
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_internal_skill_link_target_content_is_hashed(self):
        path = self.root / "skills/SKILL.md"
        (self.root / "skills/alias.md").symlink_to(path)
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 1)
        before = path.stat()
        path.write_text("SKILL")  # equal-size edit with the original mtime
        import os
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_external_skill_link_needs_explicit_root(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside)
            (target / "SKILL.md").write_text("linked skill")
            (self.root / "skills/external").symlink_to(target, target_is_directory=True)
            self.trigger(); self.trigger()
            self.assertEqual(self.br.calls, 2)

    def test_authorized_external_link_content_change_is_reviewed(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside)
            path = target / "SKILL.md"
            path.write_text("linked skill")
            (self.root / "skills/external").symlink_to(target, target_is_directory=True)
            self.br.cfg['dedup_skill_link_roots'] = [str(target)]
            self.trigger(); self.trigger()
            self.assertEqual(self.br.calls, 1)
            path.write_text("LINKED SKILL")
            self.trigger()
            self.assertEqual(self.br.calls, 2)

    def test_authorized_link_cannot_escape_to_another_root(self):
        with tempfile.TemporaryDirectory() as outside:
            base = Path(outside)
            allowed = base / "allowed"; allowed.mkdir()
            other = base / "allowed-sibling"; other.mkdir()
            (other / "SKILL.md").write_text("outside allowed root")
            (allowed / "escape").symlink_to(other, target_is_directory=True)
            (self.root / "skills/external").symlink_to(allowed, target_is_directory=True)
            self.br.cfg['dedup_skill_link_roots'] = [str(allowed)]
            self.trigger(); self.trigger()
            self.assertEqual(self.br.calls, 2)

    def test_broken_skill_link_is_unproven(self):
        (self.root / "skills/broken").symlink_to(self.root / "skills/missing")
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_cyclic_skill_link_is_unproven(self):
        (self.root / "skills/cycle").symlink_to(self.root / "skills", target_is_directory=True)
        self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_skill_link_policy_rejects_unknown_or_unbounded_roots(self):
        for value in ("not-a-list", ["relative/path"], ["/"], [42]):
            with self.subTest(value=value):
                self.br.cfg['dedup_skill_link_roots'] = value
                self.trigger()
        self.assertEqual(self.br.calls, 4)

    def test_linked_skill_root_itself_needs_explicit_authorization(self):
        import shutil
        shutil.rmtree(self.root / "skills")
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside)
            (target / "SKILL.md").write_text("linked root")
            (self.root / "skills").symlink_to(target, target_is_directory=True)
            self.br.cfg['dedup_skill_link_roots'] = [str(target)]
            self.trigger(); self.trigger()
            self.assertEqual(self.br.calls, 1)

    def test_skill_inventory_bound_fails_open(self):
        with mock.patch.object(d, 'MAX_SKILL_ENTRIES', 1):
            self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 2)

    def test_routed_and_extra_tools_are_unproven(self):
        for cfg in ({"model": "other"}, {"extra_tools": ["external"]}):
            self.br.cfg = {"dedup_enabled": True, **cfg}
            self.trigger(); self.trigger()
        self.assertEqual(self.br.calls, 4)

    def test_audit_contains_no_private_text(self):
        self.trigger(); self.trigger(explicit=True, focus="private-focus")
        audit = (self.root / d.LOG_NAME).read_text()
        for word in ("private-conversation", "private-focus", "private-session", "private-prefix", "MEMORY.md"):
            self.assertNotIn(word, audit)

    def test_log_failure_does_not_run_target_twice(self):
        with mock.patch.object(Path, "open", side_effect=PermissionError):
            self.trigger()
        self.assertEqual(self.br.calls, 1)

    def test_incompatible_hermes_is_unchanged(self):
        br = SimpleNamespace(spawn_background_review_thread=lambda: None)
        before = br.spawn_background_review_thread
        self.assertFalse(d.install_on_class(object, br))
        self.assertIs(br.spawn_background_review_thread, before)

    def test_idempotent_install(self):
        before = self.br.spawn_background_review_thread
        self.assertTrue(d.install_on_class(self.cls, self.br))
        self.assertIs(before, self.br.spawn_background_review_thread)

    def assert_target_error_runs_once(self, **kw):
        failure = RuntimeError("native worker failed")
        self.br.target_error = failure
        target, run = self.factory(**kw)
        with self.assertRaises(RuntimeError) as raised:
            target()
        self.assertIs(raised.exception, failure)
        self.assertEqual(self.br.target_calls, 1)
        self.assertTrue(run.request_done.is_set())
        self.assertFalse(self.state.in_flight)
        self.assertIsNone(d._attempt.get())

    def test_explicit_target_error_runs_once(self):
        self.assert_target_error_runs_once(explicit=True)

    def test_disabled_target_error_runs_once(self):
        self.br.cfg = {"dedup_enabled": False}
        self.assert_target_error_runs_once()

    def test_default_target_error_runs_once(self):
        self.br.cfg = {}
        self.assert_target_error_runs_once()

    def test_unproven_input_target_error_runs_once(self):
        self.messages[0]["unknown"] = object()
        self.assert_target_error_runs_once()

    def test_tracked_target_error_runs_once(self):
        self.assert_target_error_runs_once()

    def test_unbound_target_error_runs_once(self):
        self.br.target_error = RuntimeError("unbound native worker failed")
        target, _ = self.br.spawn_background_review_thread(self.agent, self.messages)
        with self.assertRaises(RuntimeError):
            target()
        self.assertEqual(self.br.target_calls, 1)
        self.assertFalse(self.state.in_flight)
        self.assertIsNone(d._attempt.get())


class StateContract(unittest.TestCase):
    def test_busy_explicit_queue_overflow_is_reported_not_dropped(self):
        class Agent:
            def _spawn_background_review_now(self, messages_snapshot, explicit=False):
                raise AssertionError("busy Agent must not start another native run")
        agent = Agent()
        agent._background_review_run = SimpleNamespace(request_done=threading.Event())
        wrapped = d._explicit_admission_wrapper(Agent._spawn_background_review_now)
        with mock.patch.object(threading.Thread, "start"):
            for _ in range(d.MAX_PENDING_EXPLICIT):
                wrapped(agent, [], explicit=True)
            with self.assertRaises(RuntimeError):
                wrapped(agent, [], explicit=True)
        self.assertFalse(agent._background_review_run.request_done.is_set())

    def test_explicit_dispatcher_start_error_preserves_native_owner(self):
        class Agent:
            def _spawn_background_review_now(self, messages_snapshot, explicit=False):
                raise AssertionError("must remain queued")
        agent = Agent()
        owner = agent._background_review_run = SimpleNamespace(request_done=threading.Event())
        wrapped = d._explicit_admission_wrapper(Agent._spawn_background_review_now)
        with mock.patch.object(threading.Thread, "start", side_effect=RuntimeError("thread failure")):
            with self.assertRaises(RuntimeError):
                wrapped(agent, [], explicit=True)
        self.assertIs(agent._background_review_run, owner)
        self.assertFalse(owner.request_done.is_set())

    def test_duplicate_completion_cannot_release_successor(self):
        state = d._DedupState()
        a, _ = state.acquire("lane", "a", 1, 100)
        state.finish(a, reusable=True, failed=False, now=2)
        b, _ = state.acquire("lane", "b", 3, 100)
        self.assertFalse(state.finish(a, reusable=True, failed=False, now=4))
        self.assertIn(b, state.in_flight)

    def test_timeout_and_late_aba_completion(self):
        state = d._DedupState()
        a, _ = state.acquire("lane", "a", 1, 100)
        state.acquire("lane", "b", 2, 100)
        newest, _ = state.acquire("lane", "a", d.IN_FLIGHT_TIMEOUT_SECONDS + 2, 100)
        self.assertFalse(state.finish(a, reusable=True, failed=False, now=2000))
        self.assertIn(newest, state.in_flight)

    def test_active_work_is_not_assumed_successful(self):
        state = d._DedupState()
        a, _ = state.acquire("lane", "a", 1, 100)
        b, reason = state.acquire("lane", "a", 2, 100)
        self.assertIsNotNone(b)
        self.assertEqual(reason, "concurrent_unproven")
        state.finish(a, reusable=True, failed=False, now=3)
        self.assertIsNone(state.lanes["lane"].completed_at)

    def test_restart_is_cold(self):
        state = d._DedupState()
        a, _ = state.acquire("lane", "a", 1, 100)
        state.finish(a, reusable=True, failed=False, now=2)
        self.assertIsNotNone(d._DedupState().acquire("lane", "a", 3, 100)[0])

    def test_state_is_bounded(self):
        state = d._DedupState()
        for i in range(d.MAX_LANES + 20):
            a, _ = state.acquire(str(i), str(i), i, 100)
            state.finish(a, reusable=False, failed=False, now=i)
        self.assertEqual(len(state.lanes), d.MAX_LANES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
