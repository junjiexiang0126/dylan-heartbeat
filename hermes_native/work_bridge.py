"""Authenticated, durable, bounded Work entrypoint, separate from private chat."""
import asyncio
import fcntl
import hashlib
import json
import logging
import os
import re
import signal
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def install_work_route(adapter):
    from aiohttp import web
    async def status(self, request):
        err = self._check_auth(request)
        if err is not None:
            return err
        child = await asyncio.create_subprocess_exec(sys.executable, str(Path(__file__).with_name('work_agent.py')), '--check',
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
        try:
            out, _ = await asyncio.wait_for(child.communicate(), timeout=45)
            result = json.loads(out) if len(out) <= 32000 else {'error':'work_agent_failed'}
            return web.json_response(result, status=200 if child.returncode == 0 else 502, headers={'Cache-Control':'no-store'})
        except (asyncio.TimeoutError, asyncio.CancelledError):
            if child.returncode is None:
                os.killpg(child.pid, signal.SIGKILL)
                await child.wait()
            return web.json_response({'error':'work_timeout'}, status=504)
        except (ValueError, TypeError):
            return web.json_response({'error':'work_agent_failed'}, status=502)
    async def work(self, request):
        err = self._check_auth(request)
        if err is not None:
            return err
        if request.content_length is None or request.content_length > 24000:
            return web.json_response({'error': 'work_body_limit'}, status=413)
        try:
            body = await request.json()
            task, stage = body['taskId'], body['stage']
            if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', task) or stage not in ('plan', 'review'):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            return web.json_response({'error': 'invalid_work_request'}, status=400)
        root = Path(os.environ['HERMES_HOME']) / 'work-runtime'
        root.mkdir(mode=0o700, exist_ok=True)
        lock = (root / 'execution.lock').open('a')
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return web.json_response({'error': 'work_busy'}, status=429)
            target = root / (task + '-' + stage + '.json')
            encoded = json.dumps(body, sort_keys=True, ensure_ascii=False).encode()
            digest = hashlib.sha256(encoded).hexdigest()
            if target.exists():
                prior = json.loads(target.read_text())
                if prior['digest'] != digest:
                    return web.json_response({'error': 'work_idempotency_conflict'}, status=409)
                return web.json_response(prior.get('result', {'error': 'work_admission_uncertain'}), status=200 if 'result' in prior else 409)
            today = datetime.now(timezone(timedelta(hours=7))).date().isoformat()
            usage_file = root / (today + '.json')
            count = json.loads(usage_file.read_text()) if usage_file.exists() else 0
            if count >= 24:
                return web.json_response({'error': 'work_daily_limit'}, status=429)
            def write(file, value):
                temp = file.with_suffix('.tmp')
                with temp.open('w') as stream:
                    os.chmod(temp, 0o600)
                    json.dump(value, stream, ensure_ascii=False)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temp, file)
            write(usage_file, count + 1)
            write(target, {'digest': digest})
            child = await asyncio.create_subprocess_exec(sys.executable, str(Path(__file__).with_name('work_agent.py')),
                         stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                         stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
            try:
                out, _ = await asyncio.wait_for(child.communicate(encoded), timeout=45)
                if len(out) > 32000:
                    raise ValueError('worker_failed')
                result = json.loads(out)
                if child.returncode:
                    logging.getLogger(__name__).warning('Work worker rejected stage=%s code=%s', stage, result.get('error', 'work_agent_failed'))
                    return web.json_response({'error':result.get('error','work_agent_failed')}, status=502)
                write(target, {'digest': digest, 'result': result})
                return web.json_response(result, headers={'Cache-Control': 'no-store'})
            except (asyncio.TimeoutError, asyncio.CancelledError):
                if child.returncode is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    await child.wait()
                return web.json_response({'error': 'work_timeout'}, status=504)
            except (ValueError, TypeError):
                return web.json_response({'error': 'work_agent_failed'}, status=502)
        finally:
            lock.close()
    original = adapter._http_route_table
    adapter._http_route_table = lambda self: original(self) + [('POST', '/ziwei/web/work/turn', lambda request: work(self, request)), ('GET', '/ziwei/web/work/status', lambda request: status(self, request))]
