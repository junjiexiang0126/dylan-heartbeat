"""Integer CNY accounting. Versioned official tariff; never an account invoice.

https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
Verified 2026-10-09. A yuan is 1_000_000_000 nanoyuan.
Use peak ceiling: avoids holiday/time-boundary guesses and under-reservation.
"""
from datetime import datetime, timezone
import json

NANO_PER_YUAN = 1_000_000_000
NANO_PER_FEN = 10_000_000
MAX_BUDGET_FEN = 4000  # Existing test allocation; no automatic increase.
MAX_INPUT_TOKENS = 128000
MAX_OUTPUT_TOKENS = 2048
PRICE_CARD = {'id': 'deepseek-flash-cny-20261009-peak-ceiling',
              'model': 'deepseek-flash', 'hit': 40, 'miss': 2000, 'output': 8000,
              'unit': 'nanoyuan_per_token', 'source': 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
              'expires_utc': '2026-10-16T00:00:00+00:00'}


def check_price_card(now=None):
    if (now or datetime.now(timezone.utc)) >= datetime.fromisoformat(PRICE_CARD['expires_utc']):
        raise ValueError('Price card expired; verify official tariff before new calls')


def integer(value):
    if type(value) is not int or value < 0:
        raise ValueError('Nonnegative integer token count required')
    return value


def request_bounds(encoded, request):
    # UTF-8 bytes bound content tokens; extra allowance covers chat/tool framing.
    messages, tools = request.get('messages'), request.get('tools', [])
    if not isinstance(messages, list) or not 1 <= len(messages) <= 200 or any(not isinstance(m, dict) for m in messages):
        raise ValueError('Bounded messages required')
    if not isinstance(tools, list) or len(tools) > 8 or any(not isinstance(t, dict) for t in tools):
        raise ValueError('Bounded tools required')
    if len(encoded) > 100000:
        raise ValueError('Request byte cap exceeded')
    bound = len(encoded) + 4096 + 64 * len(messages) + 256 * len(tools)
    return min(bound, MAX_INPUT_TOKENS), request['max_tokens']


def reservation(input_bound=MAX_INPUT_TOKENS, output_bound=MAX_OUTPUT_TOKENS):
    check_price_card()
    integer(input_bound); integer(output_bound)
    if not 1 <= input_bound <= MAX_INPUT_TOKENS or not 1 <= output_bound <= MAX_OUTPUT_TOKENS:
        raise ValueError('Token bounds exceeded')
    return input_bound * PRICE_CARD['miss'] + output_bound * PRICE_CARD['output']


def usage_cost(usage, card):
    if not isinstance(usage, dict):
        raise ValueError('Usage missing')
    prompt = integer(usage['prompt_tokens']); output = integer(usage['completion_tokens'])
    if prompt == 0 or output > MAX_OUTPUT_TOKENS or prompt > MAX_INPUT_TOKENS:
        raise ValueError('Usage outside global bounds')
    if 'total_tokens' in usage and integer(usage['total_tokens']) != prompt + output:
        raise ValueError('Usage totals inconsistent')
    hit = usage.get('prompt_cache_hit_tokens')
    miss = usage.get('prompt_cache_miss_tokens')
    details = usage.get('prompt_tokens_details')
    nested = details.get('cached_tokens') if isinstance(details, dict) else None
    if hit is None: hit = nested
    if hit is None and miss is not None: hit = prompt - integer(miss)
    if hit is None: hit = 0  # Missing cache details: all input charged at miss ceiling.
    hit = integer(hit)
    if hit > prompt or (miss is not None and integer(miss) != prompt - hit) or (nested is not None and integer(nested) != hit):
        raise ValueError('Cache counts inconsistent')
    cost = hit * card['hit'] + (prompt - hit) * card['miss'] + output * card['output']
    return cost, prompt, output, hit


def ceil_fen(nano):
    return (nano + NANO_PER_FEN - 1) // NANO_PER_FEN
