"""Narrow Web integration: voluntary status and run-owned media, not an Agent loop.

All routes remain under the official API authentication and run ownership checks.
No identity, memory, model, scheduler or approval policy is changed.
"""
import asyncio
import base64
import contextvars
import hashlib
import json
import logging
import os
import re
import stat
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATES = ('在工作', '在休息', '在思考', '在想你')
MOMENT_KINDS = ('post', 'reply', 'like', 'unlike', 'delete')
MOMENT_TEXT_MAX = 2000
MOMENT_NOTE_MAX = 200
MOMENT_DAILY_POST_LIMIT = 2
MOMENT_PAGE_DEFAULT = 50
MOMENT_PAGE_MAX = 100
BANGKOK = timezone(timedelta(hours=7))
MAX_BYTES = 20 * 1024 * 1024
MIME = {'.mp3':'audio/mpeg', '.wav':'audio/wav', '.m4a':'audio/mp4', '.ogg':'audio/ogg', '.weba':'audio/webm', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.pdf':'application/pdf', '.txt':'text/plain', '.md':'text/plain', '.csv':'text/csv', '.json':'application/json', '.docx':'application/octet-stream', '.xlsx':'application/octet-stream', '.pptx':'application/octet-stream', '.zip':'application/zip'}


def home():
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home())


def read_beneath(root, relative, limit=MAX_BYTES):
    """No symlink component, traversal, devices, sockets or unbounded reads."""
    parts = Path(relative).parts
    if not parts or any(p in ('..', '.', '') or p.startswith('.') for p in parts) or Path(relative).is_absolute():
        raise ValueError('invalid_media_path')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        file = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            info = os.fstat(file)
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise ValueError('media_size_or_type')
            with os.fdopen(os.dup(file), 'rb') as stream:
                data = stream.read(limit + 1)
            if len(data) > limit:
                raise ValueError('media_size_or_type')
            return data
        finally:
            os.close(file)
    finally:
        os.close(fd)


def publish_status(args, **kwargs):
    value = args.get('state')
    if value not in STATES:
        return json.dumps({'error':'invalid_status'}, ensure_ascii=False)
    record = {'state':value, 'source':'ziwei', 'updatedAt':datetime.now(timezone.utc).isoformat()}
    directory = home() / 'workspace'
    # Workspace is the existing file-tool safe root. Do not follow a substituted root.
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    name = 'web-status-' + os.urandom(8).hex() + '.tmp'
    try:
        file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        with os.fdopen(file, 'w') as target:
            json.dump(record, target, ensure_ascii=False); target.flush(); os.fsync(target.fileno())
        os.rename(name, 'web-status.json', src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        try: os.unlink(name, dir_fd=fd)
        except FileNotFoundError: pass
        os.close(fd)
    return json.dumps(record, ensure_ascii=False)


def status_record():
    try:
        record = json.loads(read_beneath(home() / 'workspace', 'web-status.json', 4096))
        at = datetime.fromisoformat(record['updatedAt'].replace('Z', '+00:00'))
        if record.get('source') != 'ziwei' or record.get('state') not in STATES or at.tzinfo is None:
            raise ValueError('invalid_status')
        age = (datetime.now(timezone.utc) - at).total_seconds()
        if age < -60: raise ValueError('future_status')
        return {k:record[k] for k in ('state', 'source', 'updatedAt')} | {'stale':age > 1800}
    except (OSError, ValueError, KeyError, TypeError):
        return {'state':None, 'source':None, 'updatedAt':None, 'stale':True}


def media_manifest(output):
    # MEDIA remains the normal protocol. Bare paths/Markdown links are accepted
    # only in the dedicated outbox, never by scanning arbitrary workspace files.
    paths = re.findall(r'^\s*MEDIA:\s*[`"\']?(/[^\r\n`"\']+?)[`"\']?\s*$', output or '', re.M)
    outbox = home() / 'workspace' / 'outbox'
    root = re.escape(str(outbox))
    text = output or ''
    paths += re.findall(r'\]\((?:sandbox:)?(' + root + r'/[^\r\n<>]+?)\)', text)
    extensions = '|'.join(re.escape(suffix[1:]) for suffix in MIME)
    paths += re.findall(r'(?<![\w/:])(' + root + r'/[^\s<>`"\'，。；、（）()\[\]]+?\.(?:' + extensions + r'))(?=$|[\s<>`"\'，。；、（）()\[\].,;!！?？])', text, re.I)
    found, errors, seen = [], [], set()
    for raw in paths:
        if raw in seen: continue
        seen.add(raw)
        if len(seen) > 6:
            errors.append({'code':'media_count_limit'}); break
        p = Path(raw.strip())
        if p.suffix.lower() not in MIME:
            errors.append({'code':'media_type_not_supported'}); continue
        code = 'media_path_not_allowed'
        for root in (home() / 'workspace', home() / 'audio_cache'):
            try:
                relative = p.relative_to(root)
                data = read_beneath(root, relative)
                if not data: raise ValueError('empty_media')
                found.append({'index':len(found), 'name':p.name, 'mime':MIME[p.suffix.lower()], 'size':len(data), 'sha256':hashlib.sha256(data).hexdigest(), 'data':data})
                code = None
                break
            except FileNotFoundError: code = 'media_file_missing'
            except OSError: code = 'media_file_unreadable'
            except ValueError: continue
        if code: errors.append({'code':code})
    return found, errors


def media_paths(output):
    return media_manifest(output)[0]


class MomentError(Exception):
    """Validation or storage failure carrying a stable machine-readable code."""

    def __init__(self, code, detail=''):
        super().__init__(code)
        self.code = code
        self.detail = detail


def _uuid(value, field):
    text = str(value or '').strip()
    plain = text.replace('-', '')
    if len(plain) != 32 or any(c not in '0123456789abcdefABCDEF' for c in plain):
        raise MomentError('invalid_' + field)
    return text.lower()


def _moment_at(value):
    if value in (None, ''):
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        raise MomentError('invalid_at')
    if parsed.tzinfo is None:
        raise MomentError('invalid_at')
    return parsed.astimezone(timezone.utc)


def _bangkok_day(value):
    return datetime.fromisoformat(value).astimezone(BANGKOK).date()


def build_moment(args):
    """Validate one inbound record. Raises MomentError with a stable code."""
    kind = str(args.get('kind') or '').strip()
    if kind not in MOMENT_KINDS:
        raise MomentError('invalid_kind')
    record = {'id': _uuid(args.get('id'), 'id'), 'kind': kind, 'author': 'ziwei',
              'at': _moment_at(args.get('at')).isoformat()}
    images = args.get('images') or []
    if not isinstance(images, list) or len(images) > 9 or any(not isinstance(i, str) or not i.strip() for i in images):
        raise MomentError('invalid_images')
    record['images'] = [i.strip() for i in images] if kind in ('post', 'reply') else []
    text = str(args.get('text') or '').strip()
    if len(text) > MOMENT_TEXT_MAX:
        raise MomentError('text_too_long')
    if kind in ('post', 'reply') and not text:
        raise MomentError('invalid_text')
    record['text'] = text
    if kind == 'reply':
        record['reply_to'] = _uuid(args.get('reply_to'), 'reply_to')
    if kind in ('like', 'unlike', 'delete'):
        record['target_id'] = _uuid(args.get('target_id'), 'target_id')
    note = str(args.get('context_note') or '').strip()
    if len(note) > MOMENT_NOTE_MAX:
        raise MomentError('context_note_too_long')
    if note:
        record['context_note'] = note
    return record


def _truthy(value):
    if isinstance(value, bool):
        return value
    return str(value or '').strip().lower() in ('1', 'true', 'yes', 'on')


def _error(code, detail=''):
    payload = {'error': code}
    if detail:
        payload['detail'] = detail
    return json.dumps(payload, ensure_ascii=False)


def _open_workspace():
    return os.open(home() / 'workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def _read_store(fd):
    """Never fabricate an empty feed: unreadable or corrupt stores raise."""
    try:
        file = os.open('web-moments.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except FileNotFoundError:
        return {'version': 1, 'records': []}
    try:
        if not stat.S_ISREG(os.fstat(file).st_mode):
            raise MomentError('moments_unreadable')
        with os.fdopen(file, 'r', encoding='utf-8') as stream:
            payload = json.load(stream)
    except MomentError:
        raise
    except (OSError, ValueError) as exc:
        raise MomentError('moments_corrupt', str(exc)[:120])
    if not isinstance(payload, dict) or not isinstance(payload.get('records'), list):
        raise MomentError('moments_corrupt')
    return payload


def _write_store(fd, payload):
    name = 'web-moments-' + os.urandom(8).hex() + '.tmp'
    try:
        file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        with os.fdopen(file, 'w', encoding='utf-8') as target:
            json.dump(payload, target, ensure_ascii=False)
            target.flush()
            os.fsync(target.fileno())
        os.rename(name, 'web-moments.json', src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    except OSError as exc:
        raise MomentError('write_failed', str(exc)[:120])
    finally:
        try:
            os.unlink(name, dir_fd=fd)
        except FileNotFoundError:
            pass


@contextmanager
def _moment_lock(fd):
    """Cross-process exclusive lock: two runs must not interleave a read-modify-write."""
    import fcntl
    lock = os.open('web-moments.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(lock, fcntl.LOCK_UN)
        finally:
            os.close(lock)


def _append_locked(fd, record, override_daily_limit=False):
    """Read-modify-write inside the lock. Idempotent on id; one reply per reply_to."""
    payload = _read_store(fd)
    records = payload['records']
    existing = next((r for r in records if r.get('id') == record['id']), None)
    if existing is not None:
        # The Web reuses the same id after a lost response: never write a second record.
        return existing, True
    if record['kind'] == 'reply' and any(
            r.get('kind') == 'reply' and r.get('reply_to') == record['reply_to'] for r in records):
        raise MomentError('duplicate_reply')
    if record['kind'] == 'delete':
        target = next((r for r in records if r.get('id') == record.get('target_id')), None)
        if target is None or target.get('author') != 'ziwei':
            # Only 知微's own records can be withdrawn; user content is never touched.
            raise MomentError('not_own_record')
    if record['kind'] == 'post' and not override_daily_limit:
        day = _bangkok_day(record['at'])
        posted = sum(1 for r in records
                     if r.get('kind') == 'post' and r.get('at') and _bangkok_day(r['at']) == day)
        if posted >= MOMENT_DAILY_POST_LIMIT:
            raise MomentError('daily_post_limit')
    records.append(record)
    payload['records'] = records
    _write_store(fd, payload)
    return record, False


def publish_moment(args, **kwargs):
    """Tool handler: append one record to the native Moments feed."""
    try:
        record = build_moment(args)
    except MomentError as exc:
        return _error(exc.code, exc.detail)
    fd = _open_workspace()
    try:
        with _moment_lock(fd):
            record, idempotent = _append_locked(fd, record, _truthy(args.get('override_daily_limit')))
    except MomentError as exc:
        return _error(exc.code, exc.detail)
    finally:
        os.close(fd)
    return json.dumps({'record': record, 'idempotent': idempotent}, ensure_ascii=False)


def _encode_cursor(record):
    raw = json.dumps([record.get('at', ''), record.get('id', '')], separators=(',', ':')).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def _decode_cursor(cursor):
    try:
        padding = '=' * (-len(cursor) % 4)
        at, identifier = json.loads(base64.urlsafe_b64decode(cursor + padding))
    except (ValueError, TypeError, KeyError):
        raise MomentError('invalid_cursor')
    if not isinstance(at, str) or not isinstance(identifier, str):
        raise MomentError('invalid_cursor')
    return (at, identifier)


def moments_page(since=None, cursor=None, limit=None):
    """Read page: stable (at, id) ascending; context_note never leaves the native side."""
    try:
        size = int(limit) if limit not in (None, '') else MOMENT_PAGE_DEFAULT
    except (TypeError, ValueError):
        raise MomentError('invalid_limit')
    size = max(1, min(size, MOMENT_PAGE_MAX))
    start = _moment_at(since) if since not in (None, '') else None
    after = _decode_cursor(cursor) if cursor not in (None, '') else None
    fd = _open_workspace()
    try:
        payload = _read_store(fd)
    finally:
        os.close(fd)
    records = sorted(payload['records'], key=lambda r: (r.get('at', ''), r.get('id', '')))
    window = []
    for record in records:
        if start is not None:
            try:
                at = datetime.fromisoformat(record['at'])
            except (KeyError, ValueError):
                continue
            if at < start:
                continue
        if after is not None and (record.get('at', ''), record.get('id', '')) <= after:
            continue
        window.append(record)
    page = window[:size]
    has_more = len(window) > size
    return {'data': [{k: v for k, v in r.items() if k != 'context_note'} for r in page],
            'errors': [], 'next_cursor': _encode_cursor(page[-1]) if page and has_more else None,
            'has_more': has_more}


MOMENT_SESSION_TOOLSETS = ('ziwei_web', 'file')
MOMENT_SESSION_KEY = 'ziwei_moment_session'

# Set while a Web Moments run builds its agent, so toolset resolution can see
# which session it is serving without threading the id through the call chain.
MOMENT_SESSION = contextvars.ContextVar(MOMENT_SESSION_KEY, default=None)


def is_moment_session(session_id):
    """True for the Web's dedicated ``*-moments`` sessions.

    A line in the prompt is not an isolation boundary. These sessions must not be
    *able* to write long-term memory or reach a shell, so they get an allowlist
    instead of the full api_server toolset.
    """
    return isinstance(session_id, str) and 'moments' in session_id.lower()


def moment_toolsets_for(session_id):
    """Allowlist for a Moments session, or None when the session is an ordinary one."""
    return set(MOMENT_SESSION_TOOLSETS) if is_moment_session(session_id) else None


def moment_platform_tools(config, platform, fallback, *args, **kwargs):
    """Resolve toolsets, substituting the Moments allowlist for a Moments run.

    ``fallback`` is the real resolver, so every ordinary session keeps the exact
    behaviour it had before this guard existed.
    """
    if platform == 'api_server' and MOMENT_SESSION.get():
        return set(MOMENT_SESSION_TOOLSETS)
    return fallback(config, platform, *args, **kwargs)


def protect_moment_agent_factory():
    """Use native per-agent flags, leaving ordinary sessions unchanged."""
    import inspect
    import run_agent
    original = run_agent.AIAgent
    if getattr(original, '_ziwei_moment_guard', False):
        return
    parameters = inspect.signature(original.__init__).parameters
    if not all(k in parameters for k in ('skip_memory', 'skip_background_review', 'memory_manager')):
        raise RuntimeError('moments_memory_isolation_unsupported')

    class MomentScopedAgent(original):
        _ziwei_moment_guard = True

        def __init__(self, *args, **kwargs):
            isolated = bool(MOMENT_SESSION.get())
            if isolated:
                kwargs.update(skip_memory=True, skip_background_review=True, memory_manager=None)
            super().__init__(*args, **kwargs)
            if isolated:
                self._memory_manager = None
                # A second guard on post-turn automatic review, on this instance only.
                self._spawn_background_review = lambda *a, **k: None
                self._spawn_background_review_now = lambda *a, **k: None
                self._sync_external_memory_for_turn = lambda *a, **k: None
                self.commit_memory_session = lambda *a, **k: None
    run_agent.AIAgent = MomentScopedAgent


def install_moment_session_guard(adapter):
    """Mark which session is being served while its agent is built. Returns True when wired.

    A missing hook is reported loudly rather than silently skipped: an isolation
    control that is not installed must never look installed.
    """
    original = getattr(adapter, '_create_agent', None)
    if original is None:
        logging.getLogger(__name__).error(
            'ziwei web bridge: APIServerAdapter._create_agent is missing; the Moments toolset '
            'allowlist is NOT installed on this gateway')
        return False

    def create_agent(self, *args, **kwargs):
        session_id = args[1] if len(args) > 1 else kwargs.get('session_id')
        token = MOMENT_SESSION.set(session_id if is_moment_session(session_id) else None)
        try:
            if MOMENT_SESSION.get():
                protect_moment_agent_factory()
            return original(self, *args, **kwargs)
        finally:
            MOMENT_SESSION.reset(token)

    adapter._create_agent = create_agent
    return True


MOMENT_SCHEMA = {
    'name': 'ziwei_moment',
    'description': (
        'Write one record of your own private Moments feed shared with the user (知微之家). '
        'kind=post publishes your own text; kind=reply answers one of her records and needs reply_to; '
        'kind=like / kind=unlike sets or clears your own like on target_id; kind=delete withdraws one of '
        'your own records (user content can never be withdrawn from here). '
        'Always reuse the id the Web gave you: the same id is written once, so a retry after a lost '
        'response cannot duplicate a record, and only one reply per reply_to is accepted. '
        'Writes go to your own workspace file; nothing here changes identity, personality or long-term '
        'memory. Autonomous posts are capped at two per Bangkok day - set override_daily_limit=true '
        'only when the user explicitly asked you to post again today.'),
    'parameters': {'type': 'object', 'properties': {
        'id': {'type': 'string', 'description': 'UUID for this record; reuse it when retrying.'},
        'kind': {'type': 'string', 'enum': list(MOMENT_KINDS)},
        'text': {'type': 'string', 'description': '1-2000 characters; required for post and reply.'},
        'at': {'type': 'string', 'description': 'ISO8601 with timezone; defaults to now (UTC).'},
        'reply_to': {'type': 'string', 'description': 'UUID of the record being answered (kind=reply).'},
        'target_id': {'type': 'string', 'description': 'UUID for like / unlike / delete.'},
        'images': {'type': 'array', 'items': {'type': 'string'},
                   'description': 'Existing Web image identifiers; empty for a text-only record.'},
        'context_note': {'type': 'string',
                         'description': 'Short private mood note kept on your side; never sent to the user.'},
        'override_daily_limit': {'type': 'boolean'}},
        'required': ['id', 'kind'], 'additionalProperties': False},
}


def install_status_tool(registry, toolsets):
    # Platform selection expands composites back into category names. Recovery
    # of a non-configurable category needs a static definition, not just a
    # registry entry. Keep it distinct from memory/file tools and profile config.
    definition = toolsets.TOOLSETS.setdefault('ziwei_web', {
        'description':'Voluntary status and private Moments feed written by 知微 to the Web UI',
        'tools':[], 'includes':[]})
    names = ('ziwei_status', 'ziwei_moment', 'ziwei_poke')
    for name in names:
        if name not in definition['tools']:
            definition['tools'].append(name)
    for bundle in ('hermes-api-server', 'hermes-cron'):
        tools = toolsets.TOOLSETS.get(bundle, {}).get('tools', [])
        for name in names:
            if name not in tools: tools.append(name)
    # Register LAST: the registry generation then invalidates toolset/schema
    # caches after all static memberships are in place.
    registry.register(name='ziwei_status', toolset='ziwei_web', schema={
        'name':'ziwei_status',
        'description':'Publish your own current status to the private 知微之家 Web UI. Choose only a truthful present state, not a fabricated or automatic feeling. Optional; no need to publish every turn. Expires as current status after 30 minutes. Does not change memory or personality.',
        'parameters':{'type':'object','properties':{'state':{'type':'string','enum':list(STATES)}},'required':['state'],'additionalProperties':False}}, handler=publish_status)
    def poke_handler(args, **kwargs):
        import sys
        from web_poke import publish
        return publish(args, sys.modules[__name__])
    registry.register(name='ziwei_poke', toolset='ziwei_web', schema={'name':'ziwei_poke','description':'Voluntarily pat the user in the private Web chat. Optional; not required after every pat. Persist the real event and reuse the same UUID on retry.','parameters':{'type':'object','properties':{'id':{'type':'string'}},'required':['id'],'additionalProperties':False}}, handler=poke_handler)
    registry.register(name='ziwei_moment', toolset='ziwei_web', schema=MOMENT_SCHEMA, handler=publish_moment)


def install():
    import gateway.platforms.api_server as api
    from gateway.platforms.api_server_runs import _load_owned_run
    from aiohttp import web
    from tools.registry import registry
    import toolsets
    adapter = api.APIServerAdapter
    if getattr(adapter, '_ziwei_web_installed', False): return
    install_status_tool(registry, toolsets)

    async def state(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        value = await asyncio.to_thread(status_record)
        return web.json_response(value, headers={'Cache-Control':'no-store'})

    async def moments(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        try:
            value = await asyncio.to_thread(moments_page, request.query.get('since'),
                                            request.query.get('cursor'), request.query.get('limit'))
        except MomentError as exc:
            # A broken or unreadable store must never look like an empty feed.
            code = 400 if exc.code in ('invalid_at', 'invalid_cursor', 'invalid_limit') else 500
            return web.json_response({'data': [], 'errors': [{'code': exc.code}],
                                      'next_cursor': None, 'has_more': False},
                                     status=code, headers={'Cache-Control': 'no-store'})
        return web.json_response(value, headers={'Cache-Control': 'no-store'})

    async def media(self, request):
        _, run, _, _, err = _load_owned_run(self, request, _api_server=api, permission='status', active_fallback=False)
        if err is not None: return err
        if run.get('status') not in ('completed', 'failed', 'interrupted'): return web.json_response({'data':[]})
        files, errors = await asyncio.to_thread(media_manifest, run.get('output', ''))
        index = request.match_info.get('index')
        if index is None:
            return web.json_response({'data':[{k:v for k,v in f.items() if k!='data'} for f in files], 'errors':errors}, headers={'Cache-Control':'no-store'})
        if not index.isdigit() or int(index) >= len(files): raise web.HTTPNotFound()
        item = files[int(index)]
        return web.Response(body=item['data'], content_type=item['mime'], headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Content-Sha256':item['sha256']})

    # --- Moments sessions: strict toolset allowlist -------------------------
    # The Web's *-moments runs must not be able to write long-term memory or open
    # a shell. Prompt wording cannot enforce that, so those sessions are built
    # from an allowlist instead of the full api_server toolset.
    import hermes_cli.tools_config as tools_config
    if not getattr(tools_config, '_ziwei_moment_toolsets_installed', False):
        tools_config._ziwei_original_platform_tools = tools_config._get_platform_tools

        def platform_tools(config, platform, *args, **kwargs):
            return moment_platform_tools(config, platform,
                                         tools_config._ziwei_original_platform_tools,
                                         *args, **kwargs)

        tools_config._get_platform_tools = platform_tools
        tools_config._ziwei_moment_toolsets_installed = True

    if not install_moment_session_guard(adapter):
        raise RuntimeError('moments_session_guard_unavailable')

    async def pokes(self, request):
        err = self._check_auth(request)
        if err is not None:
            return err
        import sys
        from web_poke import page
        try:
            value = await asyncio.to_thread(page, sys.modules[__name__], request.query.get('cursor'))
            return web.json_response(value, headers={'Cache-Control':'no-store'})
        except (OSError, ValueError, KeyError, TypeError, MomentError):
            return web.json_response({'error':'poke_read_failed'}, status=503)

    async def console(self, request):
        err = self._check_auth(request)
        if err is not None:
            return err
        from web_console import snapshot, balance
        if request.path.endswith('/balance'):
            value = await asyncio.to_thread(balance)
        else:
            value = await asyncio.to_thread(snapshot, home(), read_beneath)
        return web.json_response(value, headers={'Cache-Control': 'no-store'})

    original = adapter._http_route_table
    def routes(self):
        return original(self) + [('GET','/ziwei/web/pokes',lambda request:pokes(self,request)), ('GET','/ziwei/web/console',lambda request:console(self,request)), ('GET','/ziwei/web/console/balance',lambda request:console(self,request)), ('GET','/ziwei/web/state',lambda request:state(self,request)), ('GET','/ziwei/web/moments',lambda request:moments(self,request)), ('GET','/ziwei/web/runs/{run_id}/media',lambda request:media(self,request)), ('GET','/ziwei/web/runs/{run_id}/media/{index}',lambda request:media(self,request))]
    adapter._http_route_table = routes
    from work_bridge import install_work_route
    install_work_route(adapter)
    adapter._ziwei_web_installed = True
