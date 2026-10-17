"""备忘录（memo）：她写的条目，我只存取，不改她的字。

存储：workspace/memos.json —— {"items": [{"id", "text", "at", "updatedAt", "pinned"}]}
规矩：
- 只增改她写的内容；我不擅自编辑、不替她"优化"措辞。
- 上限：单条 2000 字，最多 500 条；超了报错，不静默丢。
- 删除是真删（她要求删就删），不做软删。
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

BANGKOK = timezone(timedelta(hours=7))
TEXT_MAX = 2000
ITEMS_MAX = 500


class MemoError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _now() -> str:
    return datetime.now(BANGKOK).isoformat(timespec='seconds')


def _path(root) -> Path:
    return Path(root) / 'memos.json'


def _load(root) -> list:
    path = _path(root)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise MemoError('memo_store_unreadable')
    items = data.get('items') if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


def _save(root, items) -> None:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    path = _path(root)
    tmp = path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps({'items': items}, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, path)


def _clean(text) -> str:
    value = str(text or '').strip()
    if not value:
        raise MemoError('text_required')
    if len(value) > TEXT_MAX:
        raise MemoError('text_too_long')
    return value


def listing(root, *, q=None, limit=None) -> dict:
    items = _load(root)
    if q:
        needle = str(q).strip().lower()
        items = [i for i in items if needle in str(i.get('text', '')).lower()]
    items = sorted(items, key=lambda i: (bool(i.get('pinned')), str(i.get('updatedAt') or i.get('at'))), reverse=True)
    if limit not in (None, ''):
        try:
            cap = int(limit)
        except (TypeError, ValueError):
            raise MemoError('invalid_limit')
        if cap <= 0:
            raise MemoError('invalid_limit')
        items = items[:cap]
    return {'items': items, 'total': len(items)}


def add(root, text) -> dict:
    items = _load(root)
    if len(items) >= ITEMS_MAX:
        raise MemoError('memo_limit_reached')
    stamp = _now()
    item = {'id': uuid.uuid4().hex[:16], 'text': _clean(text), 'at': stamp, 'updatedAt': stamp, 'pinned': False}
    items.append(item)
    _save(root, items)
    return item


def update(root, memo_id, text) -> dict:
    items = _load(root)
    for item in items:
        if item.get('id') == memo_id:
            item['text'] = _clean(text)
            item['updatedAt'] = _now()
            _save(root, items)
            return item
    raise MemoError('memo_not_found')


def remove(root, memo_id) -> dict:
    items = _load(root)
    remaining = [i for i in items if i.get('id') != memo_id]
    if len(remaining) == len(items):
        raise MemoError('memo_not_found')
    _save(root, remaining)
    return {'ok': True, 'deleted': memo_id}


def count(root) -> int:
    return len(_load(root))
