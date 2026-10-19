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
    # note / mood：她要在“渡鸦的小屋”右边看到两行字（我那句话 + 心情）。
    # 我可以随状态一起写；不写就留空，前端会从句子库（workspace/outbox/state-lines.json）取。
    def _clip(key, limit):
        raw = str(args.get(key) or '').strip().replace('\n', ' ')
        return raw[:limit]
    note, mood = _clip('note', 60), _clip('mood', 24)
    record = {'state':value, 'source':'ziwei', 'updatedAt':datetime.now(timezone.utc).isoformat(),
              'note':note, 'mood':mood}
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
        view = {k:record[k] for k in ('state', 'source', 'updatedAt')} | {'stale':age > 1800}
        view['note'] = str(record.get('note') or '')[:60]
        view['mood'] = str(record.get('mood') or '')[:24]
        return view
    except (OSError, ValueError, KeyError, TypeError):
        return {'state':None, 'source':None, 'updatedAt':None, 'stale':True}


def media_manifest(output):
    # MEDIA remains the normal protocol. Bare paths/Markdown links are accepted
    # only in the dedicated outbox, never by scanning arbitrary workspace files.
    # 多气泡信封（{"type":"ziwei.reply.v1","messages":[...]}）里的换行是字面 \n，
    # 只按"行首 MEDIA:"匹配会把整段漏掉 —— 附件于是永远显示"尚未收到"、重试也没用。
    # 做法：把"解过转义的那一份"接在后面一起匹配（重复路径下面会去重）。
    # 这里用 chr() 拼反斜杠和引号，免得这一行本身又被引号绕进去。
    text = output or ''
    # 多气泡信封（{"type":"ziwei.reply.v1","messages":[...]}）必须先解开：
    # 信封里的换行是字面 \n、而且 MEDIA: 后面紧跟引号与括号，按"行首 MEDIA:"匹配会整段漏掉
    # —— 附件于是永远"尚未收到"、点重试也没用（2026-10-16 实测就是这个）。
    try:
        envelope = json.loads(text)
    except (ValueError, TypeError):
        envelope = None
    if isinstance(envelope, dict) and isinstance(envelope.get('messages'), list):
        joined = [m for m in envelope['messages'] if isinstance(m, str)]
        if joined:
            text = text + '\n' + '\n'.join(joined)
    bs, nl, dq = chr(92), chr(10), chr(34)
    if bs + 'n' in text:
        text = text + nl + text.replace(bs + 'n', nl).replace(bs + dq, dq)
    paths = re.findall(r'^\s*MEDIA:\s*[`"\']?(/[^\r\n`"\']+?)[`"\']?\s*$', text, re.M)
    outbox = home() / 'workspace' / 'outbox'
    root = re.escape(str(outbox))
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


def photo_tool(args, **kwargs):
    """我的出图 → 照片墙（source / owner 都是 ziwei）。"""
    import photo_store
    raw = str(args.get('path') or '').strip()
    if not raw:
        raise photo_store.PhotoError('invalid_path', 'empty')
    candidate = Path(raw) if raw.startswith('/') else (home() / 'workspace' / raw)
    workspace = (home() / 'workspace').resolve()
    outbox = (workspace / 'outbox').resolve()
    allowed = False
    for root in (workspace, home() / 'audio_cache'):
        try:
            candidate.resolve().relative_to(root.resolve())
            allowed = True
            break
        except ValueError:
            continue
    if not allowed or not candidate.exists() or not candidate.is_file():
        raise photo_store.PhotoError('invalid_path', raw[:120])
    if candidate.resolve().is_relative_to(outbox):
        pass  # 我最常用的是 outbox 里刚画好的图
    data = candidate.read_bytes()
    return photo_store.add_photo(data, suffix=candidate.suffix.lower(), author=photo_store.ZIWEI,
                                photo_id=args.get('id'), at=args.get('at'),
                                caption=args.get('caption'), name=candidate.name)


def photo_note_tool(args, **kwargs):
    """我自己的标注：只能写/改/删 author=ziwei 的那一条。"""
    import photo_store
    action = str(args.get('action') or '').strip()
    if action == 'write':
        return photo_store.add_annotation(args.get('photo_id'), args.get('text'),
                                          author=photo_store.ZIWEI, note_id=args.get('id'),
                                          at=args.get('at'))
    if action == 'edit':
        return photo_store.edit_annotation(args.get('id'), args.get('text'), author=photo_store.ZIWEI)
    if action == 'delete':
        return photo_store.delete_annotation(args.get('id'), author=photo_store.ZIWEI)
    raise photo_store.PhotoError('invalid_action', action[:20])


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
    retired = set()
    try:
        retired = set(json.loads(read_beneath(home() / 'workspace', MOMENT_RETIRED_FILE, 65536)))
    except (OSError, FileNotFoundError, ValueError, TypeError):
        retired = set()
    for record in records:
        if record.get('id') in retired:
            continue
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
    # retired: 我已经作废、再也不会发射的记录 id。前端据此清掉它那边的“已作废记录”展示，
    # 否则那些孤儿会永久挂在她的朋友圈顶上（她的原话：这么久了还挂在这里）。
    return {'data': [{k: v for k, v in r.items() if k != 'context_note'} for r in page],
            'errors': [], 'retired': sorted(retired),
            'next_cursor': _encode_cursor(page[-1]) if page and has_more else None,
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


MEMORY_FILES = ('MEMORY.md', 'USER.md')
MEMORY_BUDGETS = {'MEMORY.md': 6000, 'USER.md': 2000}
PROTECTED_MARKERS = ('受保护', '不许修改', '不得修改', '受保护规则', '硬规则')
BRIEFING_CHOICES = ('contact_user', 'rest', 'self_directed_task', 'publish_moment', 'write_diary')
BRIEFING_KINDS = ('briefing', 'memory_audit')


class MemoryError(Exception):
    def __init__(self, code, detail=''):
        super().__init__(code)
        self.code = code
        self.detail = detail


def _entry_protected(text):
    return any(marker in text for marker in PROTECTED_MARKERS)


def memory_entries(text):
    """Split a memory file into its §-separated entries, keeping the file shape."""
    blocks, current = [], []
    for line in text.splitlines():
        if line.strip() == '§':
            blocks.append('\n'.join(current).strip())
            current = []
        else:
            current.append(line)
    if '\n'.join(current).strip():
        blocks.append('\n'.join(current).strip())
    out = []
    for index, block in enumerate(b for b in blocks if b):
        heading = block.splitlines()[0].lstrip('# ').strip()[:60] or '（无标题）'
        out.append({'index': index, 'heading': heading, 'text': block,
                    'chars': len(block), 'protected': _entry_protected(block)})
    return out


def memory_snapshot():
    """Read both memory files as the Web needs them: real numbers, real protections."""
    root = home() / 'memories'
    files, errors = [], []
    for name in MEMORY_FILES:
        try:
            data = read_beneath(root, name, 262144)
        except FileNotFoundError:
            errors.append({'code': 'memory_file_missing', 'file': name})
            continue
        except (OSError, ValueError):
            errors.append({'code': 'memory_file_unreadable', 'file': name})
            continue
        text = data.decode('utf-8')
        entries = memory_entries(text)
        files.append({'name': name, 'sha256': hashlib.sha256(data).hexdigest(),
                      'chars': len(text), 'lines': len(text.splitlines()),
                      'entries': entries,
                      'protected_entries': [e['index'] for e in entries if e['protected']],
                      'updated_at': int((root / name).stat().st_mtime),
                      'budget': MEMORY_BUDGETS[name]})
    return {'files': files, 'errors': errors,
            'limits': {name: {'budget': MEMORY_BUDGETS[name]} for name in MEMORY_FILES},
            'protected_files': ['SOUL.md', 'care_rules']}


def _write_memory_file(fd_mem, name, text):
    tmp = '.' + name + '.' + os.urandom(6).hex()
    try:
        out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd_mem)
        with os.fdopen(out, 'w', encoding='utf-8') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.rename(tmp, name, src_dir_fd=fd_mem, dst_dir_fd=fd_mem)
        os.fsync(fd_mem)
    except OSError as exc:
        raise MemoryError('memory_write_failed', str(exc)[:120])
    finally:
        try:
            os.unlink(tmp, dir_fd=fd_mem)
        except FileNotFoundError:
            pass


def _audit(line):
    """Append to the same audit trail the agent's own memory writes use."""
    try:
        directory = os.open(home() / 'workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        return
    try:
        name = 'memory_operations-' + os.urandom(6).hex() + '.tmp'
        try:
            out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            with os.fdopen(out, 'w', encoding='utf-8') as stream:
                stream.write(json.dumps(line, ensure_ascii=False) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            target = os.open('memory_operations.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600, dir_fd=directory)
            try:
                os.write(target, json.dumps(line, ensure_ascii=False).encode() + b'\n')
                os.fsync(target)
            finally:
                os.close(target)
        finally:
            try:
                os.unlink(name, dir_fd=directory)
            except FileNotFoundError:
                pass
    finally:
        os.close(directory)


def edit_memory(args):
    """Controlled memory edit: audited, protected-aware, and it reports real occupancy."""
    name = str(args.get('file') or '').strip()
    op = str(args.get('op') or '').strip()
    old_text = str(args.get('old_text') or '')
    content = str(args.get('content') or '')
    if name not in MEMORY_FILES:
        return _error('memory_file_not_allowed')
    if op not in ('replace', 'remove', 'add'):
        return _error('memory_op_not_allowed')
    root = home() / 'memories'
    try:
        fd_mem = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        return _error('memory_dir_unreadable')
    try:
        try:
            text = read_beneath(root, name, 262144).decode('utf-8')
        except FileNotFoundError:
            return _error('memory_file_missing')
        except (OSError, ValueError):
            return _error('memory_file_unreadable')
        if op == 'add':
            block = content.strip()
            if not block:
                return _error('memory_content_empty')
            if len(text) + len(block) + 4 > MEMORY_BUDGETS[name]:
                return _error('memory_budget_exceeded')
            new_text = text.rstrip('\n') + '\n§\n' + block + '\n'
        else:
            matches = [e for e in memory_entries(text) if old_text and old_text in e['text']]
            if len(matches) != 1:
                return _error('memory_match_not_unique' if matches else 'memory_match_not_found')
            entry = matches[0]
            if entry['protected']:
                return _error('memory_entry_protected')
            if op == 'replace':
                if not content.strip():
                    return _error('memory_content_empty')
                if len(text) - len(entry['text']) + len(content) > MEMORY_BUDGETS[name]:
                    return _error('memory_budget_exceeded')
                new_text = text.replace(entry['text'], content.strip(), 1)
            else:
                new_text = text.replace(entry['text'], '', 1)
                new_text = new_text.replace('\n\n\n', '\n\n')
        _write_memory_file(fd_mem, name, new_text)
        record = {'time': datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds'),
                  'source': 'web memory page', 'op': op,
                  'target': f'memories/{name}: {old_text[:60] or content[:60]}', 'verified': 'pending'}
        _audit(record)
        after = memory_snapshot()
        mine = next((f for f in after['files'] if f['name'] == name), None)
        record['verified'] = f"ok, {mine['chars']}/{MEMORY_BUDGETS[name]} chars, {len(mine['entries'])} entries" if mine else 'unreadable_after_write'
        _audit(record)
        return json.dumps({'ok': True, 'file': name, 'op': op,
                           'chars': mine['chars'] if mine else None,
                           'budget': MEMORY_BUDGETS[name],
                           'entries': len(mine['entries']) if mine else None}, ensure_ascii=False)
    except MemoryError as exc:
        return _error(exc.code, exc.detail)
    finally:
        os.close(fd_mem)


def append_briefing(args):
    """One line per wake-up: what the opportunity was used for, with evidence."""
    choice = str(args.get('choice') or '').strip()
    if choice and choice not in BRIEFING_CHOICES:
        return _error('briefing_choice_not_allowed')
    text = str(args.get('did') or '').strip()
    if not text:
        return _error('briefing_text_empty')
    record = {'at': _moment_at(args.get('at')).isoformat(), 'kind': 'briefing',
              'opportunity': args.get('opportunity'), 'choice': choice, 'did': text[:2000],
              'evidence': [str(e) for e in (args.get('evidence') or [])][:10],
              'failed': bool(args.get('failed'))}
    fd = _open_workspace()
    try:
        with _moment_lock(fd):
            path = 'briefings.jsonl'
            try:
                existing = read_beneath(home() / 'workspace', path, 4 * 1024 * 1024).decode('utf-8')
            except FileNotFoundError:
                existing = ''
            except (OSError, ValueError):
                return _error('briefing_store_unreadable')
            tmp = 'briefings-' + os.urandom(6).hex() + '.tmp'
            try:
                out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                with os.fdopen(out, 'w', encoding='utf-8') as stream:
                    stream.write(existing + json.dumps(record, ensure_ascii=False) + '\n')
                    stream.flush()
                    os.fsync(stream.fileno())
                os.rename(tmp, path, src_dir_fd=fd, dst_dir_fd=fd)
                os.fsync(fd)
            except OSError as exc:
                return _error('write_failed', str(exc)[:120])
            finally:
                try:
                    os.unlink(tmp, dir_fd=fd)
                except FileNotFoundError:
                    pass
    finally:
        os.close(fd)
    return json.dumps({'record': record}, ensure_ascii=False)


def _read_jsonl(relative, limit=4 * 1024 * 1024):
    try:
        raw = read_beneath(home() / 'workspace', relative, limit).decode('utf-8')
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as exc:
        raise MemoryError('log_store_unreadable', str(exc)[:120])
    rows = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except ValueError:
            raise MemoryError('log_store_corrupt')
        if isinstance(value, dict):
            rows.append(value)
    return rows


def logs_page(date=None, cursor=None, limit=None):
    """The Logs page holds exactly two things: my briefings and the memory audit."""
    try:
        size = int(limit) if limit not in (None, '') else MOMENT_PAGE_DEFAULT
    except (TypeError, ValueError):
        raise MemoryError('invalid_limit')
    size = max(1, min(size, MOMENT_PAGE_MAX))
    after = _decode_cursor(cursor) if cursor not in (None, '') else None
    rows = []
    for record in _read_jsonl('briefings.jsonl'):
        rows.append({'kind': 'briefing', 'at': record.get('at', ''),
                     'title': str(record.get('choice') or '自主机会')[:60],
                     'body': str(record.get('did') or ''), 'refs': record.get('evidence') or [],
                     'failed': bool(record.get('failed')), 'opportunity': record.get('opportunity')})
    for record in _read_jsonl('memory_operations.jsonl'):
        rows.append({'kind': 'memory_audit', 'at': record.get('time', ''),
                     'title': f"{record.get('op','')} · {str(record.get('source',''))[:40]}".strip(' ·'),
                     'body': str(record.get('target') or ''), 'refs': [],
                     'failed': record.get('verified') == 'pending'})
    if date:
        rows = [r for r in rows if _bangkok_day(r['at']).isoformat() == str(date)] if all(
            r['at'] for r in rows) else rows
    rows = [r for r in rows if r['at']]
    rows.sort(key=lambda r: (r['at'], r['kind'], r['title']))
    if after is not None:
        rows = [r for r in rows if (r['at'], r['kind']) > after]
    page = rows[:size]
    has_more = len(rows) > size
    return {'data': page, 'errors': [], 'has_more': has_more,
            'next_cursor': _encode_cursor({'at': page[-1]['at'], 'id': page[-1]['kind']}) if page and has_more else None}


DIARY_DIR = 'diary'
DIARY_PAGE_DEFAULT = 20
DIARY_PAGE_MAX = 100
DIARY_PREVIEW = 200
# 一天可以有两页：共享的 2026-10-16.md，和只写给自己的一页 2026-10-16-memo.md。
DIARY_NAME = re.compile(r'^(\d{4}-\d{2}-\d{2})(?:[-_.][A-Za-z0-9_-]+)?\.md$')
# 她自己写在开头的手写字段：心情：… / 一句：… / 标签：词、词 / 可见：共享|私人
DIARY_FIELD = re.compile(r'^(心情|一句|标签|可见)\s*[:：]\s*(.*)$')
DIARY_PRIVATE_NAME = re.compile(r'(^|[-_.])(memo|private|默记)([-_.]|$)', re.IGNORECASE)
DIARY_SHARED = 'shared'
DIARY_PRIVATE = 'private'
DIARY_PRIVATE_WORDS = ('私人', '私密', 'private', 'private only', '自留')


def _diary_fields(text):
    """开头那几个手写字段，原样透传；没写就是没有，不猜、不补、不生成。"""
    fields = {'mood': '', 'summary': '', 'tags': [], 'visibility': DIARY_SHARED}
    for line in text.splitlines()[:40]:
        match = DIARY_FIELD.match(line.strip())
        if match is None:
            continue
        name, value = match.group(1), match.group(2).strip()
        if name == '心情' and not fields['mood']:
            fields['mood'] = value[:120]
        elif name == '一句' and not fields['summary']:
            fields['summary'] = value[:200]
        elif name == '标签' and not fields['tags']:
            fields['tags'] = [t.strip()[:20] for t in re.split(r'[、,，/]', value) if t.strip()][:8]
        elif name == '可见' and not value:
            continue
        elif name == '可见':
            low = value.lower()
            if low in DIARY_PRIVATE_WORDS or '私人' in value or '私密' in value:
                fields['visibility'] = DIARY_PRIVATE
    return fields


def _diary_is_private(name, fields):
    """私密篇的判据：文件名带 memo/private/默记，或她自己写了「可见：私人」。"""
    return fields['visibility'] == DIARY_PRIVATE or bool(DIARY_PRIVATE_NAME.search(name))


def _diary_id(relative):
    """Stable, opaque, credential-free identifier for one diary file."""
    return 'diary-' + hashlib.sha256(relative.encode('utf-8')).hexdigest()[:16]


def _diary_title(text, date):
    """标题＝当天的第一个二级小标题；没有才退回第一行正文；再没有才写日期。"""
    lines = [line.strip() for line in text.splitlines()]
    for line in lines:
        if line.startswith('## ') and line[3:].strip():
            return line[3:].strip()[:60]
    for line in lines:
        cleaned = line.lstrip('#').strip()
        if not cleaned or DIARY_FIELD.match(cleaned) or DIARY_NAME.match(cleaned) or cleaned == date:
            continue
        return cleaned[:60]
    return f'{date} 日记'


MOMENT_RETIRED_FILE = 'moments-retired.json'


def _diary_display(text, title):
    """把正文里那几个 markdown 记号去掉：标题行不再重复、**粗体**还原成字。"""
    lines = []
    dropped_heading = False
    for line in text.splitlines():
        stripped = line.strip()
        if not dropped_heading and stripped.startswith('## ') and stripped[3:].strip() == title:
            dropped_heading = True
            continue
        lines.append(line)
    body = '\n'.join(lines).strip()
    body = re.sub(r'\*\*(.+?)\*\*', r'\1', body)
    body = re.sub(r'(?m)^#{1,6}\s*', '', body)
    body = re.sub(r'`(.+?)`', r'\1', body)
    return body


def impressions_page(limit=None):
    """今日印记：只读 workspace/events/impressions.jsonl，只返回 add 且未被 retract 的行。

    没有发生的事不会被写进去，这里也造不出内容：文件不存在就是空列表。
    """
    try:
        size = int(limit) if limit not in (None, '') else 60
    except (TypeError, ValueError):
        raise MemoryError('invalid_pagination')
    if not 1 <= size <= 200:
        raise MemoryError('invalid_pagination')
    path = home() / 'workspace' / 'events' / 'impressions.jsonl'
    rows, errors = [], []
    try:
        raw = read_beneath(path.parent, 'impressions.jsonl', 8 * 1024 * 1024)
    except FileNotFoundError:
        raw = b''
    except (OSError, ValueError):
        raise MemoryError('impressions_unreadable')
    retracted = set()
    for line in raw.decode('utf-8', 'replace').splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            errors.append({'code': 'impressions_bad_line'})
            continue
        if row.get('op') == 'retract':
            if row.get('target'):
                retracted.add(str(row['target']))
            continue
        rows.append(row)
    rows = [r for r in rows if str(r.get('id', '')) not in retracted]
    rows.sort(key=lambda r: str(r.get('ts', '')), reverse=True)
    return {'data': rows[:size], 'total': len(rows), 'checkedAt': datetime.now(BANGKOK).isoformat(),
            'errors': errors}


def diary_records():
    """Every saved diary file as the Web contract wants it: date, source, fingerprint, preview."""
    root = home() / 'workspace' / DIARY_DIR
    records, errors = [], []
    try:
        names = sorted(os.listdir(root))
    except FileNotFoundError:
        return records, errors
    except OSError:
        raise MemoryError('diary_directory_unreadable')
    for name in names:
        if not name.endswith('.md') or name.startswith('.'):
            continue
        try:
            raw = read_beneath(root, name, 4 * 1024 * 1024)
            stamp = datetime.fromtimestamp((root / name).stat().st_mtime, BANGKOK)
        except (OSError, ValueError):
            errors.append({'code': 'diary_unreadable', 'source': f'workspace/{DIARY_DIR}/{name}'})
            continue
        text = raw.decode('utf-8', 'replace')
        relative = f'workspace/{DIARY_DIR}/{name}'
        match = DIARY_NAME.match(name)
        date = match.group(1) if match else stamp.strftime('%Y-%m-%d')
        fields = _diary_fields(text)
        if _diary_is_private(name, fields):
            # 私密页（《默记》）：标题、日期、预览、数量一律不出现在列表里，只有他自己改成共享才算
            continue
        title = _diary_title(text, date)
        body = _diary_display(text, title)
        record = {'id': _diary_id(relative), 'title': title, 'date': date,
                  'at': stamp.isoformat(), 'savedAt': stamp.isoformat(), 'source': relative,
                  'preview': body.strip()[:DIARY_PREVIEW], 'revision': hashlib.sha256(raw).hexdigest(),
                  'document': True, 'content': body, 'visibility': DIARY_SHARED}
        if fields['mood']:
            record['mood'] = fields['mood']
        if fields['summary']:
            record['summary'] = fields['summary']
        if fields['tags']:
            record['tags'] = fields['tags']
        records.append(record)
    records.sort(key=lambda r: (r['date'], r['savedAt']), reverse=True)
    return records, errors


def diary_page(limit=None, offset=None, q=None):
    """List saved diaries newest first. Real totals, real fingerprints, never a made-up diary."""
    try:
        size = int(limit) if limit not in (None, '') else DIARY_PAGE_DEFAULT
        start = int(offset) if offset not in (None, '') else 0
    except (TypeError, ValueError):
        raise MemoryError('invalid_pagination')
    if not 1 <= size <= DIARY_PAGE_MAX or start < 0:
        raise MemoryError('invalid_pagination')
    records, errors = diary_records()
    needle = str(q or '').strip().lower()
    if needle:
        records = [r for r in records if needle in r['content'].lower() or needle in r['title'].lower()]
    total = len(records)
    page = [{k: v for k, v in record.items() if k != 'content'} for record in records[start:start + size]]
    following = start + size
    return {'data': page, 'total': total, 'nextOffset': following if following < total else None,
            'checkedAt': datetime.now(BANGKOK).isoformat(), 'errors': errors}


def diary_document(identifier):
    """Full saved text for one diary id. The id is matched, never turned into a path."""
    wanted = str(identifier or '').strip()
    if not wanted or not re.fullmatch(r'diary-[0-9a-f]{16}', wanted):
        raise MemoryError('invalid_id', wanted[:40])
    records, errors = diary_records()
    for record in records:
        if record['id'] == wanted:
            document = {'id': record['id'], 'title': record['title'], 'date': record['date'],
                        'visibility': record['visibility'], 'content': record['content'],
                        'source': record['source'], 'revision': record['revision'],
                        'savedAt': record['savedAt'], 'errors': errors}
            for key in ('mood', 'summary', 'tags'):
                if record.get(key):
                    document[key] = record[key]
            return document
    raise MemoryError('diary_not_found', wanted)


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
    names = ('ziwei_status', 'ziwei_moment', 'ziwei_poke', 'ziwei_briefing',
             'ziwei_photo', 'ziwei_photo_note')
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
        'parameters':{'type':'object','properties':{'state':{'type':'string','enum':list(STATES)},'note':{'type':'string','description':'一句话（1-60 字），显示在主页“渡鸦的小屋”右边。可留空——留空时前端从句子库取。'},'mood':{'type':'string','description':'心情短句（1-24 字），同样显示在小屋里；可留空。'}},'required':['state'],'additionalProperties':False}}, handler=publish_status)
    def poke_handler(args, **kwargs):
        import sys
        from web_poke import publish
        return publish(args, sys.modules[__name__])
    registry.register(name='ziwei_poke', toolset='ziwei_web', schema={'name':'ziwei_poke','description':'Voluntarily pat the user in the private Web chat. Optional; not required after every pat. Persist the real event and reuse the same UUID on retry.','parameters':{'type':'object','properties':{'id':{'type':'string'}},'required':['id'],'additionalProperties':False}}, handler=poke_handler)
    registry.register(name='ziwei_moment', toolset='ziwei_web', schema=MOMENT_SCHEMA, handler=publish_moment)
    registry.register(name='ziwei_briefing', toolset='ziwei_web', schema={
        'name': 'ziwei_briefing',
        'description': (
            'Write one line into the Logs page for the wake-up you just used: what you chose, what you '
            'actually did and the files that prove it. Call it at the end of every autonomous '
            'opportunity, including the ones you spend resting. Never describe a plan as done work.'),
        'parameters': {'type': 'object', 'properties': {
            'choice': {'type': 'string', 'enum': list(BRIEFING_CHOICES)},
            'did': {'type': 'string', 'description': '1-2000 characters; what really happened.'},
            'opportunity': {'type': 'integer', 'description': 'Which of the six daily opportunities this was.'},
            'at': {'type': 'string', 'description': 'ISO8601 with timezone; defaults to now (UTC).'},
            'evidence': {'type': 'array', 'items': {'type': 'string'},
                         'description': 'Paths or ids a reader could check.'},
            'failed': {'type': 'boolean', 'description': 'True when this attempt did not succeed.'}},
            'required': ['did'], 'additionalProperties': False}}, handler=append_briefing)
    registry.register(name='ziwei_photo', toolset='ziwei_web', schema={
        'name': 'ziwei_photo',
        'description': (
            'Put one of your own images into the private photo wall (知微之家). The file must already '
            'exist inside your workspace (for example something you just drew in outbox/images). It is '
            'copied, never moved, and marked as sent by you. Reuse the same id on retry so one picture '
            'is never stored twice. The user can delete any photo; you can only delete your own.'),
        'parameters': {'type': 'object', 'properties': {
            'id': {'type': 'string', 'description': 'UUID for this photo; reuse it when retrying.'},
            'path': {'type': 'string', 'description': 'Absolute path, or a path under the workspace.'},
            'at': {'type': 'string', 'description': 'ISO8601 with timezone; defaults to now (UTC).'},
            'caption': {'type': 'string', 'description': 'Optional 1-280 character line shown under it.'}},
            'required': ['id', 'path'], 'additionalProperties': False}}, handler=photo_tool)
    registry.register(name='ziwei_photo_note', toolset='ziwei_web', schema={
        'name': 'ziwei_photo_note',
        'description': (
            'Write, edit or delete YOUR OWN one-line annotation on a photo in the private photo wall. '
            'Both of you can annotate the same picture and each of you sees the other line with the '
            'author and time. You can never edit or delete hers; the native side refuses it.'),
        'parameters': {'type': 'object', 'properties': {
            'action': {'type': 'string', 'enum': ['write', 'edit', 'delete']},
            'id': {'type': 'string', 'description': 'UUID of the annotation; reuse it on retry.'},
            'photo_id': {'type': 'string', 'description': 'Which photo (required for write).'},
            'text': {'type': 'string', 'description': '1-280 characters (required for write and edit).'},
            'at': {'type': 'string', 'description': 'ISO8601 with timezone; defaults to now (UTC).'}},
            'required': ['action', 'id'], 'additionalProperties': False}}, handler=photo_note_tool)


def install():
    import gateway.platforms.api_server as api
    from gateway.platforms.api_server_runs import _load_owned_run
    from aiohttp import web
    from tools.registry import registry
    import toolsets
    adapter = api.APIServerAdapter
    if getattr(adapter, '_ziwei_web_installed', False): return
    from auth_attempt_guard import install as install_auth_attempt_guard
    install_auth_attempt_guard(adapter, web)
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

    async def memory(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        try:
            value = await asyncio.to_thread(memory_snapshot)
        except MemoryError as exc:
            return web.json_response({'files': [], 'errors': [{'code': exc.code}]}, status=500,
                                     headers={'Cache-Control': 'no-store'})
        return web.json_response(value, headers={'Cache-Control': 'no-store'})

    async def memory_edit(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({'error': 'invalid_body'}, status=400)
        result = await asyncio.to_thread(edit_memory, payload if isinstance(payload, dict) else {})
        body = json.loads(result)
        status = 200 if body.get('ok') else 409 if body.get('error') in (
            'memory_entry_protected', 'memory_budget_exceeded', 'memory_match_not_unique') else 400
        return web.json_response(body, status=status, headers={'Cache-Control': 'no-store'})

    async def impressions(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        try:
            value = await asyncio.to_thread(impressions_page, request.query.get('limit'))
        except MemoryError as exc:
            code = 400 if exc.code == 'invalid_pagination' else 500
            return web.json_response({'error': exc.code, 'data': [], 'total': 0, 'errors': [{'code': exc.code}]},
                                     status=code, headers={'Cache-Control': 'no-store'})
        return web.json_response(value, headers={'Cache-Control': 'no-store'})

    async def diary(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        try:
            identifier = request.query.get('id')
            if identifier not in (None, ''):
                value = await asyncio.to_thread(diary_document, identifier)
            else:
                value = await asyncio.to_thread(diary_page, request.query.get('limit'),
                                                request.query.get('offset'), request.query.get('q'))
        except MemoryError as exc:
            # A diary that cannot be read is reported as an error, never as "no diary yet".
            code = 404 if exc.code == 'diary_not_found' else 400 if exc.code in (
                'invalid_id', 'invalid_pagination') else 500
            return web.json_response({'error': exc.code, 'errors': [{'code': exc.code}],
                                      'data': [], 'total': 0, 'nextOffset': None},
                                     status=code, headers={'Cache-Control': 'no-store'})
        return web.json_response(value, headers={'Cache-Control': 'no-store'})

    def _photo_error(exc):
        code = 403 if exc.code == 'not_owner' else 404 if exc.code in (
            'photo_not_found', 'note_not_found') else 400
        return web.json_response({'error': exc.code, 'errors': [{'code': exc.code}], 'data': []},
                                 status=code, headers={'Cache-Control': 'no-store'})

    async def photos(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        try:
            value = await asyncio.to_thread(photo_store.photos_page, request.query.get('date'),
                                            request.query.get('limit'), request.query.get('cursor'))
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response(value, headers={'Cache-Control': 'no-store'})

    async def photo_days(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        try:
            value = await asyncio.to_thread(photo_store.photo_days, request.query.get('from'),
                                            request.query.get('to'))
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response({'data': value, 'errors': []}, headers={'Cache-Control': 'no-store'})

    async def photo_detail(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        try:
            value = await asyncio.to_thread(photo_store.photo_detail, request.match_info.get('photo_id'))
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response(value, headers={'Cache-Control': 'no-store'})

    async def photo_file(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        thumb = request.query.get('thumb') not in (None, '', '0', 'false')
        try:
            data, mime = await asyncio.to_thread(photo_store.photo_bytes,
                                                 request.match_info.get('photo_id'), thumb)
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.Response(body=data, content_type=mime, headers={
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'X-Content-Sha256': hashlib.sha256(data).hexdigest()})

    async def photo_upload(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        headers = request.headers
        name = headers.get('X-Photo-Name') or ''
        suffix = headers.get('X-Photo-Suffix') or (Path(name).suffix if name else '') or '.jpg'
        try:
            data = await request.read()
            record = await asyncio.to_thread(
                photo_store.add_photo, data, suffix=suffix, author=photo_store.USER,
                photo_id=headers.get('X-Photo-Id'), at=headers.get('X-Photo-At'),
                caption=headers.get('X-Photo-Caption'), name=name)
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response({'photo': photo_store.public_photo(record)},
                                 status=201, headers={'Cache-Control': 'no-store'})

    async def photo_delete(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        try:
            value = await asyncio.to_thread(photo_store.delete_photo,
                                            request.match_info.get('photo_id'), author=photo_store.USER)
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response({'photo': value, 'errors': []}, headers={'Cache-Control': 'no-store'})

    async def photo_note_add(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        try:
            body = await request.json()
        except Exception:
            return web.json_response({'error': 'invalid_json', 'data': []}, status=400,
                                     headers={'Cache-Control': 'no-store'})
        try:
            value = await asyncio.to_thread(photo_store.add_annotation,
                                            request.match_info.get('photo_id'), body.get('text'),
                                            author=photo_store.USER, note_id=body.get('id'),
                                            at=body.get('at'))
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response({'annotation': value, 'errors': []}, status=201,
                                 headers={'Cache-Control': 'no-store'})

    async def photo_note_edit(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        try:
            body = await request.json()
        except Exception:
            return web.json_response({'error': 'invalid_json', 'data': []}, status=400,
                                     headers={'Cache-Control': 'no-store'})
        try:
            value = await asyncio.to_thread(photo_store.edit_annotation,
                                            request.match_info.get('note_id'), body.get('text'),
                                            author=photo_store.USER)
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response({'annotation': value, 'errors': []}, headers={'Cache-Control': 'no-store'})

    async def photo_note_delete(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        import photo_store
        try:
            value = await asyncio.to_thread(photo_store.delete_annotation,
                                            request.match_info.get('note_id'), author=photo_store.USER)
        except photo_store.PhotoError as exc:
            return _photo_error(exc)
        return web.json_response({'annotation': value, 'errors': []}, headers={'Cache-Control': 'no-store'})

    async def logs(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        try:
            value = await asyncio.to_thread(logs_page, request.query.get('date'),
                                            request.query.get('cursor'), request.query.get('limit'))
        except MemoryError as exc:
            code = 400 if exc.code == 'invalid_limit' else 500
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
        return original(self) + [('GET','/ziwei/web/memory',lambda request:memory(self,request)), ('POST','/ziwei/web/memory/edit',lambda request:memory_edit(self,request)), ('GET','/ziwei/web/impressions',lambda request:impressions(self,request)), ('GET','/ziwei/web/logs',lambda request:logs(self,request)), ('GET','/ziwei/web/diary',lambda request:diary(self,request)), ('GET','/ziwei/web/pokes',lambda request:pokes(self,request)), ('GET','/ziwei/web/console',lambda request:console(self,request)), ('GET','/ziwei/web/console/balance',lambda request:console(self,request)), ('GET','/ziwei/web/state',lambda request:state(self,request)), ('GET','/ziwei/web/moments',lambda request:moments(self,request)), ('GET','/ziwei/web/photos',lambda request:photos(self,request)), ('POST','/ziwei/web/photos',lambda request:photo_upload(self,request)), ('GET','/ziwei/web/photos/days',lambda request:photo_days(self,request)), ('GET','/ziwei/web/photos/{photo_id}',lambda request:photo_detail(self,request)), ('GET','/ziwei/web/photos/{photo_id}/file',lambda request:photo_file(self,request)), ('DELETE','/ziwei/web/photos/{photo_id}',lambda request:photo_delete(self,request)), ('POST','/ziwei/web/photos/{photo_id}/annotations',lambda request:photo_note_add(self,request)), ('PATCH','/ziwei/web/photos/{photo_id}/annotations/{note_id}',lambda request:photo_note_edit(self,request)), ('DELETE','/ziwei/web/photos/{photo_id}/annotations/{note_id}',lambda request:photo_note_delete(self,request)), ('GET','/ziwei/web/runs/{run_id}/media',lambda request:media(self,request)), ('GET','/ziwei/web/runs/{run_id}/media/{index}',lambda request:media(self,request))]
    adapter._http_route_table = routes
    from work_bridge import install_work_route
    install_work_route(adapter)
    adapter._ziwei_web_installed = True
