"""One bounded native Hermes turn, without tools, private transcripts or memory writes."""
import contextlib
import inspect
import json
import os
import sys


def execute(payload):
    sys.path.insert(0, os.environ.get('HERMES_PYTHON_SRC_ROOT', '/opt/ziwei-runtime/current'))
    from gateway.run import _resolve_runtime_agent_kwargs, _resolve_gateway_model
    from run_agent import AIAgent
    runtime = _resolve_runtime_agent_kwargs()
    runtime.pop('_fallback_notice', None)
    model = runtime.pop('model', None) or _resolve_gateway_model()
    if model != 'deepseek-flash' or runtime.get('base_url', '').rstrip('/') != 'https://api.deepseek.com/v1':
        raise RuntimeError('work_pricing_model_not_allowed')
    required = {'skip_memory', 'skip_context_files', 'skip_background_review', 'max_tokens'}
    if not required <= inspect.signature(AIAgent.__init__).parameters.keys():
        raise RuntimeError('work_isolation_unsupported')
    agent = AIAgent(model=model, **runtime, max_iterations=1, max_tokens=900,
                   enabled_toolsets=[], disabled_toolsets=['all'],
                   skip_memory=True, skip_background_review=True, skip_context_files=True,
                   quiet_mode=True, verbose_logging=False, save_trajectories=False,
                   session_id=None, session_db=None, fallback_model=None,
                   ephemeral_system_prompt='你是知微，Hermes 主 Agent。本轮仅处理 Work 工作资料，不读取私人聊天。'
                   '你负责委派白鸦及审核结果。不得执行工具或写记忆。仅返回严格 JSON。'
                   'plan 阶段返回 {"message":"给用户的简短说明","instruction":"给白鸦的具体任务"}；'
                   'review 阶段返回 {"approved":true或false,"message":"审核意见与最终交付说明"}。'
                   'message 可以补充可选 messages 字符串数组来自主选择多个完整气泡。'
                   '审核内容是否满足用户要求，无法核实的外部事实不要宣称验证通过。')
    if getattr(agent, 'tools', None) or getattr(agent, 'tool_names', None):
        raise RuntimeError('work_tool_isolation_failed')
    client = getattr(agent, 'client', None)
    if not client or not hasattr(client, 'chat') or not hasattr(client, 'max_retries'):
        raise RuntimeError('work_call_guard_unsupported')
    client.max_retries = 0
    original = client.chat.completions.create
    calls = 0
    def once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise RuntimeError('work_model_call_limit')
        if kwargs.get('tools'):
            raise RuntimeError('work_tools_forbidden')
        if len(json.dumps(kwargs.get('messages', []), ensure_ascii=False).encode()) > 48000:
            raise RuntimeError('work_context_limit')
        extra = dict(kwargs.get('extra_body') or {})
        if any(key in extra for key in ('messages', 'tools', 'tool_choice')):
            raise RuntimeError('work_request_override_forbidden')
        if 'max_tokens' in extra:
            extra['max_tokens'] = 900
        if extra:
            kwargs['extra_body'] = extra
        kwargs['max_tokens'] = 900
        return original(*args, **kwargs)
    client.chat.completions.create = once
    try:
        result = agent.run_conversation(user_message=json.dumps(payload, ensure_ascii=False), conversation_history=[])
        if calls != 1 or not isinstance(result, dict) or result.get('error'):
            raise RuntimeError('work_agent_failed')
        text = result.get('final_response', '')
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError('work_empty_response')
        return {'text': text, 'model': model, 'calls': calls,
                'usage': {'prompt_tokens': getattr(agent, 'session_input_tokens', None),
                          'completion_tokens': getattr(agent, 'session_output_tokens', None)}}
    finally:
        if hasattr(agent, 'close'):
            agent.close()

if __name__ == '__main__':
    payload = json.loads(sys.stdin.buffer.read(24001))
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = execute(payload)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        allowed = {'work_pricing_model_not_allowed','work_isolation_unsupported','work_tool_isolation_failed','work_call_guard_unsupported','work_model_call_limit','work_tools_forbidden','work_context_limit','work_request_override_forbidden','work_agent_failed','work_empty_response'}
        print(json.dumps({'error':str(exc) if str(exc) in allowed else 'work_agent_failed'}))
        sys.exit(1)
