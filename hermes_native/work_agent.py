"""One bounded native Hermes turn, without tools, private transcripts or memory writes."""
import contextlib
import inspect
import json
import os
import sys
import threading

PHASE = 'bootstrap'
ALLOWED_ERRORS = {'work_pricing_model_not_allowed','work_isolation_unsupported','work_tool_isolation_failed','work_call_guard_unsupported','work_model_call_limit','work_tools_forbidden','work_context_limit','work_request_override_forbidden','work_agent_failed','work_empty_response','work_output_limit','work_response_invalid','work_provider_refusal'}
SAFE_EXCEPTION_TYPES = {'ImportError','ModuleNotFoundError','TypeError','ValueError','RuntimeError','AttributeError','AuthenticationError','APIConnectionError','APITimeoutError','BadRequestError','RateLimitError','Error'}
SAFE_PHASES = {'bootstrap','imports','runtime','initialization','conversation'}

def activate_runtime():
    """A fresh subprocess needs the same dependency activation as the Gateway."""
    sys.path.insert(0, '/opt/hermes')
    import hermes_bootstrap  # Activates the official managed dependency generation.
    sys.path.insert(0, os.environ.get('HERMES_PYTHON_SRC_ROOT', '/opt/ziwei-runtime/current'))

def safe_error(exc):
    if str(exc) in ALLOWED_ERRORS or str(exc) in {
        'work_' + phase + '_' + kind for phase in SAFE_PHASES for kind in SAFE_EXCEPTION_TYPES
    }:
        return str(exc)
    # Never include exception text: provider errors can contain credentials/prompts.
    kind = type(exc).__name__
    if kind not in SAFE_EXCEPTION_TYPES:
        kind = 'Error'
    return 'work_' + PHASE + '_' + kind


def execute(payload, check_only=False):
    global PHASE
    PHASE = 'imports'
    sys.path.insert(0, os.environ.get('HERMES_PYTHON_SRC_ROOT', '/opt/ziwei-runtime/current'))
    from gateway.run import _resolve_runtime_agent_kwargs, _resolve_gateway_model
    from run_agent import AIAgent
    PHASE = 'runtime'
    runtime = _resolve_runtime_agent_kwargs()
    runtime.pop('_fallback_notice', None)
    # Work returns a bounded JSON command. Do not inherit a private profile's
    # thinking budget: DeepSeek defaults to thinking on when unspecified.
    runtime['reasoning_config'] = {'enabled': False}
    model = runtime.pop('model', None) or _resolve_gateway_model()
    if model != 'deepseek-flash' or runtime.get('base_url', '').rstrip('/') != 'https://api.deepseek.com/v1':
        raise RuntimeError('work_pricing_model_not_allowed')
    required = {'skip_memory', 'skip_context_files', 'skip_background_review', 'max_tokens'}
    if not required <= inspect.signature(AIAgent.__init__).parameters.keys():
        raise RuntimeError('work_isolation_unsupported')
    output_limit = 1500 if payload.get('stage') == 'plan' else 6000
    # Keep messages in the typed SDK arguments so the guard checks the actual
    # payload. Hermes otherwise moves them into extra_body as an optimization.
    # This environment belongs only to this isolated subprocess.
    os.environ['HERMES_CODEX_SDK_TRANSFORM'] = '1'
    PHASE = 'initialization'
    agent = AIAgent(model=model, **runtime, max_iterations=1, max_tokens=output_limit,
                   enabled_toolsets=[], disabled_toolsets=['all'],
                   skip_memory=True, skip_background_review=True, skip_context_files=True,
                   quiet_mode=True, verbose_logging=False, save_trajectories=False,
                   session_id=None, session_db=None, fallback_model={},
                   ephemeral_system_prompt='你是知微，Hermes 主 Agent。本轮仅处理 Work 工作资料，不读取私人聊天。'
                   '你负责委派白鸦及审核结果。不使用私人聊天工具或写记忆。只调用本轮 Work 专用工具，以严格 JSON 命令返回。'
                   'plan 阶段调用委派工具，返回 {"message":"给用户的说明","toolCall":{"name":"work_delegate","arguments":{"instruction":"具体任务","tool":"工具ID或auto"}}}。'
                   '工具只能选用户明确指定的，或 availableTools 已授权列表。无需文件时选 auto。'
                   'review 阶段根据正文和实际文件检查回执审核，返回 {"approved":true或false,"message":"审核意见与最终交付说明",'
                   '"toolCall":{"name":"work_document_deliver","arguments":{}}}。不通过时省略 toolCall。'
                   '若需亲自修订文档，approved 为 true 并改用 work_document_create 工具，arguments 为 {"text":"完整修订正文"}，程序生成并检查后交付。'
                   '不通过时给出白鸦可直接执行的具体修改要求。需要用户补充资料时返回 requiresUser:true，否则程序最多安排两轮修订。'
                   '文件 visualChecked 为 false 时，不得宣称已检查视觉排版。'
                   'message 可以补充可选 messages 字符串数组来自主选择多个完整气泡。'
                   '审核内容是否满足用户要求，无法核实的外部事实不要宣称验证通过。')
    if getattr(agent, 'tools', None) or getattr(agent, 'tool_names', None):
        raise RuntimeError('work_tool_isolation_failed')
    client = getattr(agent, 'client', None)
    if not client or not hasattr(client, 'chat') or not hasattr(client, 'max_retries'):
        raise RuntimeError('work_call_guard_unsupported')
    calls = 0
    call_lock = threading.Lock()
    clients = []
    violation = None
    response_usage = None
    def guard_client(request_client):
        if any(request_client is prior for prior in clients):
            return request_client
        if not hasattr(request_client, 'max_retries') or not hasattr(request_client, 'chat'):
            raise RuntimeError('work_call_guard_unsupported')
        if hasattr(request_client, 'base_url') and str(request_client.base_url).rstrip('/') != 'https://api.deepseek.com/v1':
            raise RuntimeError('work_pricing_model_not_allowed')
        clients.append(request_client)
        request_client.max_retries = 0
        original = request_client.chat.completions.create
        def once(*args, **kwargs):
            nonlocal calls, violation, response_usage
            # Preserve the first cause if Hermes tries an empty/length recovery
            # or its extra iteration-limit summary. No second wire call occurs.
            if violation:
                raise RuntimeError(violation)
            with call_lock:
                calls += 1
            def reject(code):
                nonlocal violation
                violation = code
                raise RuntimeError(code)
            if calls > 1:
                reject('work_model_call_limit')
            if kwargs.get('model', model) != model:
                reject('work_pricing_model_not_allowed')
            if kwargs.get('tools'):
                reject('work_tools_forbidden')
            if len(json.dumps(kwargs.get('messages', []), ensure_ascii=False).encode()) > 180000:
                reject('work_context_limit')
            extra = dict(kwargs.get('extra_body') or {})
            if any(key in extra for key in ('messages', 'tools', 'tool_choice', 'model', 'max_completion_tokens', 'max_output_tokens', 'stream')):
                reject('work_request_override_forbidden')
            if 'max_tokens' in extra:
                extra['max_tokens'] = output_limit
            extra['thinking'] = {'type': 'disabled'}
            extra.pop('reasoning_effort', None)
            extra.pop('reasoning', None)
            extra.pop('response_format', None)
            extra.pop('stream_options', None)
            kwargs['extra_body'] = extra
            kwargs.pop('reasoning_effort', None)
            kwargs.pop('stream_options', None)
            kwargs.pop('max_completion_tokens', None)
            kwargs['max_tokens'] = output_limit
            kwargs['stream'] = False
            kwargs['response_format'] = {'type': 'json_object'}
            try:
                response = original(*args, **kwargs)
            except Exception as exc:
                # safe_error returns phase/type only; never provider text, keys,
                # prompts, or response bodies. Keep it across swallowed retries.
                violation = safe_error(exc)
                raise RuntimeError(violation) from None
            choices = getattr(response, 'choices', None)
            if not choices or len(choices) != 1:
                reject('work_response_invalid')
            choice = choices[0]
            finish = getattr(choice, 'finish_reason', None)
            if finish == 'length':
                reject('work_output_limit')
            if finish == 'content_filter':
                reject('work_provider_refusal')
            message = getattr(choice, 'message', None)
            if getattr(message, 'tool_calls', None):
                reject('work_tools_forbidden')
            content = getattr(message, 'content', None)
            if not isinstance(content, str) or not content.strip():
                reject('work_empty_response')
            if finish != 'stop':
                reject('work_response_invalid')
            usage = getattr(response, 'usage', None)
            response_usage = {'prompt_tokens': getattr(usage, 'prompt_tokens', None),
                              'completion_tokens': getattr(usage, 'completion_tokens', None)}
            return response
        request_client.chat.completions.create = once
        return request_client
    guard_client(client)
    # Current Hermes creates a separate client for every request. Cover both
    # construction and cache checkout; all clients share the same call budget.
    def guard_factory(original):
        def create(*args, **kwargs):
            return guard_client(original(*args, **kwargs))
        return create
    for name in ('_create_openai_client', '_create_request_openai_client'):
        factory = getattr(agent, name, None)
        if callable(factory):
            setattr(agent, name, guard_factory(factory))
    agent._api_max_retries = 1
    agent._auto_recovery_cycles = 0
    agent._disable_streaming = True
    try:
        if check_only:
            return {'ready': True, 'model': model, 'calls': 0, 'privateHistory': False, 'memoryWrites': False}
        PHASE = 'conversation'
        result = agent.run_conversation(user_message=json.dumps(payload, ensure_ascii=False), conversation_history=[])
        if violation:
            raise RuntimeError(violation)
        if calls != 1 or not isinstance(result, dict) or result.get('error'):
            raise RuntimeError('work_agent_failed')
        text = result.get('final_response', '')
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError('work_empty_response')
        return {'text': text, 'model': model, 'calls': calls,
                'usage': response_usage}
    finally:
        if hasattr(agent, 'close'):
            agent.close()

if __name__ == '__main__':
    try:
        with contextlib.redirect_stdout(sys.stderr):
            activate_runtime()
            result = execute({} if '--check' in sys.argv else json.loads(sys.stdin.buffer.read(160001)), check_only='--check' in sys.argv)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'error': safe_error(exc)}))
        sys.exit(1)
