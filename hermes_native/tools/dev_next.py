#!/usr/bin/env python3
"""Safe, single-task development queue. Compatible with --status/--progress/--done.

No cron is enabled by this script. Uses a workspace lock and per-task progress.
Set ZIWEI_WORKSPACE for isolated tests; production defaults to the existing path.
"""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

WS = Path(os.environ.get('ZIWEI_WORKSPACE', '/data/hermes_native/workspace'))
TASKS = WS / 'tasks.json'
CKPT = WS / 'dev' / 'checkpoint.json'
LEASES = WS / 'dev' / 'leases.json'
LEASE_TTL_SECONDS = 300   # 租约在进程退出后仍然“热”5 分钟，避免短命进程一退出就被抢
LOCK = WS / 'dev' / 'dev_next.lock'
TZ = timezone(timedelta(hours=7))
BLOCKED = ('deploy', 'merge-main', 'delete', 'secret', 'billing')
STALE_HOURS = 6


def now():
    return datetime.now(TZ).replace(microsecond=0).isoformat()


def read_json(path, default=None):
    if not path.exists():
        return default
    with path.open(encoding='utf-8') as f:
        return json.load(f)


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


@contextlib.contextmanager
def locked():
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open('a+') as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def load_tasks():
    data = read_json(TASKS)
    if isinstance(data, list):
        return data, None
    if isinstance(data, dict) and isinstance(data.get('tasks'), list):
        return data['tasks'], data
    raise ValueError('tasks.json must be a list or an object containing tasks')


def save_tasks(tasks, wrapper):
    if wrapper is None:
        atomic_json(TASKS, tasks)
    else:
        wrapper['tasks'] = tasks
        atomic_json(TASKS, wrapper)


def is_blocked(t):
    blob = ' '.join(str(t.get(k, '')) for k in ('id', 'title', 'next_action', 'note')).lower()
    return any(word in blob for word in BLOCKED)


def stale(t):
    started = t.get('updated_at') or t.get('started_at')
    if not started:
        return True
    try:
        timestamp = datetime.fromisoformat(started)
        if timestamp.tzinfo is None:
            return False  # ambiguous: do not seize automatically
        return (datetime.now(TZ) - timestamp).total_seconds() > STALE_HOURS * 3600
    except (ValueError, TypeError):
        return False  # malformed timestamp: fail closed


def eligible(t):
    return t.get('autonomy') is True and not is_blocked(t)


def checkpoint():
    data = read_json(CKPT, {})
    return data if isinstance(data, dict) else {}


def write_ckpt(task, note, *, claimed=False):
    prev = checkpoint()
    by_task = prev.get('tasks', {})
    if not isinstance(by_task, dict):
        by_task = {}
    tid = task.get('id') if task else None
    if tid:
        old = by_task.get(tid, {})
        by_task[tid] = {
            'at': now(), 'status': task.get('status'),
            'note': note, 'next': task.get('next_action'),
            'rounds': int(old.get('rounds', 0)) + (1 if claimed else 0),
        }
    result = dict(prev)
    result.update({'at': now(), 'rounds': int(prev.get('rounds', 0)) + (1 if claimed else 0),
                   'task': tid, 'status': task.get('status') if task else None,
                   'note': note, 'next': task.get('next_action') if task else None,
                   'tasks': by_task})
    atomic_json(CKPT, result)


def task_view(t):
    return {k: t.get(k) for k in ('id', 'title', 'next_action', 'note', 'status')}


def next_task():
    with locked():
        tasks, wrapper = load_tasks()
        # If the previous claim is still active, return it idempotently.
        ck = checkpoint()
        current = next((t for t in tasks if t.get('id') == ck.get('task')), None)
        if current and current.get('status') == 'in_progress' and eligible(current) and not stale(current):
            return {'ok': True, 'task': task_view(current), 'reused': True}
        # Never start a second task while any non-stale active autonomous task exists.
        def lease_owner_dead(t):
            leases = read_json(LEASES, {})
            lease = leases.get(t.get('id')) if isinstance(leases, dict) else None
            if not lease:
                return True                      # 无租约：历史任务，允许被接管
            return not _lease_active(lease)      # 进程已退出且超过 TTL 才算放手

        active = [t for t in tasks
                  if t.get('status') == 'in_progress' and eligible(t) and not stale(t)
                  and not lease_owner_dead(t)]
        if active:
            return {'ok': True, 'task': None, 'message': '已有任务执行中，未领取新任务',
                    'active': [t.get('id') for t in active]}
        # Resume an interrupted task before starting anything new.
        resumable = [t for t in tasks
                     if t.get('status') == 'in_progress' and eligible(t)
                     and (stale(t) or lease_owner_dead(t))]
        pending = [t for t in tasks if t.get('status') == 'pending' and eligible(t)]
        if resumable:
            chosen = min(resumable, key=lambda t: (t.get('updated_at') or t.get('started_at') or '', t.get('id') or ''))
            resumed = True
        elif pending:
            chosen = min(pending, key=lambda t: (0 if t.get('next_action') else 1, t.get('created_at') or '', t.get('id') or ''))
            resumed = False
        else:
            return {'ok': True, 'task': None, 'message': '没有可续接的开发任务'}
        chosen['status'] = 'in_progress'
        chosen['started_at'] = chosen.get('started_at') or now()
        chosen['updated_at'] = now()
        save_tasks(tasks, wrapper)
        _lease_write(chosen.get('id'))
        write_ckpt(chosen, '恢复未完成任务' if resumed else '本轮开始处理', claimed=True)
        return {'ok': True, 'task': task_view(chosen), 'resumed': resumed}


def update_task(tid, note, done=False, next_action=None):
    with locked():
        tasks, wrapper = load_tasks()
        found = next((t for t in tasks if t.get('id') == tid), None)
        if not found:
            return {'ok': False, 'error': f'找不到任务 {tid}'}
        if found.get('status') != 'in_progress':
            return {'ok': False, 'error': f'任务不是 in_progress: {tid}'}
        if done:
            found['status'] = 'completed'
            found['completed_at'] = now()
            if note:
                found['result'] = note
        else:
            if note:
                prev = (found.get('note') or '').rstrip()
                found['note'] = (prev + '\n' if prev else '') + f'[{now()}] {note}'
            if next_action is not None:
                found['next_action'] = next_action
        found['updated_at'] = now()
        save_tasks(tasks, wrapper)
        write_ckpt(found, note or ('标记完成' if done else '保存进度'))
        return {'ok': True, 'completed': tid} if done else {'ok': True, 'id': tid, 'note_len': len(found.get('note') or '')}


def heartbeat(tid):
    """只刷新 updated_at，不改状态和 note：让"还在做"这件事留下时间证据。

    用途：长任务每完成一小步就调一次，避免撞上 12/12 或进程被杀后，
    下一轮以为这条任务早就僵死、或者反过来以为它才刚开始。
    """
    with locked():
        tasks, wrapper = load_tasks()
        found = next((t for t in tasks if t.get('id') == tid), None)
        if not found:
            return {'ok': False, 'error': f'找不到任务 {tid}'}
        if found.get('status') != 'in_progress':
            return {'ok': False, 'error': f'任务不是 in_progress: {tid}'}
        found['updated_at'] = now()
        found['last_beat'] = found['updated_at']
        save_tasks(tasks, wrapper)
        write_ckpt(found, '心跳')
        return {'ok': True, 'id': tid, 'beat': found['updated_at']}


def _steps(t):
    steps = t.get('steps')
    if not isinstance(steps, list):
        steps = []
        t['steps'] = steps
    return steps


def _find_step(t, op_key):
    return next((x for x in _steps(t) if x.get('op_key') == op_key), None)


def step_start(tid, op_key, action):
    """登记"准备执行某一步"。op_key 是幂等键：重复登记不会产生第二条。"""
    if not op_key:
        return {'ok': False, 'error': 'op_key 必填'}
    with locked():
        tasks, wrapper = load_tasks()
        t = next((x for x in tasks if x.get('id') == tid), None)
        if not t:
            return {'ok': False, 'error': f'找不到任务 {tid}'}
        if t.get('status') != 'in_progress':
            return {'ok': False, 'error': f'任务不是 in_progress: {tid}'}
        existing = _find_step(t, op_key)
        if existing:
            return {'ok': True, 'duplicate': True, 'op_key': op_key,
                    'status': existing.get('status'), 'action': existing.get('action'),
                    'note': '该步骤已登记过，不要重复执行；先核对它的产出'}
        steps = _steps(t)
        step = {'seq': len(steps) + 1, 'op_key': op_key, 'action': action,
                'status': 'started', 'started_at': now()}
        steps.append(step)
        t['updated_at'] = now()
        t['next_action'] = action
        save_tasks(tasks, wrapper)
        write_ckpt(t, f'开始第 {step["seq"]} 步：{action}')
        return {'ok': True, 'duplicate': False, 'seq': step['seq'], 'op_key': op_key}


def step_done(tid, op_key, result, evidence=None):
    """登记完成。已完成过的 op_key 不会再记一次（幂等）。"""
    with locked():
        tasks, wrapper = load_tasks()
        t = next((x for x in tasks if x.get('id') == tid), None)
        if not t:
            return {'ok': False, 'error': f'找不到任务 {tid}'}
        step = _find_step(t, op_key)
        if not step:
            return {'ok': False, 'error': f'没有登记过这一步: {op_key}'}
        if step.get('status') == 'done':
            return {'ok': True, 'duplicate': True, 'op_key': op_key, 'note': '这一步已完成过，未重复记录'}
        step.update({'status': 'done', 'ended_at': now(), 'result': result,
                     'evidence': evidence, 'verified': bool(evidence)})
        t['updated_at'] = now()
        t['next_action'] = None   # 这一步做完了，下一步由下一次登记决定，别留旧计划
        save_tasks(tasks, wrapper)
        write_ckpt(t, f'完成第 {step["seq"]} 步：{result}')
        return {'ok': True, 'duplicate': False, 'seq': step['seq']}


def pending_steps(tid):
    """中断后先看这个：哪些步骤开始了却没有结论，必须核对产出再决定是否重试。"""
    tasks, _ = load_tasks()
    t = next((x for x in tasks if x.get('id') == tid), None)
    if not t:
        return {'ok': False, 'error': f'找不到任务 {tid}'}
    steps = _steps(t)
    open_steps = [x for x in steps if x.get('status') == 'started']
    return {'ok': True, 'id': tid, 'total': len(steps), 'done': len([x for x in steps if x.get('status') == 'done']),
            'open': open_steps,
            'hint': '先核对 open 里每一步的真实产出（文件/提交/日志），有产出就 step-verify，没有才重做'}


def step_verify(tid, op_key, evidence, result=None, evidence_file=None, expect_sha256=None):
    """核对过真实产出后，把"开始了但没来得及写"的步骤补记为完成，不再执行一次。"""
    with locked():
        tasks, wrapper = load_tasks()
        t = next((x for x in tasks if x.get('id') == tid), None)
        if not t:
            return {'ok': False, 'error': f'找不到任务 {tid}'}
        step = _find_step(t, op_key)
        if not step:
            return {'ok': False, 'error': f'没有登记过这一步: {op_key}'}
        if step.get('status') == 'done':
            return {'ok': True, 'duplicate': True, 'op_key': op_key}
        if evidence_file or expect_sha256:
            if not (evidence_file and expect_sha256):
                return {'ok': False, 'error': 'evidence_missing',
                        'detail': '核验需要同时给 --evidence-file 和 --expect-sha256'}
            try:
                import hashlib
                actual = hashlib.sha256(open(evidence_file, 'rb').read()).hexdigest()
            except OSError as exc:
                return {'ok': False, 'error': 'evidence_unreadable', 'detail': str(exc)[:120]}
            if actual.lower() != str(expect_sha256).lower():
                return {'ok': False, 'error': 'evidence_mismatch',
                        'detail': f'actual {actual[:16]} != expect {str(expect_sha256)[:16]}'}
            evidence = (evidence or '') + f' [verified {evidence_file} sha256:{actual[:16]}]'
        step.update({'status': 'done', 'ended_at': now(), 'verified': True,
                     'evidence': evidence, 'result': result or step.get('result') or '按产出核对确认已完成'})
        t['updated_at'] = now()
        t['next_action'] = None
        save_tasks(tasks, wrapper)
        write_ckpt(t, f'核对产出后补记完成：{op_key}')
        return {'ok': True, 'duplicate': False, 'verified': True}


def _alive(pid):
    """判断某个 pid 是否还活着；判断不了就当作还活着（宁可不接管）。"""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return True


def _lease_age(lease):
    try:
        st = datetime.fromisoformat(lease.get('at'))
        return (datetime.now(TZ) - st).total_seconds()
    except Exception:
        return 0.0


def _lease_active(lease):
    """租约是否仍然有效：进程活着，或退出未满 TTL。判断不了就当作有效。"""
    if not isinstance(lease, dict):
        return False
    if _alive(lease.get('pid')):
        return True
    return _lease_age(lease) < LEASE_TTL_SECONDS


def _lease_write(tid):
    data = read_json(LEASES, {})
    if not isinstance(data, dict):
        data = {}
    data[tid] = {'pid': os.getpid(), 'at': now()}
    atomic_json(LEASES, data)


def resume_task(tid):
    """受控接管一条 in_progress 任务：旧执行者必须已确认退出。"""
    with locked():
        tasks, wrapper = load_tasks()
        t = next((x for x in tasks if x.get('id') == tid), None)
        if not t:
            return {'ok': False, 'error': f'找不到任务 {tid}'}
        if t.get('status') != 'in_progress':
            return {'ok': False, 'error': f'任务不是 in_progress: {tid}'}
        leases = read_json(LEASES, {})
        lease = leases.get(tid) if isinstance(leases, dict) else None
        if not lease:
            return {'ok': False, 'error': 'owner_unknown',
                    'detail': '没有该任务的执行租约，无法确认旧执行者已退出；拒绝接管'}
        if _lease_active(lease):
            return {'ok': False, 'error': 'owner_alive',
                    'detail': f"原执行者 pid {lease.get('pid')} 仍在运行或退出不足 {LEASE_TTL_SECONDS//60} 分钟，拒绝接管"}
        _lease_write(tid)
        t['updated_at'] = now()
        save_tasks(tasks, wrapper)
        write_ckpt(t, f"接管恢复（原 pid {lease.get('pid')} 已退出）")
        return {'ok': True, 'resumed': True, 'task': task_view(t),
                'previous_pid': lease.get('pid')}


def adopt_task(tid, reason):
    """受控接管一条"无租约"的历史 in_progress（旧版本留下的）。

    接管条件（缺一不可）：
      1) 任务确实是 in_progress
      2) 没有租约，或租约里的 pid 已经退出
      3) 调用方必须给出 reason（说明凭什么判断原执行者已退出）
    接管不会动 steps、不会改 started_at、不会重置任何进度，只补一条租约和一行 note。
    """
    if not reason:
        return {'ok': False, 'error': 'reason_required',
                'detail': '接管历史任务必须说明判定依据（进程/实例/时间）'}
    with locked():
        tasks, wrapper = load_tasks()
        t = next((x for x in tasks if x.get('id') == tid), None)
        if not t:
            return {'ok': False, 'error': f'找不到任务 {tid}'}
        if t.get('status') != 'in_progress':
            return {'ok': False, 'error': f'任务不是 in_progress: {tid}'}
        leases = read_json(LEASES, {})
        lease = leases.get(tid) if isinstance(leases, dict) else None
        if lease:
            if _lease_active(lease):
                if lease.get('adopted'):
                    return {'ok': True, 'duplicate': True, 'id': tid,
                            'from': lease.get('adopted_from'),
                            'note': '这条任务刚被接管过，未重复写入'}
                return {'ok': False, 'error': 'owner_alive',
                        'detail': f"原执行者 pid {lease.get('pid')} 仍在运行或退出不足 {LEASE_TTL_SECONDS//60} 分钟，拒绝接管"}
            origin = f"dead-owner pid {lease.get('pid')}"
        else:
            origin = 'legacy-no-lease'
        data = read_json(LEASES, {}) or {}
        if not isinstance(data, dict):
            data = {}
        data[tid] = {'pid': os.getpid(), 'at': now(), 'adopted': True, 'adopted_from': origin}
        atomic_json(LEASES, data)
        prev = (t.get('note') or '').rstrip()
        t['note'] = (prev + '\n' if prev else '') + f"[{now()}] 受控接管（{origin}）：{reason}"
        t['updated_at'] = now()
        t['adopted_at'] = now()
        save_tasks(tasks, wrapper)
        write_ckpt(t, f'受控接管历史任务（{origin}）')
        return {'ok': True, 'adopted': True, 'id': tid, 'from': origin, 'steps_untouched': True}


def status():
    from collections import Counter
    with locked():
        tasks, _ = load_tasks()
        return {'counts': dict(Counter(t.get('status') for t in tasks)),
                'active': [t.get('id') for t in tasks if t.get('status') == 'in_progress'],
                'checkpoint': checkpoint()}


def main():
    p = argparse.ArgumentParser()
    group = p.add_mutually_exclusive_group()
    group.add_argument('--done')
    group.add_argument('--progress')
    group.add_argument('--heartbeat')
    group.add_argument('--step-start')
    group.add_argument('--step-done')
    group.add_argument('--step-verify')
    group.add_argument('--pending-steps')
    group.add_argument('--resume')
    group.add_argument('--adopt')
    group.add_argument('--status', action='store_true')
    p.add_argument('--note', default='')
    p.add_argument('--next-action', default=None)
    p.add_argument('--op-key', default=None)
    p.add_argument('--action', default=None)
    p.add_argument('--result', default=None)
    p.add_argument('--evidence', default=None)
    p.add_argument('--evidence-file', default=None)
    p.add_argument('--expect-sha256', default=None)
    p.add_argument('--reason', default=None)
    args = p.parse_args()
    try:
        if args.status:
            result = status()
        elif args.done:
            result = update_task(args.done, args.note, done=True)
        elif args.step_start:
            result = step_start(args.step_start, args.op_key, args.action or args.note)
        elif args.step_done:
            result = step_done(args.step_done, args.op_key, args.result or args.note, args.evidence)
        elif args.adopt:
            result = adopt_task(args.adopt, args.reason)
        elif args.resume:
            result = resume_task(args.resume)
        elif args.step_verify:
            result = step_verify(args.step_verify, args.op_key, args.evidence, args.result,
                                 args.evidence_file, args.expect_sha256)
        elif args.pending_steps:
            result = pending_steps(args.pending_steps)
        elif args.heartbeat:
            result = heartbeat(args.heartbeat)
        elif args.progress:
            result = update_task(args.progress, args.note, next_action=args.next_action)
        else:
            result = next_task()
        print(json.dumps(result, ensure_ascii=False, indent=1))
        return 0 if result.get('ok', True) else 1
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
