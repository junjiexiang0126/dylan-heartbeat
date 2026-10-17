"""Protocol/guard tests use a fake native agent; these are not live model tests."""
import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('work_agent_test', Path(__file__).parents[1] / 'work_agent.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkAgent(unittest.TestCase):
    def run_worker(self, repeat=False, tools=None, check_only=False, request_factory=False, override=None, swallow=False, finish='stop', content='{"approved":true}', wire_error=None, presented=None):
        seen = {}
        class Agent:
            def __init__(self, skip_memory=None, skip_context_files=None, skip_background_review=None, max_tokens=None, **kwargs):
                seen.update(kwargs, skip_memory=skip_memory, skip_context_files=skip_context_files, skip_background_review=skip_background_review, max_tokens=max_tokens)
                self.tools = tools
                self.client = self._create_openai_client()
            def _create_openai_client(self, *args, **kwargs):
                def wire(**kw):
                    seen['wire_calls'] = seen.get('wire_calls', 0) + 1
                    seen.update(request=kw)
                    if wire_error:
                        raise wire_error
                    return types.SimpleNamespace(choices=[types.SimpleNamespace(finish_reason=finish,
                        message=types.SimpleNamespace(content=content, tool_calls=None))],
                        usage=types.SimpleNamespace(prompt_tokens=40, completion_tokens=20))
                return types.SimpleNamespace(max_retries=2, base_url='https://api.deepseek.com/v1/', chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=wire)))
            def _create_request_openai_client(self, **kwargs):
                return self._create_openai_client()
            def run_conversation(self, **kwargs):
                seen['conversation'] = kwargs
                seen['runtime_flags'] = (self._api_max_retries, self._auto_recovery_cycles, self._disable_streaming)
                client = self._create_request_openai_client(reason='chat_completion_request') if request_factory else self.client
                seen['request_retries'] = client.max_retries
                try:
                    client.chat.completions.create(messages=[{'role':'user','content':'Work only'}], **(override or {}))
                    if repeat:
                        client = self._create_request_openai_client(reason='retry') if request_factory else self.client
                        client.chat.completions.create(messages=[])
                except RuntimeError:
                    if not swallow:
                        raise
                    # Hermes may swallow a first error and ask for a summary.
                    try:
                        self._create_request_openai_client(reason='iteration_summary').chat.completions.create(messages=[])
                    except RuntimeError:
                        pass
                self.session_input_tokens = 40
                self.session_output_tokens = 20
                return {'final_response':presented or json.dumps({'message':'审核','approved':True})}
            def close(self):
                seen['closed'] = True
        module = types.ModuleType('run_agent');module.AIAgent = Agent
        gateway = types.ModuleType('gateway.run')
        gateway._resolve_runtime_agent_kwargs = lambda: {'api_key':'fixture','base_url':'https://api.deepseek.com/v1'}
        gateway._resolve_gateway_model = lambda: 'deepseek-flash'
        with patch.dict(sys.modules, {'run_agent':module,'gateway.run':gateway}), patch.dict(os.environ):
            return worker.execute({'stage':'plan','task':'普通工作'}, check_only=check_only), seen
    def test_request_local_client_is_guarded_and_its_usage_is_returned(self):
        result, seen = self.run_worker(request_factory=True)
        self.assertEqual(seen['wire_calls'], 1);self.assertEqual(result['calls'], 1)
        self.assertEqual(seen['request_retries'], 0);self.assertEqual(seen['runtime_flags'], (1,0,True))
        self.assertEqual(result['usage'], {'prompt_tokens':40,'completion_tokens':20})
    def test_different_request_clients_share_one_model_call_limit(self):
        with self.assertRaisesRegex(RuntimeError, 'work_model_call_limit'):
            self.run_worker(request_factory=True, repeat=True)
    def test_request_local_client_rejects_sdk_body_overrides(self):
        with self.assertRaisesRegex(RuntimeError, 'work_request_override_forbidden'):
            self.run_worker(request_factory=True, override={'extra_body':{'messages':[{'role':'user','content':'override'}]}})
    def test_swallowed_guard_error_still_fails_the_whole_turn(self):
        with self.assertRaisesRegex(RuntimeError, 'work_model_call_limit'):
            self.run_worker(request_factory=True, repeat=True, swallow=True)
    def test_connection_check_makes_zero_model_calls(self):
        result, seen = self.run_worker(check_only=True)
        self.assertTrue(result['ready']); self.assertEqual(result['calls'], 0)
        self.assertNotIn('conversation', seen); self.assertTrue(seen['closed'])
    def test_work_explicitly_disables_thinking_and_requests_bounded_json(self):
        _, seen = self.run_worker(override={'reasoning_effort':'high','stream':True,
            'extra_body':{'thinking':{'type':'enabled'},'reasoning':{'enabled':True}}})
        self.assertEqual(seen['reasoning_config'], {'enabled':False})
        self.assertEqual(seen['request']['extra_body'], {'thinking':{'type':'disabled'}})
        self.assertNotIn('reasoning_effort', seen['request'])
        self.assertFalse(seen['request']['stream'])
        self.assertEqual(seen['request']['response_format'], {'type':'json_object'})
    def test_truncation_cause_survives_swallowed_recovery(self):
        with self.assertRaisesRegex(RuntimeError, 'work_output_limit'):
            self.run_worker(finish='length', content='', swallow=True)
    def test_empty_response_cause_survives_swallowed_recovery(self):
        with self.assertRaisesRegex(RuntimeError, 'work_empty_response'):
            self.run_worker(content='', swallow=True)
    def test_original_provider_error_is_safe_and_survives_swallowed_recovery(self):
        error_class = type('AuthenticationError', (Exception,), {})
        with self.assertRaisesRegex(RuntimeError, '^work_conversation_AuthenticationError$') as raised:
            self.run_worker(wire_error=error_class('secret key and private prompt'), swallow=True)
        self.assertEqual(worker.safe_error(raised.exception), 'work_conversation_AuthenticationError')
    def test_content_refusal_is_not_delivered(self):
        with self.assertRaisesRegex(RuntimeError, 'work_provider_refusal'):
            self.run_worker(finish='content_filter')
    def test_work_command_is_not_changed_by_natural_language_output_hooks(self):
        command={'approved':False,'message':'必须修正，不能交付'}
        result, seen=self.run_worker(content=json.dumps(command,ensure_ascii=False),presented='用于聊天显示的格式，无法当JSON解析')
        self.assertEqual(json.loads(result['text']),command)
        self.assertEqual(seen['wire_calls'],1)
    def test_complete_document_with_literal_newlines_is_losslessly_canonicalized(self):
        text='## 第1页 标题\n正文包含"引号"、竖线 | 与反斜线 \\。\n## 第2页 标题\n第二页正文'
        command={'approved':True,'message':'已修订，未做视觉检查','toolCall':{'name':'work_document_create','arguments':{'text':text}}}
        raw=json.dumps(command,ensure_ascii=False).replace('\\n','\n')
        result, seen=self.run_worker(content=raw)
        self.assertEqual(json.loads(result['text']),command)
        self.assertEqual(seen['wire_calls'],1)
    def test_partial_or_prose_commands_never_become_approved_json(self):
        for raw in ['{"approved":true','说明：{"approved":true}', '[{"approved":true}]','{"approved":true,"message":"unfinished']:
            with self.subTest(raw=raw),self.assertRaisesRegex(RuntimeError,'work_response_invalid'):
                self.run_worker(content=raw,swallow=True)
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
