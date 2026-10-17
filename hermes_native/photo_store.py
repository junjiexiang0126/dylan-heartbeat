"""照片墙：数据与权限（原生侧）。

规则来自她 2026-10-16 的四条原话：
  1. 「照片谁能删？我能删。你也可以删你自己的。」      → user 可删任何一张；ziwei 只能删自己上传的
  2. 「各自只能改自己的，标注上显示『谁 + 时间』」      → 越权改删一律 not_owner（路由层给 403）
  3. 「我从相册选；你这边可以从我出的图里挑（会标『知微发的』）」→ source/author = user | ziwei
  4. 「进去看单张详情＋全部标注；同一天多张就向下滑连续看」→ detail 返回全部标注（按时间正序）

设计取舍：
- 索引只增不删（软删写 deleted_at），文件不物理删除：删除可回溯，也不怕误删。
- 写入用客户端给的 id（重试复用同一个 id 就不会重复），与 moments / pokes 同一套做法。
- 缩略图能生成就生成（PIL 长边 480），生成失败不影响主流程。
"""
import hashlib
import json
import os
import urllib.parse
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

PHOTO_DIR = 'photos'
PHOTO_INDEX = 'photos/index.json'
PHOTO_ANNOT = 'photos/annotations.json'
PHOTO_THUMB_DIR = 'photos/thumbs'

PHOTO_MAX_BYTES = 9_500_000  # 网关的请求体上限是 10MB，留一点余量
PHOTO_PAGE_DEFAULT = 60
PHOTO_PAGE_MAX = 200
PHOTO_ANNOT_MAX = 280
ANNOT_PAGE_MAX = 500

BANGKOK = timezone(timedelta(hours=7))
USER = 'user'
ZIWEI = 'ziwei'
AUTHORS = (USER, ZIWEI)

MIME_BY_SUFFIX = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.bmp': 'image/bmp',
}
SAFE_SUFFIX = re.compile(r'^\.[a-z0-9]{2,5}$')
ID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


class PhotoError(Exception):
    """code 会被路由层映射成 HTTP 状态：not_owner → 403，其余 400/404。"""

    def __init__(self, code, detail=''):
        super().__init__(code)
        self.code = code
        self.detail = detail


def _home():
    return Path(os.environ.get('HERMES_HOME') or '/data/hermes_native')


def _text_header(value, limit):
    """HTTP 头只能是 latin-1，所以中文是 percent-encoded 过来的：这里解回去。"""
    raw = str(value or '').strip()
    if '%' in raw:
        try:
            raw = urllib.parse.unquote(raw, errors='strict')
        except Exception:
            pass
    return raw[:limit]

def _bangkok_day(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            raise PhotoError('invalid_at', value[:40])
    if not isinstance(value, datetime):
        value = datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(BANGKOK)


def _photo_id(value=None):
    if value in (None, ''):
        return str(uuid.uuid4())
    text = str(value).strip().lower()
    if not ID_RE.match(text):
        raise PhotoError('invalid_id', text[:40])
    return text


def _read_json(relative, default):
    path = _home() / 'workspace' / relative
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
        return data if isinstance(data, type(default)) else default
    except FileNotFoundError:
        return default
    except (OSError, ValueError):
        raise PhotoError('store_unreadable', relative)


def _write_json(relative, payload):
    path = _home() / 'workspace' / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.new')
    with open(temp, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def _photos():
    data = _read_json(PHOTO_INDEX, {'records': []})
    return [r for r in data.get('records', []) if isinstance(r, dict)]


def _save_photos(records):
    _write_json(PHOTO_INDEX, {'records': records, 'savedAt': datetime.now(timezone.utc).isoformat()})


def _annotations():
    data = _read_json(PHOTO_ANNOT, {'records': []})
    return [r for r in data.get('records', []) if isinstance(r, dict)]


def _save_annotations(records):
    _write_json(PHOTO_ANNOT, {'records': records, 'savedAt': datetime.now(timezone.utc).isoformat()})


def _alive(record):
    return not record.get('deleted_at')


def _photo_file(record):
    path = _home() / 'workspace' / PHOTO_DIR / str(record['date']) / str(record['file'])
    return path


def _thumb_file(record):
    return _home() / 'workspace' / PHOTO_THUMB_DIR / (str(record['id']) + '.jpg')


def _make_thumb(source, store_id):
    """缩略图失败不影响主流程：它只是让墙上的小方块别加载原图。"""
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        target = _home() / 'workspace' / PHOTO_THUMB_DIR / (store_id + '.jpg')
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            image = image.convert('RGB')
            image.thumbnail((480, 480), Image.LANCZOS)
            image.save(target, 'JPEG', quality=82, optimize=True)
        return target
    except Exception:
        return None


def _size(path):
    try:
        from PIL import Image
        with Image.open(path) as image:
            return image.size
    except Exception:
        return (None, None)


def add_photo(data, *, suffix, author, photo_id=None, at=None, caption=None, name=None):
    """把一张照片存进来（她上传走 HTTP，我上传走工具），返回落盘后的记录。"""
    if author not in AUTHORS:
        raise PhotoError('invalid_author', str(author)[:20])
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise PhotoError('empty_photo')
    if len(data) > PHOTO_MAX_BYTES:
        raise PhotoError('photo_too_large', str(len(data)))
    suffix = (suffix or '').lower()
    if not SAFE_SUFFIX.match(suffix) or suffix not in MIME_BY_SUFFIX:
        raise PhotoError('unsupported_type', suffix[:12])
    pid = _photo_id(photo_id)
    moment = _bangkok_day(at)
    day = moment.date().isoformat()
    records = _photos()
    if any(r.get('id') == pid and _alive(r) for r in records):
        return next(r for r in records if r.get('id') == pid)  # 重试同一个 id：不重复存
    folder = _home() / 'workspace' / PHOTO_DIR / day
    folder.mkdir(parents=True, exist_ok=True)
    stored = pid + suffix
    path = folder / stored
    temp = folder / (stored + '.new')
    with open(temp, 'wb') as handle:
        handle.write(bytes(data))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)
    width, height = _size(path)
    thumb = _make_thumb(path, pid)
    record = {
        'id': pid, 'date': day, 'at': moment.isoformat(), 'source': author, 'owner': author,
        'file': stored, 'name': _text_header(name, 120) or stored,
        'mime': MIME_BY_SUFFIX[suffix], 'size': len(data),
        'sha256': hashlib.sha256(bytes(data)).hexdigest(),
        'width': width, 'height': height, 'thumb': bool(thumb),
        'caption': (_text_header(caption, PHOTO_ANNOT_MAX) or None),
        'deleted_at': None,
    }
    records.append(record)
    _save_photos(records)
    return record


def photo_days(start=None, end=None):
    """哪些天有照片、每天几张（时间轴用；没有照片的日子不造数据）。"""
    counts = {}
    for record in _photos():
        if not _alive(record):
            continue
        day = str(record.get('date') or '')
        if not day:
            continue
        if start and day < str(start):
            continue
        if end and day > str(end):
            continue
        counts[day] = counts.get(day, 0) + 1
    return [{'date': day, 'count': counts[day]} for day in sorted(counts, reverse=True)]


def _public(record):
    """给前端的字段：不含本地路径。"""
    out = {k: record.get(k) for k in (
        'id', 'date', 'at', 'source', 'owner', 'name', 'mime', 'size', 'sha256',
        'width', 'height', 'thumb', 'caption')}
    out['file'] = '/ziwei/web/photos/%s/file' % record.get('id')
    return out


def photos_page(day=None, limit=None, cursor=None, include_deleted=False):
    try:
        size = int(limit) if limit not in (None, '') else PHOTO_PAGE_DEFAULT
    except (TypeError, ValueError):
        raise PhotoError('invalid_limit')
    size = max(1, min(size, PHOTO_PAGE_MAX))
    records = [r for r in _photos() if include_deleted or _alive(r)]
    if day:
        records = [r for r in records if str(r.get('date')) == str(day)]
    records.sort(key=lambda r: (r.get('at') or '', r.get('id') or ''), reverse=True)
    if cursor:
        after = str(cursor)
        ids = [r.get('id') for r in records]
        if after in ids:
            records = records[ids.index(after) + 1:]
    window = records[:size]
    nxt = window[-1]['id'] if len(records) > size and window else None
    return {'data': [_public(r) for r in window], 'next_cursor': nxt, 'total': len(records), 'errors': []}


def photo_detail(photo_id):
    pid = _photo_id(photo_id)
    record = next((r for r in _photos() if r.get('id') == pid), None)
    if record is None or not _alive(record):
        raise PhotoError('photo_not_found', pid)
    notes = [n for n in _annotations() if n.get('photo_id') == pid and _alive(n)]
    notes.sort(key=lambda n: (n.get('at') or '', n.get('id') or ''))
    day = str(record.get('date'))
    same_day = [r for r in _photos()
                if _alive(r) and str(r.get('date')) == day and r.get('id') != pid]
    same_day.sort(key=lambda r: (r.get('at') or ''))
    return {'photo': _public(record), 'annotations': [_public_note(n) for n in notes],
            'same_day': [_public(r) for r in same_day], 'errors': []}


def _public_note(note):
    return {k: note.get(k) for k in ('id', 'photo_id', 'author', 'text', 'at', 'edited_at')}


def photo_bytes(photo_id, thumb=False):
    pid = _photo_id(photo_id)
    record = next((r for r in _photos() if r.get('id') == pid), None)
    if record is None or not _alive(record):
        raise PhotoError('photo_not_found', pid)
    path = _thumb_file(record) if thumb else _photo_file(record)
    if not path.exists():
        raise PhotoError('photo_file_missing', pid)
    return path.read_bytes(), (record.get('mime') if not thumb else 'image/jpeg')


def add_annotation(photo_id, text, *, author, note_id=None, at=None):
    if author not in AUTHORS:
        raise PhotoError('invalid_author', str(author)[:20])
    body = str(text or '').strip()
    if not body:
        raise PhotoError('empty_text')
    if len(body) > PHOTO_ANNOT_MAX:
        raise PhotoError('text_too_long', str(len(body)))
    photo = next((r for r in _photos() if r.get('id') == _photo_id(photo_id) and _alive(r)), None)
    if photo is None:
        raise PhotoError('photo_not_found', str(photo_id)[:40])
    nid = _photo_id(note_id)
    records = _annotations()
    if any(n.get('id') == nid and _alive(n) for n in records):
        return _public_note(next(n for n in records if n.get('id') == nid))
    note = {'id': nid, 'photo_id': photo['id'], 'author': author, 'text': body,
            'at': _bangkok_day(at).isoformat(), 'edited_at': None, 'deleted_at': None}
    records.append(note)
    _save_annotations(records)
    return _public_note(note)


def _own_note(note_id, author):
    nid = _photo_id(note_id)
    records = _annotations()
    for note in records:
        if note.get('id') == nid:
            if not _alive(note):
                raise PhotoError('note_not_found', nid)
            if note.get('author') != author:
                raise PhotoError('not_owner', '%s owns %s' % (note.get('author'), nid))
            return records, note
    raise PhotoError('note_not_found', nid)


def edit_annotation(note_id, text, *, author):
    body = str(text or '').strip()
    if not body:
        raise PhotoError('empty_text')
    if len(body) > PHOTO_ANNOT_MAX:
        raise PhotoError('text_too_long', str(len(body)))
    records, note = _own_note(note_id, author)
    note['text'] = body
    note['edited_at'] = datetime.now(timezone.utc).astimezone(BANGKOK).isoformat()
    _save_annotations(records)
    return _public_note(note)


def delete_annotation(note_id, *, author):
    records, note = _own_note(note_id, author)
    note['deleted_at'] = datetime.now(timezone.utc).astimezone(BANGKOK).isoformat()
    _save_annotations(records)
    return _public_note(note)


def delete_photo(photo_id, *, author):
    """她可删任何一张；我只能删自己上传的那张（source 与 owner 都必须是 ziwei）。"""
    pid = _photo_id(photo_id)
    records = _photos()
    for record in records:
        if record.get('id') != pid:
            continue
        if not _alive(record):
            raise PhotoError('photo_not_found', pid)
        if author == ZIWEI and record.get('owner') != ZIWEI:
            raise PhotoError('not_owner', pid)
        if author not in AUTHORS:
            raise PhotoError('invalid_author', str(author)[:20])
        record['deleted_at'] = datetime.now(timezone.utc).astimezone(BANGKOK).isoformat()
        _save_photos(records)
        return _public(record)
    raise PhotoError('photo_not_found', pid)


def summary():
    records = _photos()
    alive = [r for r in records if _alive(r)]
    notes = [n for n in _annotations() if _alive(n)]
    return {'photos': len(alive), 'days': len({r.get('date') for r in alive}),
            'annotations': len(notes), 'deleted': len(records) - len(alive)}


# 给路由层用的公开别名（下划线版本是内部实现）
public_photo = _public
public_note = _public_note
