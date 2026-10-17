"""日程（schedule）：把两处东西合在一张表上给她看。

来源一：Hermes 的定时任务（cron/jobs.json，只读，我不改它的东西）
来源二：她自己手动加的条目（workspace/schedule.json，我可以增删改）

输出按天分组，前端直接画时间轴：
{"generatedAt": "...", "days": [{"date": "2026-10-18", "items": [{time, source, text, id, ...}]}], "cron": [...], "manual": [...]}
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import date as _date, datetime, timedelta, timezone
from pathlib import Path

BANGKOK = timezone(timedelta(hours=7))
TEXT_MAX = 200
_DAY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_TIME_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')


class ScheduleError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _now() -> datetime:
    return datetime.now(BANGKOK)


def _manual_path(root) -> Path:
    return Path(root) / 'schedule.json'


def _manual_load(root) -> list:
    path = _manual_path(root)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise ScheduleError('schedule_store_unreadable')
    items = data.get('items') if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


def _manual_save(root, items) -> None:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    path = _manual_path(root)
    tmp = path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps({'items': items}, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, path)


def _clean(text) -> str:
    value = str(text or '').strip()
    if not value:
        raise ScheduleError('text_required')
    if len(value) > TEXT_MAX:
        raise ScheduleError('text_too_long')
    return value


def _check_slot(day, when) -> tuple:
    day = str(day or '').strip()
    when = str(when or '').strip()
    if not _DAY_RE.match(day):
        raise ScheduleError('invalid_date')
    if not _TIME_RE.match(when):
        raise ScheduleError('invalid_time')
    try:
        _date.fromisoformat(day)
    except ValueError:
        raise ScheduleError('invalid_date')
    return day, when


def add(root, *, day, time, text) -> dict:
    day, time = _check_slot(day, time)
    items = _manual_load(root)
    item = {'id': uuid.uuid4().hex[:16], 'date': day, 'time': time, 'text': _clean(text),
            'done': False, 'at': _now().isoformat(timespec='seconds')}
    items.append(item)
    _manual_save(root, items)
    return item


def set_done(root, item_id, done=True) -> dict:
    items = _manual_load(root)
    for item in items:
        if item.get('id') == item_id:
            item['done'] = bool(done)
            _manual_save(root, items)
            return item
    raise ScheduleError('schedule_not_found')


def remove(root, item_id) -> dict:
    items = _manual_load(root)
    remaining = [i for i in items if i.get('id') != item_id]
    if len(remaining) == len(items):
        raise ScheduleError('schedule_not_found')
    _manual_save(root, remaining)
    return {'ok': True, 'deleted': item_id}


def _cron_items(cron_dir) -> list:
    """只读：把定时任务的下一班次放进日程。"""
    path = Path(cron_dir) / 'jobs.json'
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    jobs = data.get('jobs') if isinstance(data, dict) else data
    if not isinstance(jobs, list):
        return []
    out = []
    for job in jobs:
        if not isinstance(job, dict) or job.get('enabled') is False:
            continue
        next_run = job.get('next_run_at')
        if not next_run:
            continue
        try:
            stamp = datetime.fromisoformat(str(next_run))
        except ValueError:
            continue
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=BANGKOK)
        stamp = stamp.astimezone(BANGKOK)
        out.append({'id': str(job.get('job_id') or job.get('id') or job.get('name')),
                    'name': str(job.get('name') or '定时提醒'),
                    'schedule': str(job.get('schedule') or ''),
                    'next_run_at': stamp.isoformat(timespec='seconds'),
                    'source': 'cron'})
    return out


def listing(root, cron_dir, *, days=7) -> dict:
    try:
        window = int(days)
    except (TypeError, ValueError):
        raise ScheduleError('invalid_days')
    if window <= 0 or window > 60:
        raise ScheduleError('invalid_days')
    today = _now().date()
    limit = today + timedelta(days=window - 1)

    buckets = {}

    def put(day: _date, item: dict):
        if day < today or day > limit:
            return
        buckets.setdefault(day.isoformat(), []).append(item)

    manual = _manual_load(root)
    for item in manual:
        try:
            day = _date.fromisoformat(str(item.get('date')))
        except ValueError:
            continue
        put(day, {'time': item.get('time'), 'text': item.get('text'), 'source': 'manual',
                  'id': item.get('id'), 'done': bool(item.get('done'))})

    cron_rows = _cron_items(cron_dir)
    for row in cron_rows:
        stamp = datetime.fromisoformat(row['next_run_at'])
        put(stamp.date(), {'time': stamp.strftime('%H:%M'), 'text': row['name'],
                           'source': 'cron', 'id': row['id'], 'done': False})

    days_out = []
    for day in sorted(buckets):
        items = sorted(buckets[day], key=lambda i: str(i.get('time')))
        days_out.append({'date': day, 'count': len(items), 'items': items})
    return {'generatedAt': _now().isoformat(timespec='seconds'),
            'windowDays': window, 'days': days_out,
            'cron': cron_rows, 'manual': manual}
