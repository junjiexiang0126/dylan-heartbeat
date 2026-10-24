"""Opt-in native Hermes + loopback OpenAI-compatible HTTP integration.

Run with HERMES_REVIEW_TEST_SOURCE=/path/to/pinned/hermes checkout. No paid
provider, production credentials, Docker daemon or production home is used.
"""
import copy
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

SOURCE = os.environ.get("HERMES_REVIEW_TEST_SOURCE")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bg_review_dedup as dedup


@unittest.skipUnless(SOURCE, "set HERMES_REVIEW_TEST_SOURCE for native integration")
class NativeHTTPIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http_counts = []
        cls.sandbox = tempfile.TemporaryDirectory(prefix="ziwei-review-native-")
        cls.env = mock.patch.dict(os.environ, {"HERMES_HOME": cls.sandbox.name,
                                              "TERMINAL_CWD": cls.sandbox.name,
                                              "HERMES_SKIP_REGISTER_BUILTIN_SKILLS": "1"})
        cls.env.start()
        sys.path.insert(0, str(Path(SOURCE).resolve()))
        # Fail any accidental outbound socket before it reaches a real provider.
        connect = socket.socket.connect
        def loopback_only(sock, address):
            if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1"):
                raise OSError("integration allows loopback only")
            return connect(sock, address)
        cls.network = mock.patch.object(socket.socket, "connect", loopback_only)
        cls.network.start()
        import run_agent
        from agent import background_review, review_idle_queue
        cls.ra, cls.br, cls.riq = run_agent, background_review, review_idle_queue
        cls.original_spawn_now = run_agent.AIAgent._spawn_background_review_now
        cls.originals = {k: getattr(background_review, k) for k in
                         ("spawn_background_review_thread", "_log_review_completion", "build_cache_parity_fork")}
        assert dedup.install_on_class(run_agent.AIAgent, background_review)
        built = background_review.build_cache_parity_fork
        def nonstreaming_fork(*a, **kw):
            result = built(*a, **kw)
            result[0]._disable_streaming = True
            result[0].save_trajectories = False
            if cls.current_test.mode == "timeout":
                result[0].client = result[0].client.with_options(timeout=0.05, max_retries=0)
                result[0]._api_max_retries = 1
                # Exercise a real socket timeout without the optional multi-
                # minute provider rebuild/fallback recovery ladder in this test.
                result[0]._try_recover_primary_transport = lambda *a, **kw: False
                result[0]._auto_recovery_cycles = 0
            return result
        background_review.build_cache_parity_fork = nonstreaming_fork

    @classmethod
    def tearDownClass(cls):
        for k, value in cls.originals.items():
            setattr(cls.br, k, value)
        cls.ra.AIAgent._spawn_background_review_now = cls.original_spawn_now
        del cls.br._ziwei_bg_dedup_installed
        cls.network.stop()
        cls.env.stop()
        cls.sandbox.cleanup()
        print("NATIVE_HTTP_COUNTS=" + json.dumps(cls.http_counts, sort_keys=True))

    def setUp(self):
        type(self).current_test = self
        self.home = Path(self.sandbox.name)
        self.requests = []
        self.mode = "normal"
        self.entered = threading.Event()
        self.release = threading.Event()
        outer = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if not self.path.endswith("/chat/completions"):
                    # Native local-model metadata/token-count probes are not
                    # billable chat requests and have a different wire schema.
                    body = json.dumps({"tokens": [], "count": 10}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                outer.requests.append(payload)
                mode = outer.mode
                if mode == "timeout":
                    time.sleep(0.2)
                if mode == "blocked":
                    outer.entered.set()
                    outer.release.wait(10)
                if mode == "error":
                    body = json.dumps({"error": {"message": "isolated authorization failure", "type": "authentication_error"}}).encode()
                    self.send_response(401)
                else:
                    message = {"role": "assistant", "content": "Nothing to save."}
                    finish = "stop"
                    if mode in ("memory", "skill") and not any(m.get("role") == "tool" for m in payload["messages"]):
                        function = {"name": "memory", "arguments": json.dumps({
                            "action": "add", "target": "memory", "content": "Isolated integration fact"})}
                        if mode == "skill":
                            function = {"name": "skill_manage", "arguments": json.dumps({
                                "name": "isolated-review-test", "action": "create",
                                "content": "---\nname: isolated-review-test\ndescription: Isolated integration skill\n---\n# Isolated skill\nUse only in the integration sandbox.\n"})}
                        message = {"role": "assistant", "content": None, "tool_calls": [{"id": "review-test-memory",
                                   "type": "function", "function": function}]}
                        finish = "tool_calls"
                    body = json.dumps({"id": "local-test", "object": "chat.completion", "created": 1,
                                       "model": payload["model"], "choices": [{"index": 0, "message": message,
                                       "finish_reason": finish}], "usage": {"prompt_tokens": 40,
                                       "completion_tokens": 8, "total_tokens": 48}}).encode()
                    self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # expected when testing a real client-side timeout
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.write_config(True)
        self.agent = self.make_agent()
        self.messages = [{"role": "user", "content": "private isolated conversation"}]
        self.addCleanup(self.wait_workers)

    def tearDown(self):
        self.http_counts.append({"test": self._testMethodName, "chat_requests": len(self.requests)})

    def write_config(self, enabled, review_enabled=True, request_timeout=120, review_options=None):
        # JSON is valid YAML; native config loaders read this real isolated file.
        review = {"enabled": review_enabled, "dedup_enabled": enabled, "defer": "never"}
        review.update(review_options or {})
        (self.home / "config.yaml").write_text(json.dumps({
            "auxiliary": {"background_review": review},
            "providers": {"custom": {"request_timeout_seconds": request_timeout}},
            "terminal": {"cwd": str(self.home)}, "memory": {"memory_enabled": True, "user_profile_enabled": True}}))

    def make_agent(self):
        agent = self.ra.AIAgent(api_key="isolated-not-a-live-key", provider="custom",
                                base_url=f"http://127.0.0.1:{self.server.server_port}/v1", model="local-review-test",
                                quiet_mode=True, skip_context_files=True, skip_memory=True,
                                enabled_toolsets=["memory", "skills"], save_trajectories=False, max_iterations=4)
        agent._cached_system_prompt = "Isolated integration prefix."
        agent._disable_streaming = True
        agent._persist_disabled = True
        agent._memory_nudge_interval = agent._skill_nudge_interval = 0
        return agent

    def wait_workers(self):
        deadline = time.monotonic() + 20
        while True:
            workers = [t for t in threading.enumerate() if t.name in ("bg-review", "bg-review-explicit-queue")]
            if not workers:
                break
            for thread in workers:
                thread.join(20)
                self.assertFalse(thread.is_alive(), "native review thread timed out")
            self.assertLess(time.monotonic(), deadline, "native review drain timed out")

    def trigger(self, agent=None, messages=None, **kw):
        (agent or self.agent)._spawn_background_review(
            copy.deepcopy(self.messages if messages is None else messages), **kw)
        self.wait_workers()

    def test_01_foreground_chat_and_exact_duplicate_http_count(self):
        result = self.agent.run_conversation("normal foreground chat")
        self.assertTrue(result["completed"])
        before = len(self.requests)
        self.trigger(review_memory=True)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests) - before, 1)
        self.assertFalse(self.agent._ziwei_bg_dedup_state.in_flight)

    def test_02_new_dialogue_and_tool_usage_run(self):
        self.trigger(review_skills=True)
        self.messages.append({"role": "user", "content": "new information"})
        self.trigger(review_skills=True)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), 3)

    def test_03_explicit_and_bare_refine_bypass_completed_cache(self):
        self.trigger(review_memory=True)
        self.trigger(review_memory=True, explicit=True)
        self.trigger(review_memory=True, explicit=True, focus="save important facts")
        self.assertEqual(len(self.requests), 3)

    def test_04_disabled_native_path_uses_http_each_time(self):
        self.write_config(False)
        self.trigger(review_skills=True)
        self.trigger(review_skills=True)
        self.assertEqual(len(self.requests), 2)

    def test_05_real_idle_queue_coalesces_then_dedups_dispatch(self):
        queue = self.riq.ReviewIdleQueue()
        clock = [0.0]
        queue._now = lambda: clock[0]
        # Drive the native dispatch deterministically; no dispatcher polling thread.
        queue._ensure_thread = lambda: None
        with mock.patch.object(self.riq, "QUEUE", queue), mock.patch.object(self.ra, "_review_should_defer", return_value=True):
            self.agent._spawn_background_review(self.messages, review_memory=True)
            newest = self.messages + [{"role": "user", "content": "latest snapshot"}]
            self.agent._spawn_background_review(newest, review_memory=True)
            self.assertEqual(queue.pending_count(), 1)
            self.assertFalse(self.agent._ziwei_bg_dedup_state.in_flight)
            clock[0] = 2000.0
            item = queue._pop_dispatchable()
            self.assertEqual(item.kwargs["messages_snapshot"], newest)
            item.context.run(queue._dispatch, item)
            self.wait_workers()
            self.assertEqual(len(self.requests), 1)
            self.agent._spawn_background_review(newest, review_memory=True)
            clock[0] = 4000.0
            item = queue._pop_dispatchable()
            item.context.run(queue._dispatch, item)
            self.wait_workers()
            self.assertEqual(len(self.requests), 1)

    def test_06_native_queue_drop_has_no_reservation(self):
        queue = self.riq.ReviewIdleQueue()
        queue._ensure_thread = lambda: None
        with mock.patch.object(self.riq, "QUEUE", queue), mock.patch.object(self.ra, "_review_should_defer", return_value=True):
            self.agent._spawn_background_review(self.messages, review_skills=True)
        item = next(iter(queue._pending.values()))
        self.write_config(True, review_enabled=False)
        item.context.run(queue._dispatch, item)
        self.assertFalse(self.agent._ziwei_bg_dedup_state.in_flight)
        self.assertEqual(len(self.requests), 0)

    def test_07_multisession_concurrent_native_threads(self):
        other = self.make_agent()
        self.mode = "blocked"
        self.agent._spawn_background_review(self.messages, review_skills=True)
        self.assertTrue(self.entered.wait(10))
        other._spawn_background_review(self.messages, review_skills=True)
        self.release.set()
        self.wait_workers()
        self.assertEqual(len(self.requests), 2)
        self.mode = "normal"
        self.trigger(review_skills=True)
        self.trigger(agent=other, review_skills=True)
        self.assertEqual(len(self.requests), 2)

    def test_08_native_http_error_then_recovery(self):
        self.mode = "error"
        self.trigger(review_memory=True)
        count = len(self.requests)
        self.assertGreater(count, 0)
        self.mode = "normal"
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), count + 1)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), count + 1)

    def test_09_cancelled_native_worker_cannot_cache_success(self):
        self.mode = "blocked"
        self.agent._spawn_background_review(self.messages, review_memory=True)
        self.assertTrue(self.entered.wait(10))
        run = self.agent._background_review_run
        run.cancel_requested.set()
        self.release.set()
        self.wait_workers()
        self.mode = "normal"
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), 2)

    def test_10_real_memory_tool_write_is_not_deduplicated(self):
        self.mode = "memory"
        self.agent._memory_enabled = True
        self.agent._user_profile_enabled = True
        self.trigger(review_memory=True)
        self.assertIn("Isolated integration fact", self.agent._memory_store.memory_entries)
        first = len(self.requests)
        self.assertEqual(first, 2)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), first + 2)

    def test_11_native_thread_start_failure_leaves_no_ticket(self):
        with mock.patch.object(self.ra.threading.Thread, "start", side_effect=RuntimeError("test start failure")):
            with self.assertRaises(RuntimeError):
                self.agent._spawn_background_review(self.messages, review_memory=True)
        self.assertFalse(self.agent._ziwei_bg_dedup_state.in_flight)
        self.assertIsNone(self.agent._background_review_run)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), 1)

    def test_12_privacy_audit(self):
        self.trigger(review_memory=True)
        audit = (self.home / dedup.LOG_NAME).read_text()
        self.assertNotIn("private isolated conversation", audit)
        self.assertNotIn("isolated-not-a-live-key", audit)

    def test_13_real_skill_write_and_repeat_are_reviewed(self):
        self.mode = "skill"
        self.trigger(review_skills=True)
        path = self.home / "skills/isolated-review-test/SKILL.md"
        self.assertTrue(path.is_file())
        self.assertIn("Isolated skill", path.read_text())
        self.assertEqual(len(self.requests), 2)
        self.trigger(review_skills=True)
        self.assertEqual(len(self.requests), 4)

    def test_16_real_http_timeout_does_not_poison_next_review(self):
        self.write_config(True, request_timeout=0.05)
        self.mode = "timeout"
        self.trigger(review_memory=True)
        count = len(self.requests)
        self.assertGreater(count, 0)
        self.assertFalse(self.agent._ziwei_bg_dedup_state.in_flight)
        self.mode = "normal"
        self.write_config(True)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), count + 1)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), count + 1)

    def test_17_native_failed_retries_cool_down_and_recover(self):
        self.mode = "error"
        for _ in range(3):
            self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), 3)
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), 3)
        # Advance only the cache's retry deadline; do not alter SDK clocks.
        state = self.agent._ziwei_bg_dedup_state
        with state.lock:
            for entry in state.lanes.values():
                if entry.failures >= dedup.MAX_CONSECUTIVE_FAILURES:
                    entry.retry_at = time.monotonic() - 1
        self.mode = "normal"
        self.trigger(review_memory=True)
        self.assertEqual(len(self.requests), 4)

    def test_18_busy_explicit_queue_works_with_dedup_disabled(self):
        self.write_config(False)
        self.mode = "blocked"
        self.agent._spawn_background_review(self.messages, review_skills=True)
        self.assertTrue(self.entered.wait(10))
        self.agent._spawn_background_review(self.messages, review_skills=True, explicit=True)
        self.release.set()
        self.wait_workers()
        self.assertEqual(len(self.requests), 2)

    def test_21_main_alias_and_authorized_skill_link_use_exact_inputs(self):
        with tempfile.TemporaryDirectory(prefix="external-skill-root-") as outside:
            target = Path(outside)
            path = target / "SKILL.md"
            path.write_text("---\nname: isolated-linked-skill\ndescription: Isolated skill\n---\n# Old skill\n")
            link = self.home / "skills/isolated-linked-skill"
            link.parent.mkdir(exist_ok=True)
            link.symlink_to(target, target_is_directory=True)
            try:
                self.write_config(True, review_options={"provider": "main", "model": "",
                                                       "dedup_skill_link_roots": [str(target)]})
                self.trigger(review_skills=True)
                self.trigger(review_skills=True)
                self.assertEqual(len(self.requests), 1)
                before = path.stat()
                path.write_text(path.read_text().replace("Old", "New"))
                os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
                self.trigger(review_skills=True)
                self.assertEqual(len(self.requests), 2)
            finally:
                link.unlink()

    def test_20_native_startup_exception_is_never_reexecuted(self):
        for enabled, explicit in ((True, True), (False, False), (True, False)):
            with self.subTest(enabled=enabled, explicit=explicit):
                self.write_config(enabled)
                run = self.br.prepare_background_review_run(self.agent)
                self.assertIsNotNone(run)
                target, _ = self.br.spawn_background_review_thread(
                    self.agent, copy.deepcopy(self.messages), review_memory=True,
                    review_run=run, explicit=explicit)
                failure = RuntimeError("isolated native startup failure")
                with mock.patch.object(self.br, "_set_thread_approval_callback", side_effect=failure) as startup:
                    with self.assertRaises(RuntimeError) as raised:
                        target()
                self.assertIs(raised.exception, failure)
                self.assertEqual(startup.call_count, 1)
                self.assertTrue(run.request_done.is_set())
                self.assertIsNone(self.agent._background_review_run)
                self.assertFalse(self.agent._ziwei_bg_dedup_state.in_flight)
        self.assertEqual(len(self.requests), 0)

    def test_22_large_skill_tree_with_missing_links_tracks_all_inputs(self):
        skills = self.home / "skills"
        skills.mkdir(exist_ok=True)
        block = b"x" * (4 * 1024 * 1024)
        for i in range(17):
            (skills / f"support-{i}.bin").write_bytes(block)
        for i in range(2507):
            (skills / f"entry-{i}.txt").write_text("support")
        for i in range(10):
            (skills / f"missing-{i}").symlink_to(skills / f"target-{i}")
        self.write_config(True, review_options={"provider": "main", "model": "",
                                          "dedup_skill_scan_max_bytes": 96 * 1024 * 1024})
        try:
            self.trigger(review_memory=True, review_skills=True)
            self.trigger(review_memory=True, review_skills=True)
            self.assertEqual(len(self.requests), 1)
            path = skills / "support-16.bin"
            before = path.stat()
            with path.open("r+b") as stream:
                stream.seek(-1, 2); stream.write(b"y")
            os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
            self.trigger(review_memory=True, review_skills=True)
            self.assertEqual(len(self.requests), 2)
            (skills / "target-0").write_text("link restored")
            self.trigger(review_memory=True, review_skills=True)
            self.assertEqual(len(self.requests), 3)
            self.messages.append({"role": "user", "content": "new private dialogue"})
            self.trigger(review_memory=True, review_skills=True)
            self.assertEqual(len(self.requests), 4)
        finally:
            for path in skills.iterdir():
                if path.is_file() or path.is_symlink():
                    path.unlink()

    def test_19_real_process_restart_is_cold_and_reviews_again(self):
        script = '''
import threading
import bg_review_dedup as dedup
from run_agent import AIAgent
from agent import background_review as br
assert dedup.install()
built = br.build_cache_parity_fork
def configured(*a, **kw):
    result = built(*a, **kw)
    result[0]._disable_streaming = True
    result[0].save_trajectories = False
    return result
br.build_cache_parity_fork = configured
agent = AIAgent(api_key="isolated-not-a-live-key", provider="custom", model="local-review-test",
                base_url=LOCAL_URL, session_id="restart-test", skip_memory=True,
                skip_context_files=True, enabled_toolsets=["memory", "skills"],
                quiet_mode=True, save_trajectories=False)
agent._cached_system_prompt = "Isolated restart prefix."
agent._spawn_background_review([{"role":"user", "content":"restart-test snapshot"}], review_memory=True)
for thread in list(threading.enumerate()):
    if thread.name == "bg-review":
        thread.join(20)
        assert not thread.is_alive()
assert not agent._ziwei_bg_dedup_state.in_flight
'''
        script = "LOCAL_URL = " + repr(f"http://127.0.0.1:{self.server.server_port}/v1") + "\n" + script
        env = {"PATH": os.environ.get("PATH", ""), "HOME": str(self.home), "HERMES_HOME": str(self.home),
               "HERMES_SKIP_REGISTER_BUILTIN_SKILLS": "1",
               "PYTHONPATH": str(Path(SOURCE).resolve()) + os.pathsep + str(Path(dedup.__file__).parent)}
        for expected in (1, 2):
            result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr[-2000:])
            self.assertEqual(len(self.requests), expected)

    def test_14_queue_preserves_profile_context_into_native_worker(self):
        from hermes_constants import set_hermes_home_override, reset_hermes_home_override
        profile = self.home / "profile"
        profile.mkdir(exist_ok=True)
        (profile / "config.yaml").write_bytes((self.home / "config.yaml").read_bytes())
        queue = self.riq.ReviewIdleQueue()
        queue._ensure_thread = lambda: None
        token = set_hermes_home_override(profile)
        try:
            agent = self.make_agent()
            with mock.patch.object(self.riq, "QUEUE", queue), mock.patch.object(self.ra, "_review_should_defer", return_value=True):
                agent._spawn_background_review(self.messages, review_memory=True)
        finally:
            reset_hermes_home_override(token)
        item = next(iter(queue._pending.values()))
        item.context.run(queue._dispatch, item)
        self.wait_workers()
        self.assertEqual(len(self.requests), 1)
        self.assertTrue((profile / dedup.LOG_NAME).is_file())

    def test_15_busy_native_agent_preserves_explicit_fifo_requests(self):
        self.mode = "blocked"
        self.agent._spawn_background_review(self.messages, review_memory=True)
        self.assertTrue(self.entered.wait(10))
        owner = self.agent._background_review_run
        # Both requests must survive the native busy gate, without replacing
        # the active native token or the automatic task's fingerprint ticket.
        self.agent._spawn_background_review(self.messages, review_memory=True, explicit=True, focus="first focus")
        self.agent._spawn_background_review(self.messages, review_memory=True, explicit=True, focus="second focus")
        self.assertIs(self.agent._background_review_run, owner)
        self.assertFalse(owner.request_done.is_set())
        self.assertEqual(len(self.requests), 1)
        self.release.set()
        self.wait_workers()
        self.assertEqual(len(self.requests), 3)
        self.assertIn("first focus", str(self.requests[1]["messages"]))
        self.assertIn("second focus", str(self.requests[2]["messages"]))
        self.mode = "normal"
        self.trigger(review_memory=True, explicit=True)
        self.assertEqual(len(self.requests), 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
