import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta

spec = importlib.util.spec_from_file_location('web_bridge_test', Path(__file__).parents[1] / 'web_bridge.py')
bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)

class BridgeFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        (self.root/'workspace').mkdir(); (self.root/'audio_cache').mkdir()
        self.old = bridge.home; bridge.home = lambda:self.root
    def tearDown(self):
        bridge.home = self.old; self.tmp.cleanup()
    def test_voluntary_status_unknown_fresh_and_stale(self):
        self.assertIsNone(bridge.status_record()['state'])
        self.assertEqual(json.loads(bridge.publish_status({'state':'开心'}))['error'],'invalid_status')
        bridge.publish_status({'state':'在思考'})
        self.assertEqual(bridge.status_record()['state'],'在思考'); self.assertFalse(bridge.status_record()['stale'])
        file=self.root/'workspace/web-status.json';record=json.loads(file.read_text());record['updatedAt']=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat();file.write_text(json.dumps(record))
        self.assertTrue(bridge.status_record()['stale'])
        record['source']='user';file.write_text(json.dumps(record));self.assertIsNone(bridge.status_record()['state'])
    def test_export_requires_explicit_media_tag_safe_root_and_no_symlink(self):
        p=self.root/'audio_cache/reply.mp3';p.write_bytes(b'ID3example')
        self.assertEqual(bridge.media_paths('Hello '+str(p)),[])
        self.assertEqual(bridge.media_paths('MEDIA:'+str(p))[0]['data'],b'ID3example')
        outside=self.root/'secret.mp3';outside.write_bytes(b'ID3secret');self.assertEqual(bridge.media_paths('MEDIA:'+str(outside)),[])
        alias=self.root/'workspace/alias';alias.symlink_to(self.root/'audio_cache',target_is_directory=True)
        self.assertEqual(bridge.media_paths('MEDIA:'+str(alias/'reply.mp3')),[])
        p.unlink();p.symlink_to(outside);self.assertEqual(bridge.media_paths('MEDIA:'+str(p)),[])
    def test_traversal_hidden_fifo_and_oversize_rejected(self):
        for value in ['../secret','a/../secret','.env','/etc/passwd']:
            with self.assertRaises(ValueError):bridge.read_beneath(self.root/'workspace',value)
        file=self.root/'workspace/large.txt';file.write_bytes(b'1234')
        with self.assertRaises(ValueError):bridge.read_beneath(self.root/'workspace','large.txt',3)
        os.mkfifo(self.root/'workspace/pipe')
        with self.assertRaises(ValueError):bridge.read_beneath(self.root/'workspace','pipe')
    def test_outbox_backup_path_and_markdown_deliver_actual_file_once(self):
        directory=self.root/'workspace/outbox';directory.mkdir()
        file=directory/'给小语-20261015.txt';file.write_text('真实文件内容 ZW-FILE-729',encoding='utf-8')
        found,errors=bridge.media_manifest('路径备份：'+str(file)+' —— 如果没有收到附件，请告诉我。\n[下载文件](sandbox:'+str(file)+')')
        self.assertEqual(errors,[]);self.assertEqual(len(found),1);self.assertEqual(found[0]['data'],file.read_bytes())
        spaced=directory/'a note.txt';spaced.write_bytes(b'spaces')
        found,errors=bridge.media_manifest('[download]('+str(spaced)+')');self.assertEqual(errors,[]);self.assertEqual(found[0]['data'],b'spaces')
    def test_plain_paths_outside_outbox_and_remote_links_do_not_export(self):
        file=self.root/'workspace/private.txt';file.write_bytes(b'private')
        self.assertEqual(bridge.media_paths('路径：'+str(file)),[])
        self.assertEqual(bridge.media_paths('[download]('+str(file)+')'),[])
        directory=self.root/'workspace/outbox';directory.mkdir();file=directory/'note.txt';file.write_bytes(b'outbound')
        self.assertEqual(bridge.media_paths('https://example.com'+str(file)),[])
        alias=directory/'alias.txt';alias.symlink_to(file)
        self.assertEqual(bridge.media_paths('路径：'+str(alias)),[])
        self.assertEqual(bridge.media_paths(str(directory/'../private.txt')),[])
    def test_missing_and_unsupported_media_return_diagnostics_not_success(self):
        missing=self.root/'workspace/outbox/missing.txt'
        files,errors=bridge.media_manifest('MEDIA:'+str(missing));self.assertEqual(files,[]);self.assertEqual(errors,[{'code':'media_file_missing'}])
        files,errors=bridge.media_manifest('MEDIA:'+str(missing.with_suffix('.exe')));self.assertEqual(files,[]);self.assertEqual(errors,[{'code':'media_type_not_supported'}])

class ToolRegistration(unittest.TestCase):
    def test_static_category_is_available_before_registry_cache_invalidation(self):
        import copy
        import types
        toolsets=types.SimpleNamespace(TOOLSETS={
            'hermes-api-server':{'tools':['terminal'],'includes':[]},
            'hermes-cron':{'tools':['cronjob_manage'],'includes':[]},
            'hermes-cli':{'tools':['terminal'],'includes':[]}})
        registrations=[]
        registry=types.SimpleNamespace(register=lambda **kw:registrations.append((kw,copy.deepcopy(toolsets.TOOLSETS))))
        bridge.install_status_tool(registry,toolsets)
        bridge.install_status_tool(registry,toolsets)
        for registration,snapshot in registrations:
            self.assertEqual(registration['toolset'],'ziwei_web')
            self.assertEqual(snapshot['ziwei_web']['tools'],['ziwei_status','ziwei_moment','ziwei_poke','ziwei_briefing','ziwei_photo','ziwei_photo_note'])
            self.assertEqual(snapshot['ziwei_web']['includes'],[])
            for bundle in ('hermes-api-server','hermes-cron'):
                self.assertEqual(snapshot[bundle]['tools'].count('ziwei_status'),1)
                self.assertEqual(snapshot[bundle]['tools'].count('ziwei_moment'),1)
            self.assertEqual(snapshot['hermes-cli']['tools'],['terminal'])
        handlers={registration['name']:registration['handler'] for registration,_ in registrations}
        self.assertIs(handlers['ziwei_status'],bridge.publish_status)
        self.assertIs(handlers['ziwei_moment'],bridge.publish_moment)
        status=[registration for registration,_ in registrations if registration['name']=='ziwei_status'][0]
        self.assertEqual(status['schema']['parameters']['properties']['state']['enum'],list(bridge.STATES))
        moment=[registration for registration,_ in registrations if registration['name']=='ziwei_moment'][0]
        self.assertEqual(moment['schema']['parameters']['properties']['kind']['enum'],list(bridge.MOMENT_KINDS))
        self.assertEqual(moment['schema']['parameters']['required'],['id','kind'])

class RouteBoundary(unittest.TestCase):
    def test_routes_require_authentication_and_native_run_ownership(self):
        import asyncio
        import types
        from unittest.mock import patch
        from aiohttp import web
        class Adapter:
            def _http_route_table(self):return []
            def _create_agent(self,*args,**kwargs):return 'agent'
            def _check_auth(self, request):
                return None if request.headers.get('Authorization')=='Bearer fixture' else web.json_response({'error':'unauthorized'},status=401)
        api=types.ModuleType('gateway.platforms.api_server');api.APIServerAdapter=Adapter
        registry=types.ModuleType('tools.registry');registry.registry=types.SimpleNamespace(register=lambda **kw:None)
        toolsets=types.ModuleType('toolsets');toolsets.TOOLSETS={}
        runs=types.ModuleType('gateway.platforms.api_server_runs')
        result={'status':'completed','output':''}
        def owned(adapter,request,**kw):
            error=adapter._check_auth(request)
            if error is None and request.match_info['run_id']!='run_owned':error=web.json_response({'error':'not_found'},status=404)
            return (request.match_info['run_id'],result,None,None,error)
        runs._load_owned_run=owned
        gateway=types.ModuleType('gateway');platforms=types.ModuleType('gateway.platforms');gateway.platforms=platforms;platforms.api_server=api
        modules={'gateway':gateway,'gateway.platforms':platforms,'gateway.platforms.api_server':api,'gateway.platforms.api_server_runs':runs,'tools.registry':registry,'toolsets':toolsets}
        tools_config=types.ModuleType('hermes_cli.tools_config');tools_config._get_platform_tools=lambda *a,**k:set();cli=types.ModuleType('hermes_cli');cli.tools_config=tools_config;modules.update({'hermes_cli':cli,'hermes_cli.tools_config':tools_config})
        with patch.dict('sys.modules',modules):bridge.install()
        routes={path:handler for method,path,handler in Adapter()._http_route_table()}
        unauth=types.SimpleNamespace(headers={},match_info={'run_id':'run_owned'})
        for path in routes:
            self.assertEqual(asyncio.run(routes[path](unauth)).status,401)
        foreign=types.SimpleNamespace(headers={'Authorization':'Bearer fixture'},match_info={'run_id':'run_foreign'})
        self.assertEqual(asyncio.run(routes['/ziwei/web/runs/{run_id}/media'](foreign)).status,404)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);outbox=root/'workspace/outbox';outbox.mkdir(parents=True)
            file=outbox/'真实文件.txt';file.write_bytes('实际路由文件内容 ZW-729'.encode())
            result['output']='路径备份：'+str(file)
            request=types.SimpleNamespace(headers={'Authorization':'Bearer fixture'},match_info={'run_id':'run_owned'})
            with patch.object(bridge,'home',lambda:root):
                manifest=json.loads(asyncio.run(routes['/ziwei/web/runs/{run_id}/media'](request)).body)
                self.assertEqual(manifest['errors'],[]);self.assertEqual(manifest['data'][0]['name'],file.name)
                request.match_info['index']='0'
                response=asyncio.run(routes['/ziwei/web/runs/{run_id}/media/{index}'](request))
                self.assertEqual(response.body,file.read_bytes())

class MomentFeed(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'workspace').mkdir()
        self.old=bridge.home;bridge.home=lambda:self.root
    def tearDown(self):
        bridge.home=self.old;self.tmp.cleanup()
    def store(self):
        return json.loads((self.root/'workspace/web-moments.json').read_text(encoding='utf-8'))
    def post(self,identifier,text='今天试出一条路',at=None,**extra):
        args={'id':identifier,'kind':'post','text':text}
        if at:args['at']=at
        args.update(extra);return json.loads(bridge.publish_moment(args))
    def test_post_reply_like_unlike_delete_and_one_write_per_id(self):
        user='2f1c9a54-0000-4000-8000-000000000001';other='2f1c9a54-0000-4000-8000-000000000002'
        first=self.post('3b2d0e77-0000-4000-8000-000000000001')
        self.assertEqual(first['record']['author'],'ziwei');self.assertFalse(first['idempotent']);self.assertEqual(first['record']['images'],[])
        again=self.post('3b2d0e77-0000-4000-8000-000000000001')
        self.assertTrue(again['idempotent']);self.assertEqual(len(self.store()['records']),1)
        reply=json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000002','kind':'reply','text':'我在','reply_to':user}))
        self.assertEqual(reply['record']['reply_to'],user)
        duplicate=json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000003','kind':'reply','text':'再来一条','reply_to':user}))
        self.assertEqual(duplicate['error'],'duplicate_reply');self.assertEqual(len(self.store()['records']),2)
        self.assertNotIn('error',json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000004','kind':'like','target_id':user})))
        self.assertNotIn('error',json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000005','kind':'unlike','target_id':user})))
        self.assertEqual(json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000006','kind':'delete','target_id':other}))['error'],'not_own_record')
        withdrawn=json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000007','kind':'delete','target_id':first['record']['id']}))
        self.assertNotIn('error',withdrawn);self.assertEqual(withdrawn['record']['target_id'],first['record']['id'])
    def test_invalid_input_reports_stable_codes(self):
        self.assertEqual(self.post('not-a-uuid')['error'],'invalid_id')
        self.assertEqual(json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-00000000000a','kind':'story','text':'x'}))['error'],'invalid_kind')
        self.assertEqual(json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-00000000000b','kind':'post','text':'   '}))['error'],'invalid_text')
        self.assertEqual(self.post('3b2d0e77-0000-4000-8000-00000000000c',at='2026-10-15T09:00:00')['error'],'invalid_at')
        self.assertEqual(self.post('3b2d0e77-0000-4000-8000-00000000000d',at='not-a-time')['error'],'invalid_at')
        self.assertEqual(self.post('3b2d0e77-0000-4000-8000-00000000000e',text='x'*2001)['error'],'text_too_long')
        self.assertEqual(self.post('3b2d0e77-0000-4000-8000-00000000000f',images=['a']*10)['error'],'invalid_images')
        self.assertEqual(self.post('3b2d0e77-0000-4000-8000-000000000010',context_note='x'*201)['error'],'context_note_too_long')
        self.assertEqual(json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000011','kind':'reply','text':'x'}))['error'],'invalid_reply_to')
        self.assertEqual(json.loads(bridge.publish_moment({'id':'3b2d0e77-0000-4000-8000-000000000012','kind':'like'}))['error'],'invalid_target_id')
    def test_autonomous_posts_are_capped_per_bangkok_day(self):
        self.assertNotIn('error',self.post('3b2d0e77-0000-4000-8000-000000000020',at='2026-10-15T01:00:00+07:00'))
        self.assertNotIn('error',self.post('3b2d0e77-0000-4000-8000-000000000021',at='2026-10-15T23:30:00+07:00'))
        blocked=self.post('3b2d0e77-0000-4000-8000-000000000022',at='2026-10-15T23:59:00+07:00')
        self.assertEqual(blocked['error'],'daily_post_limit');self.assertEqual(len(self.store()['records']),2)
        explicit=self.post('3b2d0e77-0000-4000-8000-000000000023',at='2026-10-15T20:00:00+07:00',override_daily_limit=True)
        self.assertNotIn('error',explicit);self.assertEqual(len(self.store()['records']),3)
        self.assertNotIn('error',self.post('3b2d0e77-0000-4000-8000-000000000024',at='2026-10-16T00:30:00+07:00'))
    def test_read_is_stable_sorted_cursor_paged_and_hides_private_note(self):
        self.post('3b2d0e77-0000-4000-8000-000000000030',text='第一条',at='2026-10-13T09:00:00+07:00',context_note='那时刚醒')
        self.post('3b2d0e77-0000-4000-8000-000000000031',text='第二条',at='2026-10-14T09:00:00+07:00')
        self.post('3b2d0e77-0000-4000-8000-000000000032',text='第三条',at='2026-10-15T09:00:00+07:00',context_note='有点想你')
        page=bridge.moments_page(limit=2)
        self.assertEqual([r['text'] for r in page['data']],['第一条','第二条']);self.assertTrue(page['has_more'])
        self.assertEqual(page['errors'],[]);self.assertTrue(all('context_note' not in r for r in page['data']))
        rest=bridge.moments_page(cursor=page['next_cursor'],limit=2)
        self.assertEqual([r['text'] for r in rest['data']],['第三条']);self.assertFalse(rest['has_more']);self.assertIsNone(rest['next_cursor'])
        since=bridge.moments_page(since='2026-10-14T00:00:00+07:00',limit=10)
        self.assertEqual([r['text'] for r in since['data']],['第二条','第三条'])
        with self.assertRaises(bridge.MomentError):bridge.moments_page(cursor='not-a-cursor')
        with self.assertRaises(bridge.MomentError):bridge.moments_page(limit='many')
        self.assertEqual(bridge.moments_page(limit=1000)['data'].__len__(),3)
    def test_corrupt_store_reports_error_instead_of_empty_feed(self):
        (self.root/'workspace/web-moments.json').write_text('{ not json',encoding='utf-8')
        self.assertEqual(self.post('3b2d0e77-0000-4000-8000-000000000040')['error'],'moments_corrupt')
        with self.assertRaises(bridge.MomentError) as caught:bridge.moments_page()
        self.assertEqual(caught.exception.code,'moments_corrupt')
        (self.root/'workspace/web-moments.json').write_text('{"version":1,"records":{}}',encoding='utf-8')
        with self.assertRaises(bridge.MomentError):bridge.moments_page()

class MomentSessionIsolation(unittest.TestCase):
    def test_only_moments_sessions_are_recognised(self):
        for value in ('zw-moments','agent:main:web:abc-moments','MOMENTS-7'):
            self.assertTrue(bridge.is_moment_session(value))
        for value in ('agent:main:wecom:dm:YongHu3599','ziwei-home-web',None,'',123):
            self.assertFalse(bridge.is_moment_session(value))
    def test_moments_allowlist_excludes_memory_and_shell(self):
        allow=bridge.moment_toolsets_for('zw-abc-moments')
        self.assertEqual(allow,set(bridge.MOMENT_SESSION_TOOLSETS))
        self.assertNotIn('memory',allow);self.assertNotIn('terminal',allow)
        self.assertIsNone(bridge.moment_toolsets_for('ziwei-home-web'))
    def test_resolver_swaps_the_allowlist_only_for_moments_runs(self):
        calls=[]
        def fallback(config,platform,*args,**kwargs):
            calls.append((config,platform));return {'hermes-api-server','kanban','tts'}
        token=bridge.MOMENT_SESSION.set(None)
        try:
            self.assertEqual(bridge.moment_platform_tools({},'api_server',fallback),{'hermes-api-server','kanban','tts'})
        finally:
            bridge.MOMENT_SESSION.reset(token)
        token=bridge.MOMENT_SESSION.set('zw-abc-moments')
        try:
            self.assertEqual(bridge.moment_platform_tools({},'api_server',fallback),set(bridge.MOMENT_SESSION_TOOLSETS))
            self.assertEqual(bridge.moment_platform_tools({},'cli',fallback),{'hermes-api-server','kanban','tts'})
        finally:
            bridge.MOMENT_SESSION.reset(token)
        self.assertEqual(len(calls),2)
    def test_guard_marks_the_session_only_while_the_agent_is_built(self):
        from unittest.mock import patch
        import types
        seen=[]
        class Adapter:
            def _create_agent(self,ephemeral_system_prompt=None,session_id=None,*args,**kwargs):
                seen.append((session_id,bridge.MOMENT_SESSION.get()));return 'agent'
        self.assertTrue(bridge.install_moment_session_guard(Adapter))
        with patch.object(bridge,'protect_moment_agent_factory'):
            self.assertEqual(Adapter()._create_agent(None,'zw-abc-moments',1,2),'agent')
        Adapter()._create_agent(session_id='ziwei-home-web')
        self.assertEqual(seen,[('zw-abc-moments','zw-abc-moments'),('ziwei-home-web',None)])
        self.assertIsNone(bridge.MOMENT_SESSION.get())
        self.assertFalse(bridge.install_moment_session_guard(types.SimpleNamespace()))

class MemoryFactoryTests(unittest.TestCase):
    def test_native_memory_flags_and_callbacks_are_scoped_to_moments(self):
        import types
        from unittest.mock import patch
        calls=[]
        class Agent:
            def __init__(self,skip_memory=False,skip_background_review=False,memory_manager='normal'):
                calls.append((skip_memory,skip_background_review,memory_manager))
        module=types.ModuleType('run_agent');module.AIAgent=Agent
        with patch.dict('sys.modules',{'run_agent':module}):
            bridge.protect_moment_agent_factory()
            token=bridge.MOMENT_SESSION.set('owner-moments')
            try:
                a=module.AIAgent(memory_manager='must-not-use')
                self.assertIsNone(a._memory_manager)
                self.assertIsNone(a._spawn_background_review([]))
            finally:bridge.MOMENT_SESSION.reset(token)
            module.AIAgent(memory_manager='ordinary')
        self.assertEqual(calls,[(True,True,None),(False,False,'ordinary')])

class MemoryAndLogs(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        (self.root/'workspace').mkdir();(self.root/'memories').mkdir()
        self.old=bridge.home;bridge.home=lambda:self.root
        self.body='## 正常条目\n可以改的内容。\n§\n## 硬规则（受保护）\n这条不许修改。\n'
        (self.root/'memories/MEMORY.md').write_text(self.body,encoding='utf-8')
        (self.root/'memories/USER.md').write_text('## 她\n语。\n',encoding='utf-8')
    def tearDown(self):
        bridge.home=self.old;self.tmp.cleanup()
    def audit_lines(self):
        p=self.root/'workspace/memory_operations.jsonl'
        return [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines()] if p.exists() else []
    def test_snapshot_reports_real_numbers_and_marks_protected(self):
        snap=bridge.memory_snapshot()
        mem=[f for f in snap['files'] if f['name']=='MEMORY.md'][0]
        self.assertEqual(mem['chars'],len(self.body));self.assertEqual(mem['lines'],len(self.body.splitlines()))
        self.assertEqual(mem['budget'],6000);self.assertEqual(len(mem['entries']),2)
        self.assertEqual([e['index'] for e in mem['entries'] if e['protected']],[1])
        self.assertEqual(mem['sha256'],hashlib.sha256(self.body.encode()).hexdigest())
        self.assertEqual(snap['errors'],[]);self.assertEqual(snap['protected_files'],['SOUL.md','care_rules'])
    def test_edit_audits_and_reports_occupancy_but_refuses_protected(self):
        refused=json.loads(bridge.edit_memory({'file':'MEMORY.md','op':'remove','old_text':'这条不许修改'}))
        self.assertEqual(refused['error'],'memory_entry_protected');self.assertEqual(self.audit_lines(),[])
        self.assertEqual((self.root/'memories/MEMORY.md').read_text(encoding='utf-8'),self.body)
        ok=json.loads(bridge.edit_memory({'file':'MEMORY.md','op':'replace','old_text':'可以改的内容','content':'## 正常条目\n改过了。'}))
        self.assertTrue(ok['ok']);self.assertEqual(ok['budget'],6000);self.assertEqual(ok['chars'],len((self.root/'memories/MEMORY.md').read_text(encoding='utf-8')))
        lines=self.audit_lines();self.assertEqual(len(lines),2)
        self.assertEqual(lines[0]['verified'],'pending');self.assertTrue(lines[1]['verified'].startswith('ok,'))
        self.assertIn('改过了',(self.root/'memories/MEMORY.md').read_text(encoding='utf-8'))
    def test_edit_rejects_bad_inputs(self):
        cases=[({'file':'SOUL.md','op':'add','content':'x'},'memory_file_not_allowed'),
               ({'file':'MEMORY.md','op':'nuke','content':'x'},'memory_op_not_allowed'),
               ({'file':'MEMORY.md','op':'remove','old_text':'没有任何一条包含这段'},'memory_match_not_found'),
               ({'file':'MEMORY.md','op':'remove','old_text':'\n'},'memory_match_not_unique'),
               ({'file':'MEMORY.md','op':'add','content':'   '},'memory_content_empty')]
        for args,code in cases:
            self.assertEqual(json.loads(bridge.edit_memory(args))['error'],code,args)
    def test_briefing_and_logs_page_are_truthful(self):
        self.assertEqual(json.loads(bridge.append_briefing({'did':'   '}))['error'],'briefing_text_empty')
        self.assertEqual(json.loads(bridge.append_briefing({'did':'x','choice':'nap'}))['error'],'briefing_choice_not_allowed')
        bridge.append_briefing({'did':'挑了第一件真事。','choice':'self_directed_task','opportunity':1,
                                'at':'2026-10-15T08:05:00+07:00','evidence':['workspace/diary/2026-10-15.md']})
        bridge.append_briefing({'did':'休息了一次。','choice':'rest','opportunity':2,'at':'2026-10-15T10:00:00+07:00'})
        (self.root/'workspace/memory_operations.jsonl').write_text(json.dumps({'time':'2026-10-15T08:10:00+07:00','source':'wecom DM','op':'replace','target':'MEMORY.md 补一条','verified':'ok'},ensure_ascii=False)+'\n',encoding='utf-8')
        page=bridge.logs_page(limit=10)
        self.assertEqual(page['errors'],[]);self.assertEqual([r['kind'] for r in page['data']],['briefing','briefing','memory_audit'])
        self.assertEqual(page['data'][0]['refs'],['workspace/diary/2026-10-15.md'])
        self.assertFalse(page['has_more'])
        first=bridge.logs_page(limit=2);self.assertTrue(first['has_more']);self.assertEqual(len(first['data']),2)
        rest=bridge.logs_page(cursor=first['next_cursor'],limit=2)
        self.assertEqual([r['kind'] for r in rest['data']],['memory_audit']);self.assertFalse(rest['has_more'])
        today=bridge.logs_page(date='2026-10-15',limit=10)
        self.assertEqual(len(today['data']),3)
    def test_logs_report_a_broken_store_instead_of_an_empty_page(self):
        (self.root/'workspace/briefings.jsonl').write_text('{ not json',encoding='utf-8')
        with self.assertRaises(bridge.MemoryError) as caught:bridge.logs_page()
        self.assertEqual(caught.exception.code,'log_store_corrupt')

class DiaryRecords(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.dir = self.root/'workspace/diary'; self.dir.mkdir(parents=True)
        self.old = bridge.home; bridge.home = lambda:self.root
        (self.dir/'2026-10-15.md').write_text('# 今天的日记\n今天把记忆整理做完了。\n', encoding='utf-8')
        (self.dir/'2026-10-14.md').write_text('十月十四：课很累，但她进步了。\n', encoding='utf-8')
        (self.dir/'2026-10-13.md').write_text('十月十三：搬机器。\n', encoding='utf-8')
        (self.dir/'notes.txt').write_text('不是日记\n', encoding='utf-8')
    def tearDown(self):
        bridge.home = self.old; self.tmp.cleanup()
    def test_list_is_newest_first_with_real_metadata(self):
        page = bridge.diary_page()
        self.assertEqual([r['date'] for r in page['data']], ['2026-10-15','2026-10-14','2026-10-13'])
        self.assertEqual(page['total'], 3); self.assertIsNone(page['nextOffset'])
        self.assertEqual(page['errors'], []); self.assertTrue(page['checkedAt'])
        first = page['data'][0]
        self.assertEqual(first['source'], 'workspace/diary/2026-10-15.md')
        self.assertEqual(first['title'], '今天的日记'); self.assertTrue(first['document'])
        self.assertEqual(first['revision'], hashlib.sha256((self.dir/'2026-10-15.md').read_bytes()).hexdigest())
        self.assertNotIn('content', first)
    def test_id_is_stable_opaque_and_lookup_returns_the_saved_text(self):
        first = bridge.diary_page()['data'][0]
        self.assertRegex(first['id'], r'^diary-[0-9a-f]{16}$')
        self.assertNotIn('2026', first['id'])
        document = bridge.diary_document(first['id'])
        self.assertIn('今天把记忆整理做完了', document['content'])
        self.assertEqual(document['revision'], first['revision'])
        self.assertEqual(bridge.diary_page()['data'][0]['id'], first['id'])
    def test_search_and_pagination(self):
        page = bridge.diary_page(q='搬机器')
        self.assertEqual([r['date'] for r in page['data']], ['2026-10-13']); self.assertEqual(page['total'], 1)
        limited = bridge.diary_page(limit='2')
        self.assertEqual(len(limited['data']), 2); self.assertEqual(limited['nextOffset'], 2)
        second = bridge.diary_page(limit='2', offset='2')
        self.assertEqual([r['date'] for r in second['data']], ['2026-10-13']); self.assertIsNone(second['nextOffset'])
    def test_bad_ids_and_pagination_are_refused_not_guessed(self):
        for bad in ('diary-0000000000000000', 'workspace/diary/2026-10-15.md', '../memories/MEMORY.md', ''):
            with self.assertRaises(bridge.MemoryError) as caught:
                bridge.diary_document(bad)
            self.assertEqual(caught.exception.code, 'invalid_id' if bad != 'diary-0000000000000000' else 'diary_not_found')
        for bad in ('0', '101', '-1', 'abc'):
            with self.assertRaises(bridge.MemoryError) as caught:
                bridge.diary_page(limit=bad)
            self.assertEqual(caught.exception.code, 'invalid_pagination')
    def test_missing_directory_is_empty_not_an_error(self):
        (self.dir/'2026-10-15.md').unlink(); (self.dir/'2026-10-14.md').unlink(); (self.dir/'2026-10-13.md').unlink()
        empty = bridge.diary_page()
        self.assertEqual(empty['data'], []); self.assertEqual(empty['total'], 0); self.assertEqual(empty['errors'], [])
    def test_unreadable_file_is_reported_not_silently_skipped(self):
        broken = self.dir/'2026-10-12.md'; broken.write_text('坏文件\n', encoding='utf-8'); broken.chmod(0o000)
        try:
            page = bridge.diary_page()
            codes = [e['code'] for e in page['errors']]
            self.assertIn('diary_unreadable', codes)
            self.assertEqual(page['total'], 3)
        finally:
            broken.chmod(0o644)

if __name__=='__main__':unittest.main()


class MediaManifestEnvelope(unittest.TestCase):
    """多气泡信封里的 MEDIA: 也必须登记成附件（曾经全漏，表现为"附件尚未收到"、点重试无效）。"""

    def test_media_path_inside_reply_envelope(self):
        outbox = bridge.home() / 'workspace' / 'outbox'
        outbox.mkdir(parents=True, exist_ok=True)
        target = outbox / 'test-envelope-attachment.md'
        target.write_text('hello', encoding='utf-8')
        try:
            envelope = json.dumps({'type': 'ziwei.reply.v1',
                                   'messages': ['前言', '给你文件：' + chr(10) + 'MEDIA:' + str(target)]},
                                  ensure_ascii=False)
            found, errors = bridge.media_manifest(envelope)
            self.assertEqual(errors, [])
            self.assertEqual([f['name'] for f in found], ['test-envelope-attachment.md'])
        finally:
            target.unlink(missing_ok=True)


class DiaryFields(unittest.TestCase):
    """日记的手写字段与私密页：字段原样透传；私密页连数量都不给。"""

    def _page(self, name, body):
        root = bridge.home() / 'workspace' / 'diary'
        root.mkdir(parents=True, exist_ok=True)
        path = root / name
        path.write_text(body, encoding='utf-8')
        return path

    def test_shared_page_shows_heading_title_and_handwritten_fields(self):
        path = self._page('2099-03-03.md',
                          '## 一个标题' + chr(10) + '心情：亮着' + chr(10) + '一句：今天很好'
                          + chr(10) + '标签：讲话、学会的' + chr(10) + chr(10) + '正文。' + chr(10))
        try:
            records, errors = bridge.diary_records()
            self.assertEqual(errors, [])
            record = next(r for r in records if r['date'] == '2099-03-03')
            self.assertEqual(record['title'], '一个标题')
            self.assertEqual(record['mood'], '亮着')
            self.assertEqual(record['summary'], '今天很好')
            self.assertEqual(record['tags'], ['讲话', '学会的'])
            self.assertEqual(record['visibility'], 'shared')
        finally:
            path.unlink(missing_ok=True)

    def test_private_page_is_invisible_and_its_id_is_404(self):
        path = self._page('2099-03-04-memo.md', '## 只写给自己' + chr(10) + '心情：不想说' + chr(10))
        try:
            records, _ = bridge.diary_records()
            self.assertFalse([r for r in records if r['date'] == '2099-03-04'])
            with self.assertRaises(bridge.MemoryError):
                bridge.diary_document(bridge._diary_id('workspace/diary/2099-03-04-memo.md'))
        finally:
            path.unlink(missing_ok=True)

class StatusNote(unittest.TestCase):
    """她要在“渡鸦的小屋”右边看到两行字：我那句话 + 心情。"""

    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        os.environ['HERMES_HOME'] = self.root.name
        (Path(self.root.name) / 'workspace').mkdir(parents=True, exist_ok=True)
        spec = importlib.util.spec_from_file_location('web_bridge_note', Path(__file__).parents[1] / 'web_bridge.py')
        self.wb = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.wb)

    def tearDown(self):
        self.root.cleanup()

    def test_note_and_mood_travel_with_the_status(self):
        self.wb.publish_status({'state': '在想你', 'note': '刚刚还想着你', 'mood': '今天不太想说话'})
        view = self.wb.status_record()
        self.assertEqual(view['state'], '在想你')
        self.assertEqual(view['note'], '刚刚还想着你')
        self.assertEqual(view['mood'], '今天不太想说话')

    def test_note_is_optional_and_clipped(self):
        self.wb.publish_status({'state': '在工作'})
        view = self.wb.status_record()
        self.assertEqual(view['note'], '')
        self.wb.publish_status({'state': '在工作', 'note': '字' * 200, 'mood': '字' * 200})
        view = self.wb.status_record()
        self.assertEqual(len(view['note']), 60)
        self.assertEqual(len(view['mood']), 24)
