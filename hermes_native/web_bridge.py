"""Narrow Web integration: voluntary status and run-owned media, not an Agent loop.

All routes remain under the official API authentication and run ownership checks.
No identity, memory, model, scheduler or approval policy is changed.
"""
import asyncio
import hashlib
import json
import os
import re
import stat
from datetime import datetime, timezone
from pathlib import Path

STATES = ('在工作', '在休息', '在思考', '在想你')
MAX_BYTES = 20 * 1024 * 1024
MIME = {'.mp3':'audio/mpeg', '.wav':'audio/wav', '.m4a':'audio/mp4', '.ogg':'audio/ogg', '.weba':'audio/webm', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.pdf':'application/pdf', '.txt':'text/plain', '.md':'text/plain', '.docx':'application/octet-stream', '.xlsx':'application/octet-stream'}


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


def media_paths(output):
    # Only explicit MEDIA tags in this owned run's final output authorize export.
    paths = re.findall(r'^\s*MEDIA:\s*[`"\']?(/[^\r\n`"\']+?)[`"\']?\s*$', output or '', re.M)
    found = []
    for raw in paths[:6]:
        p = Path(raw.strip())
        if p.suffix.lower() not in MIME: continue
        for root in (home() / 'workspace', home() / 'audio_cache'):
            try:
                relative = p.relative_to(root)
                data = read_beneath(root, relative)
                found.append({'name':p.name, 'mime':MIME[p.suffix.lower()], 'size':len(data), 'sha256':hashlib.sha256(data).hexdigest(), 'data':data})
                break
            except (OSError, ValueError): continue
    return found


def install():
    import gateway.platforms.api_server as api
    from gateway.platforms.api_server_runs import _load_owned_run
    from aiohttp import web
    from tools.registry import registry
    import toolsets
    adapter = api.APIServerAdapter
    if getattr(adapter, '_ziwei_web_installed', False): return

    registry.register(name='ziwei_status', toolset='ziwei_web', schema={
        'name':'ziwei_status',
        'description':'Publish your own current status to the private 知微之家 Web UI. Choose only a truthful present state, not a fabricated or automatic feeling. Optional; no need to publish every turn. Expires as current status after 30 minutes. Does not change memory or personality.',
        'parameters':{'type':'object','properties':{'state':{'type':'string','enum':list(STATES)}},'required':['state'],'additionalProperties':False}}, handler=publish_status)
    for bundle in ('hermes-api-server', 'hermes-cron'):
        tools = toolsets.TOOLSETS.get(bundle, {}).get('tools', [])
        if 'ziwei_status' not in tools: tools.append('ziwei_status')

    async def state(self, request):
        err = self._check_auth(request)
        if err is not None: return err
        value = await asyncio.to_thread(status_record)
        return web.json_response(value, headers={'Cache-Control':'no-store'})

    async def media(self, request):
        _, run, _, _, err = _load_owned_run(self, request, _api_server=api, permission='status', active_fallback=False)
        if err is not None: return err
        if run.get('status') not in ('completed', 'failed', 'interrupted'): return web.json_response({'data':[]})
        files = await asyncio.to_thread(media_paths, run.get('output', ''))
        index = request.match_info.get('index')
        if index is None:
            return web.json_response({'data':[{k:v for k,v in f.items() if k!='data'} for f in files]}, headers={'Cache-Control':'no-store'})
        if not index.isdigit() or int(index) >= len(files): raise web.HTTPNotFound()
        item = files[int(index)]
        return web.Response(body=item['data'], content_type=item['mime'], headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Content-Sha256':item['sha256']})

    original = adapter._http_route_table
    def routes(self):
        return original(self) + [('GET','/ziwei/web/state',lambda request:state(self,request)), ('GET','/ziwei/web/runs/{run_id}/media',lambda request:media(self,request)), ('GET','/ziwei/web/runs/{run_id}/media/{index}',lambda request:media(self,request))]
    adapter._http_route_table = routes
    adapter._ziwei_web_installed = True
