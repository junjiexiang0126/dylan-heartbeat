"""Voluntary, durable pats; no model loop or memory writer."""
import json
from datetime import datetime, timezone


def publish(args, bridge):
    try:
        record = {'id': bridge._uuid(args.get('id'), 'id'), 'at': datetime.now(timezone.utc).isoformat(),
                  'author': 'ziwei', 'target': 'user'}
        fd = bridge._open_workspace()
        try:
            with bridge._moment_lock(fd):
                try:
                    records = json.loads(bridge.read_beneath(bridge.home() / 'workspace', 'web-pokes.json', 1048576))['records']
                except FileNotFoundError:
                    records = []
                old = next((r for r in records if r['id'] == record['id']), None)
                if old:
                    return json.dumps({'record': old, 'replayed': True})
                if records and (datetime.now(timezone.utc)-datetime.fromisoformat(records[-1]['at'])).total_seconds() < 3:
                    return json.dumps({'error': 'poke_cooldown'})
                records.append(record)
                name = 'web-pokes-' + bridge.os.urandom(8).hex() + '.tmp'
                try:
                    out = bridge.os.open(name, bridge.os.O_WRONLY | bridge.os.O_CREAT | bridge.os.O_EXCL | bridge.os.O_NOFOLLOW, 0o600, dir_fd=fd)
                    with bridge.os.fdopen(out, 'w') as stream:
                        json.dump({'records': records}, stream);stream.flush();bridge.os.fsync(stream.fileno())
                    bridge.os.rename(name, 'web-pokes.json', src_dir_fd=fd, dst_dir_fd=fd);bridge.os.fsync(fd)
                finally:
                    try: bridge.os.unlink(name, dir_fd=fd)
                    except FileNotFoundError: pass
        finally:
            bridge.os.close(fd)
        return json.dumps({'record': record, 'replayed': False})
    except (OSError, ValueError, KeyError, TypeError, bridge.MomentError):
        return json.dumps({'error': 'poke_write_failed'})


def page(bridge, cursor=None):
    try:
        records = json.loads(bridge.read_beneath(bridge.home() / 'workspace', 'web-pokes.json', 1048576))['records']
    except FileNotFoundError:
        records = []
    after = bridge._decode_cursor(cursor) if cursor else None
    rows = sorted(records, key=lambda r: (r['at'], r['id']))
    rows = [r for r in rows if not after or (r['at'], r['id']) > after]
    data = [{k:r[k] for k in ('id', 'at', 'author', 'target')} for r in rows[:100]]
    return {'data': data, 'next_cursor': bridge._encode_cursor(data[-1]) if len(rows)>100 else None, 'has_more':len(rows)>100}
