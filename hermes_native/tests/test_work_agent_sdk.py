"""Real SDK + official Hermes request transform, with HTTP transport mocked.

These contract checks make no external/model calls. Run in the native image, or
with its dependencies and source on PYTHONPATH. Plain lightweight unit runs skip.
"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

try:
    import httpx
    from openai import OpenAI
    from agent.sdk_transform_bypass import bypass_chat_sdk_request_transform
    AVAILABLE = True
except ImportError:
    AVAILABLE = False

spec = importlib.util.spec_from_file_location('work_agent_sdk_test', Path(__file__).parents[1] / 'work_agent.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(AVAILABLE, 'requires the official Hermes source and OpenAI SDK')
class RequestClientContract(unittest.TestCase):
    def execute(self, repeat=False):
        seen = []
        clients = []
        def handler(request):
            seen.append(json.loads(request.content))
            return httpx.Response(200, json={
                'id':'chatcmpl-contract', 'object':'chat.completion', 'created':1,
                'model':'deepseek-flash', 'choices':[{'index':0, 'finish_reason':'stop',
                    'message':{'role':'assistant', 'content':'{"message":"委派","instruction":"完成任务"}'}}],
                'usage':{'prompt_tokens':10,'completion_tokens':20,'total_tokens':30}})
        class Agent:
            def __init__(self, skip_memory=None, skip_context_files=None, skip_background_review=None, max_tokens=None, **kwargs):
                self.client = self._create_openai_client()
                self.tools = []
            def _create_openai_client(self, *args, **kwargs):
                client = OpenAI(api_key='isolated-contract-fixture', base_url='https://api.deepseek.com/v1',
                    http_client=httpx.Client(transport=httpx.MockTransport(handler)))
                clients.append(client)
                return client
            def _create_request_openai_client(self, **kwargs):
                return self._create_openai_client()
            def run_conversation(self, **kwargs):
                result = None
                for _ in range(2 if repeat else 1):
                    client = self._create_request_openai_client(reason='chat_completion_request')
                    request = bypass_chat_sdk_request_transform({
                        'model':'deepseek-flash','messages':[{'role':'user','content':kwargs['user_message']}],
                        'max_tokens':999999,'extra_body':{'max_tokens':999999}}, client)
                    result = client.chat.completions.create(**request)
                self.session_input_tokens = result.usage.prompt_tokens
                self.session_output_tokens = result.usage.completion_tokens
                return {'final_response':result.choices[0].message.content}
            def close(self):
                for client in clients:
                    client.close()
        gateway = types.ModuleType('gateway.run')
        gateway._resolve_runtime_agent_kwargs = lambda: {'base_url':'https://api.deepseek.com/v1'}
        gateway._resolve_gateway_model = lambda: 'deepseek-flash'
        agent_module = types.ModuleType('run_agent')
        agent_module.AIAgent = Agent
        with patch.dict(sys.modules, {'gateway.run':gateway,'run_agent':agent_module}), patch.dict(os.environ):
            return worker.execute({'stage':'plan','task':'SDK compatibility check'}), seen

    def test_official_request_transform_preserves_guarded_payload_and_token_ceiling(self):
        result, seen = self.execute()
        self.assertEqual(result['calls'], 1)
        self.assertEqual(result['usage'], {'prompt_tokens':10,'completion_tokens':20})
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0]['max_tokens'], 1500)
        self.assertIn('SDK compatibility check', seen[0]['messages'][0]['content'])

    def test_new_sdk_client_cannot_reset_the_work_call_budget(self):
        with self.assertRaisesRegex(RuntimeError, 'work_model_call_limit'):
            self.execute(repeat=True)


if __name__ == '__main__':
    unittest.main()
