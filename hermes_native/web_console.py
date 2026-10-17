"""Bounded read-only operations snapshot. Never executes jobs or model calls."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


def snapshot(home, read):
    now = datetime.now(timezone.utc).isoformat()
    errors = []
    def document(relative, maximum=524288):
        try:
            return json.loads(read(home, relative, maximum))
        except FileNotFoundError:
            return None
        except (OSError, ValueError, TypeError):
            errors.append('unreadable_' + relative.replace('/', '_').replace('.', '_'))
            return None
    jobs = document('cron/jobs.json')
    jobs = jobs.get('jobs', []) if isinstance(jobs, dict) else jobs if isinstance(jobs, list) else []
    job_fields = ('id', 'name', 'enabled', 'schedule', 'last_run_at', 'last_run', 'last_status', 'next_run_at', 'failure_streak')
    job_rows = [{k: j[k] for k in job_fields if k in j} for j in jobs[:100] if isinstance(j, dict)]
    wakes = []
    try:
        raw = read(home, 'logs/autonomy_preflight.jsonl', 2 * 1024 * 1024)
        for line in raw.decode('utf-8').splitlines()[-30:]:
            try:
                v = json.loads(line)
                wakes.append({k: v[k] for k in ('time', 'wakeAgent', 'reason', 'opportunity', 'idle', 'available_actions') if k in v})
            except ValueError:
                continue
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        errors.append('wake_log_unavailable')
    state = document('autonomy_gate_state.json')
    receipt = document('scripts/autonomy_gate.upgrade-receipt.json')
    tasks = document('workspace/tasks.json')
    tasks = [{k: t[k] for k in ('id', 'title', 'name', 'status', 'updated_at', 'evidence') if k in t}
             for t in (tasks if isinstance(tasks, list) else [])[:100] if isinstance(t, dict)]
    memories = []
    for name in ('MEMORY.md', 'USER.md'):
        try:
            content = read(home, 'memories/' + name, 131072)
            info = (home / 'memories' / name).lstat()
            memories.append({'name': name, 'bytes': len(content), 'savedAt': datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat()})
        except (OSError, ValueError):
            pass
    usage = {'available': False, 'scope': 'recorded_session_totals', 'today': None, 'month': None,
             'reason': 'No verified per-call daily ledger; missing usage is not zero.'}
    database = home / 'state.db'
    if database.exists() and not database.is_symlink():
        try:
            connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=1)
            try:
                columns = {v[1] for v in connection.execute('PRAGMA table_info(sessions)')}
                allowed = ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'api_call_count', 'actual_cost_usd')
                fields = [k for k in allowed if k in columns]
                if fields:
                    row = connection.execute('SELECT ' + ','.join('sum("' + k + '")' for k in fields) + ' FROM sessions').fetchone()
                    usage.update(available=True, totals=dict(zip(fields, row)))
            finally:
                connection.close()
        except sqlite3.Error:
            errors.append('usage_database_unavailable')
    return {'checkedAt': now, 'services': {'hermes': 'online', 'gateway': 'online', 'guardian': 'unknown'},
            'deployment': {'commit': os.environ.get('RAILWAY_GIT_COMMIT_SHA'), 'id': os.environ.get('RAILWAY_DEPLOYMENT_ID')},
            'jobs': job_rows, 'wakes': wakes, 'wakeCounter': state, 'tasks': tasks, 'memoryStorage': memories,
            'preflightUpgrade': receipt, 'usage': usage, 'errors': errors}


def balance():
    key = os.environ.get('DEEPSEEK_API_KEY')
    if not key:
        return {'available': False, 'error': 'provider_key_unavailable'}
    try:
        request = Request('https://api.deepseek.com/user/balance', headers={'Authorization': 'Bearer ' + key})
        with urlopen(request, timeout=5) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError('size')
        value = json.loads(raw)
        return {'available': True, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'balances': [
            {k: b[k] for k in ('currency', 'total_balance', 'granted_balance', 'topped_up_balance') if k in b}
            for b in value.get('balance_infos', [])[:5] if isinstance(b, dict)]}
    except Exception:
        return {'available': False, 'error': 'provider_balance_unavailable'}
