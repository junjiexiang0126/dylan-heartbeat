"""Protocol/guard tests use a fake native agent; these are not live model tests."""
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('work_agent_test', Path(__file__).parents[1] / 'work_agent.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkAgent(unittest.TestCase):
    def run_worker(self, repeat=False, tools=None, check_only=False):
        seen = {}
        class Agent:
            def __init__(self, skip_memory=None, skip_context_files=None, skip_background_review=None, max_tokens=None, **kwargs):
                seen.update(kwargs, skip_memory=skip_memory, skip_context_files=skip_context_files, skip_background_review=skip_background_review, max_tokens=max_tokens)
                self.tools = tools
                self.client = types.SimpleNamespace(max_retries=2, chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=lambda **kw: seen.update(request=kw))))
            def run_conversation(self, **kwargs):
                seen['conversation'] = kwargs
                self.client.chat.completions.create(messages=[{'role':'user','content':'Work only'}])
                if repeat:
                    self.client.chat.completions.create(messages=[])
                return {'final_response':json.dumps({'message':'审核','approved':True})}
            def close(self):
                seen['closed'] = True
        module = types.ModuleType('run_agent');module.AIAgent = Agent
        gateway = types.ModuleType('gateway.run')
        gateway._resolve_runtime_agent_kwargs = lambda: {'api_key':'fixture','base_url':'https://api.deepseek.com/v1'}
        gateway._resolve_gateway_model = lambda: 'deepseek-flash'
        with patch.dict(sys.modules, {'run_agent':module,'gateway.run':gateway}):
            return worker.execute({'stage':'plan','task':'普通工作'}, check_only=check_only), seen
    def test_connection_check_makes_zero_model_calls(self):
        result, seen = self.run_worker(check_only=True)
        self.assertTrue(result['ready']); self.assertEqual(result['calls'], 0)
        self.assertNotIn('conversation', seen); self.assertTrue(seen['closed'])
    def test_errors_expose_only_phase_and_type(self):
        worker.PHASE = 'runtime'
        error = worker.safe_error(TypeError('sensitive-provider-token-and-user-prompt'))
        self.assertEqual(error, 'work_runtime_TypeError')
        self.assertEqual(worker.safe_error(RuntimeError('work_tool_isolation_failed')), 'work_tool_isolation_failed')
    def test_subprocess_activates_official_dependencies_before_overlay(self):
        from unittest.mock import MagicMock
        bootstrap = types.ModuleType('hermes_bootstrap')
        with patch.dict(sys.modules, {'hermes_bootstrap':bootstrap}), patch.object(sys, 'path', []) as paths:
            worker.activate_runtime()
            self.assertEqual(paths[-1], '/opt/hermes')
            self.assertEqual(paths[0], '/opt/ziwei-runtime/current')
    def test_no_private_history_memory_writes_or_tools(self):
        result, seen = self.run_worker()
        self.assertTrue(seen['skip_memory']);self.assertTrue(seen['skip_context_files']);self.assertTrue(seen['skip_background_review'])
        self.assertEqual(seen['enabled_toolsets'],[]);self.assertEqual(seen['max_iterations'],1)
        self.assertEqual(seen['conversation']['conversation_history'],[])
        self.assertIsNone(seen['session_db']);self.assertEqual(seen['request']['max_tokens'],1500)
        self.assertEqual(result['calls'],1);self.assertTrue(seen['closed'])
    def test_extra_model_call_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError,'work_model_call_limit'):
            self.run_worker(repeat=True)
    def test_accidentally_enabled_tools_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError,'work_tool_isolation_failed'):
            self.run_worker(tools=['shell'])

if __name__ == '__main__':
    unittest.main()
