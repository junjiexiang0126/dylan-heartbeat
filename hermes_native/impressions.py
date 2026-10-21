"""Automatic read-only activity projection over durable Hermes receipts.

No model calls, no duplicate activity store, no agent-written impression needed.
Only structured tool results confirm success; commands and private text stay private.
"""
import base64
from contextlib import closing
import hashlib
import json
import sqlite3
import shlex
from pathlib import Path
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

TZ = timezone(timedelta(hours=7))
GARDEN_HOST = 'galatea.abysslumina.com'
MAX_MESSAGES = 20000
MAX_SOURCE_BYTES = 8 * 1024 * 1024


def stamp(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, TZ).isoformat()
    dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return (dt.replace(tzinfo=TZ) if dt.tzinfo is None else dt.astimezone(TZ)).isoformat()


def identity(source, key):
    return 'auto-' + hashlib.sha256((source + ':' + str(key)).encode()).hexdigest()[:24]


def event(source, key, at, kind, title, summary='', state='recorded', **extra):
    return dict(id=identity(source, key), ts=stamp(at), kind=kind, title=title,
                summary=summary, state=state, source=source, automatic=True, **extra)


def outcome(result):
    if not isinstance(result, dict): return 'recorded'
    if result.get('error') or result.get('success') is False or result.get('status') in ('failed', 'error'): return 'failed'
    if result.get('status') in ('running', 'pending') or result.get('process_id') and result.get('exit_code') is None: return 'in_progress'
    if result.get('exit_code') is not None: return 'completed' if result['exit_code'] == 0 else 'failed'
    if result.get('success') is True or result.get('status') in ('success', 'completed'): return 'completed'
    return 'recorded'


def garden_url(value):
    try:
        url = urlsplit(str(value))
        return url.scheme in ('http', 'https') and url.hostname == GARDEN_HOST
    except ValueError: return False


def tool_activity(name, args, result):
    if not isinstance(name, str): return None
    state = outcome(result)
    if name in ('tool_call', 'tool_search', 'tool_describe'): return None
    # Domain events have stronger evidence and are projected separately.
    if name in ('ziwei_moment', 'ziwei_briefing'):
        if state != 'failed': return None
        return ('moments' if name == 'ziwei_moment' else 'activity', '尝试发布朋友圈' if name == 'ziwei_moment' else '尝试保存活动小记', '没有完成', 'failed')
    if name == 'ziwei_status':
        if isinstance(result, dict) and result.get('source') == 'ziwei' and result.get('state') in ('在工作','在休息','在思考','在想你'):
            return 'status', result['state'], '知微更新了当前状态', 'recorded'
        return None
    if name.startswith('browser') or name in ('web_search', 'web_extract'):
        kind, title = ('garden', '逛小花园') if garden_url(args.get('url', '')) else ('browse', '浏览资料')
    elif name in ('memory', 'memory_manage'):
        if args.get('action') in ('read', 'list', 'search', 'view'): return None
        kind, title = 'memory', '整理记忆'
    elif name in ('write_file', 'patch', 'edit_file', 'apply_patch'):
        paths = result.get('files_modified', []) if isinstance(result, dict) else []
        if not isinstance(paths, list): paths = []
        path = str(args.get('path') or args.get('file_path') or '')
        if any('/diary/' in '/' + str(p) or '默记' in str(p) or '/private/' in '/' + str(p) for p in [path, *paths]): return None
        kind, title = ('work', '维护代码') if any(Path(str(p)).suffix in ('.py','.js','.ts','.tsx','.jsx','.css','.html','.sh','.json','.yaml','.yml') for p in [path, *paths]) else ('file', '修改工作文件')
    elif name in ('terminal', 'execute_code', 'process'):
        kind, title = 'work', '执行工作操作'
        # Recognize only an actual curl/wget invocation with the exact garden host.
        # Shell success alone is not proof an HTTP page or a post succeeded.
        try: words = shlex.split(str(args.get('command') or ''))
        except ValueError: words = []
        if words and Path(words[0]).name in ('curl', 'wget') and any(garden_url(w) for w in words[1:]):
            kind, title = 'garden', '访问小花园接口'
            if state == 'completed': state = 'recorded'
        elif words and Path(words[0]).name == 'git':
            title = '查看代码状态' if any(w in ('status','diff','log','show') for w in words[1:]) else '维护代码仓库'
        elif words and Path(words[0]).name in ('pytest','ruff','mypy'):
            title = '检查代码'
    elif name in ('read_file', 'search_files', 'search', 'grep', 'list_directory'):
        kind, title = 'browse', '查看工作资料'
    elif name in ('kanban', 'kanban_manage'):
        kind, title = 'work', '处理任务进展'
    else:
        kind, title = 'activity', '使用工具进行一项操作'
    summary = {'failed': '没有完成', 'in_progress': '仍在进行', 'recorded': '已收到执行记录', 'completed': '已完成'}[state]
    return kind, title, summary, state


def native_activity(home, errors, since=None):
    path = home / 'state.db'
    if not path.exists() or path.is_symlink():
        errors.append({'source': 'native_activity', 'code': 'source_unavailable'})
        return []
    rows = []
    try:
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
            db.row_factory = sqlite3.Row
            deadline = time.monotonic() + 2
            db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            sessions = db.execute("SELECT id, started_at, ended_at, end_reason FROM sessions WHERE source='cron' AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at DESC LIMIT 2001", (datetime.fromisoformat(since).timestamp() if since else 0,)).fetchall()
            remaining = MAX_MESSAGES
            bytes_left = MAX_SOURCE_BYTES
            if len(sessions) > 2000: errors.append({'source': 'native_activity', 'code': 'history_window_limit'})
            for session in sessions[:2000]:
                sid, ended = session['id'], session['ended_at']
                reason = str(session['end_reason'] or '')
                state = 'failed' if any(s in reason.lower() for s in ('error', 'fail', 'timeout', 'cancel', 'interrupt', 'incomplete')) else 'recorded' if ended else 'in_progress'
                rows.append(event('native_session', sid, session['started_at'], 'wake', '自主活动', '本次运行已结束' if ended else '已开始，等待运行结果', state, runId=sid))
                if remaining <= 0 or bytes_left <= 0:
                    errors.append({'source': 'native_activity', 'code': 'history_window_limit'})
                    break
                messages = db.execute("SELECT id, role, tool_name, tool_call_id, substr(tool_calls,1,65536) AS tool_calls, substr(content,1,65536) AS content, timestamp FROM messages WHERE session_id=? AND role IN ('assistant','tool') ORDER BY id DESC LIMIT ?", (sid, remaining + 1))
                bounded = []
                for message in messages:
                    bytes_left -= len((message["content"] or "").encode()) + len((message["tool_calls"] or "").encode())
                    if bytes_left < 0:
                        errors.append({"source":"native_activity","code":"history_window_limit"})
                        break
                    bounded.append(message)
                messages = bounded
                if len(messages) > remaining: errors.append({'source': 'native_activity', 'code': 'history_window_limit'})
                messages = messages[:remaining]
                remaining -= len(messages)
                calls, completed = {}, set()
                for m in reversed(messages):
                    if m['role'] == 'assistant':
                        try:
                            cs = json.loads(m['tool_calls'] or '[]')
                            for call in cs if isinstance(cs, list) else []:
                                f = call.get('function', {})
                                args = f.get('arguments', {})
                                if isinstance(args, str): args = json.loads(args)
                                if isinstance(args, dict): calls[call.get('id')] = (f.get('name', ''), args, m['timestamp'])
                        except (ValueError, TypeError, AttributeError): continue
                    else:
                        name, args, _ = calls.get(m['tool_call_id'], (m['tool_name'] or '', {}, m['timestamp']))
                        completed.add(m['tool_call_id'])
                        if not isinstance(name, str) or not name: continue
                        if name == 'tool_call':
                            name, args = args.get('name') or args.get('tool_name', ''), args.get('arguments', {})
                            if not isinstance(args, dict): args = {}
                        try: result = json.loads(m['content'] or '{}')
                        except (ValueError, TypeError): result = {}
                        detail = tool_activity(name, args, result)
                        if detail:
                            kind, title, summary, state = detail
                            rows.append(event('native_tool', sid + ':' + str(m['tool_call_id'] or m['id']), m['timestamp'], kind, title, summary, state, runId=sid))
                for call_id, (name, args, at) in calls.items():
                    if call_id in completed: continue
                    if name == 'tool_call':
                        name, args = args.get('name') or args.get('tool_name', ''), args.get('arguments', {})
                    if not isinstance(args, dict): continue
                    detail = tool_activity(name, args, {})
                    if detail:
                        kind, title, _, _ = detail
                        rows.append(event('native_tool', sid + ':' + str(call_id), at, kind, title,
                                          '运行已结束，未收到执行结果' if ended else '已发起，等待执行结果',
                                          'recorded' if ended else 'in_progress', runId=sid))
        return rows
    except (sqlite3.Error, ValueError, TypeError, OverflowError, OSError):
        errors.append({'source': 'native_activity', 'code': 'source_unavailable'})
        return []


def page(bridge, limit=None, cursor=None, since=None):
    try:
        size = int(50 if limit in (None, '') else limit)
        if not 1 <= size <= 200: raise ValueError()
        after = None
        if cursor:
            after = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
            if not isinstance(after, list) or len(after) != 2 or not all(isinstance(v, str) for v in after): raise ValueError()
            after[0] = stamp(after[0])
        start = stamp(since) if since else None
    except (ValueError, TypeError, OverflowError): raise bridge.MemoryError('invalid_pagination')
    home = bridge.home()
    errors, rows = [], []

    def document(relative, jsonl=False, required=False):
        try:
            raw = bridge.read_beneath(home, relative, 8 * 1024 * 1024).decode('utf-8')
            if not jsonl: return json.loads(raw)
            values = []
            for line in raw.splitlines():
                if not line.strip(): continue
                try:
                    value = json.loads(line)
                    if not isinstance(value, dict): raise ValueError()
                    values.append(value)
                except ValueError: errors.append({'source': relative, 'code': 'invalid_record'})
            return values
        except FileNotFoundError:
            if required: errors.append({'source': relative, 'code': 'source_unavailable'})
        except (OSError, ValueError, TypeError): errors.append({'source': relative, 'code': 'source_unavailable'})
        return [] if jsonl else {}

    def add(source, key, at, kind, title, summary='', state='recorded', **extra):
        try: rows.append(event(source, key, at, kind, title, summary, state, **extra))
        except (ValueError, TypeError, OverflowError): errors.append({'source': source, 'code': 'invalid_record'})

    legacy = document('workspace/events/impressions.jsonl', True)
    retracted = {str(r.get('target')) for r in legacy if r.get('op') == 'retract'}
    for r in legacy:
        if r.get('op', 'add') != 'add' or str(r.get('id')) in retracted or r.get('kind') == 'memo': continue
        try:
            rows.append(dict(id=str(r.get('id') or identity('legacy', json.dumps(r, sort_keys=True))), ts=stamp(r.get('ts')), kind=str(r.get('kind', 'activity')), title=str(r.get('title', '活动记录'))[:200], summary=str(r.get('summary', ''))[:2000], detail=str(r.get('detail', ''))[:300], source='legacy', state='recorded', automatic=False))
        except (ValueError, TypeError, OverflowError): errors.append({'source': 'legacy', 'code': 'invalid_record'})
    moments = document('workspace/web-moments.json')
    records = moments.get('records', []) if isinstance(moments, dict) else []
    if not isinstance(records, list):
        errors.append({'source':'workspace/web-moments.json','code':'invalid_record'}); records=[]
    valid_records=[]
    for r in records:
        if isinstance(r,dict) and isinstance(r.get('id'),str) and isinstance(r.get('kind'),str) and (r.get('target_id') is None or isinstance(r.get('target_id'),str)):
            valid_records.append(r)
        else: errors.append({'source':'workspace/web-moments.json','code':'invalid_record'})
    records=valid_records
    deleted = {r.get('target_id') for r in records if r.get('kind') == 'delete'}
    for r in records:
        if not isinstance(r, dict) or r.get('author') != 'ziwei' or r.get('id') in deleted: continue
        title = {'post': '发了一条朋友圈', 'reply': '回复了朋友圈', 'like': '点了一个赞', 'unlike': '收回了一个赞', 'delete': '撤回了一条朋友圈'}.get(r.get('kind'))
        if title: add('moment', r.get('id'), r.get('at'), 'moments', title, state='completed', target={'kind': 'moments', 'id': r.get('id')})
    for r in document('workspace/memory_operations.jsonl', True):
        add('memory_audit', json.dumps(r, sort_keys=True), r.get('time') or r.get('at'), 'memory', '整理了记忆', '更新已记录，等待核验' if r.get('verified') == 'pending' else '已保存记忆维护记录', 'recorded')
    try:
        diaries, diary_errors = bridge.diary_records()
        errors.extend(diary_errors)
        for r in diaries: add('diary', r['id'], r['savedAt'], 'diary', '留下了一篇日记', r['title'], 'completed', target={'kind': 'diary', 'id': r['id']})
    except (OSError, ValueError, bridge.MemoryError): errors.append({'source': 'diary', 'code': 'source_unavailable'})
    for r in document('logs/autonomy_preflight.jsonl', True, required=True):
        if r.get('diagnostic_only'): continue
        allowed, n = r.get('wakeAgent') is True, r.get('opportunity')
        add('wake_gate', str(r.get('time')) + ':' + str(n), r.get('time'), 'wake', f'第 {n} 次自主机会' if type(n) is int and allowed else '自主唤醒检查', '已通过唤醒检查，执行活动见后续记录' if allowed else '本次没有唤醒', 'recorded' if allowed else 'skipped', opportunity=n if type(n) is int else None)
    for r in document('workspace/briefings.jsonl', True):
        add('briefing', json.dumps(r, sort_keys=True), r.get('at'), 'rest' if r.get('choice') == 'rest' else 'activity', '这次选择休息' if r.get('choice') == 'rest' else '留下了活动小记', str(r.get('did') or '')[:2000], 'failed' if r.get('failed') else 'recorded', opportunity=r.get('opportunity'))
    rows.extend(native_activity(home, errors, start))
    unique = {r['id']: r for r in rows if r['id'] not in retracted}
    rows = sorted(unique.values(), key=lambda r: (r['ts'], r['id']), reverse=True)
    if start: rows = [r for r in rows if r['ts'] >= start]
    total = len(rows)
    if after: rows = [r for r in rows if (r['ts'], r['id']) < tuple(after)]
    selected = rows[:size]
    next_cursor = None
    if len(rows) > size:
        last = selected[-1]
        next_cursor = base64.urlsafe_b64encode(json.dumps([last['ts'], last['id']]).encode()).decode().rstrip('=')
    config, counter = document('autonomy_gate.json'), document('autonomy_gate_state.json')
    limit_value = config.get('daily_opportunities') if isinstance(config, dict) else None
    if type(limit_value) is not int:
        receipts = document('logs/autonomy_preflight.jsonl', True)
        limit_value = next((r.get('daily_limit') for r in reversed(receipts) if type(r.get('daily_limit')) is int), None)
    today = datetime.now(TZ).date().isoformat()
    return dict(data=selected, total=total, nextCursor=next_cursor, checkedAt=datetime.now(TZ).isoformat(), errors=list({(e.get('source', ''), e.get('code', '')): e for e in errors}.values()), wake=dict(date=today, count=counter.get('wakes') if isinstance(counter, dict) and counter.get('date') == today else None, dailyLimit=limit_value if type(limit_value) is int else None), source='hermes_native', automatic=True)
