"""Real temporary source stores: automatic projection without impression writes."""
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1]))
import impressions
spec = importlib.util.spec_from_file_location('impressions_bridge_test', Path(__file__).parents[1] / 'web_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ImpressionsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        (self.root/'workspace/diary').mkdir(parents=True)
        (self.root/'logs').mkdir()
        (self.root/'logs/autonomy_preflight.jsonl').write_text('')
        self.old_home = bridge.home; bridge.home = lambda: self.root
        self.addCleanup(setattr, bridge, 'home', self.old_home)
        self.db = sqlite3.connect(self.root/'state.db'); self.addCleanup(self.db.close)
        self.db.executescript('CREATE TABLE sessions(id TEXT PRIMARY KEY, source TEXT, started_at REAL, ended_at REAL, end_reason TEXT); CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,tool_name TEXT,tool_call_id TEXT,tool_calls TEXT,content TEXT,timestamp REAL);')
        self.at = datetime(2026,10,21,9,tzinfo=impressions.TZ)

    def put(self, path, data, lines=False):
        file = self.root/path; file.parent.mkdir(parents=True,exist_ok=True)
        file.write_text('\n'.join(json.dumps(r,ensure_ascii=False) for r in data) if lines else json.dumps(data,ensure_ascii=False))

    def session(self, sid='cron-a', hour=0, ended=True, reason='cron_complete'):
        at = (self.at+timedelta(hours=hour)).timestamp()
        self.db.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(sid,'cron',at,at+60 if ended else None,reason if ended else None));self.db.commit()
        return at

    def call(self, name, args, result, sid='cron-a', callid='c1', at=None):
        at = at or self.at.timestamp()+10
        self.db.execute('INSERT INTO messages(session_id,role,tool_calls,timestamp) VALUES(?,?,?,?)',(sid,'assistant',json.dumps([{'id':callid,'function':{'name':name,'arguments':json.dumps(args)}}]),at))
        if result is not None:
            self.db.execute('INSERT INTO messages(session_id,role,tool_name,tool_call_id,content,timestamp) VALUES(?,?,?,?,?,?)',(sid,'tool',name,callid,json.dumps(result),at+1))
        self.db.commit()

    def page(self, **kw): return bridge.impressions_page(**kw)

    def test_ten_wakes_multiple_actions_without_agent_sync(self):
        gates=[]
        for n in range(10):
            sid='cron-'+str(n);at=self.session(sid,n)
            gates.append({'time':impressions.stamp(at-1),'wakeAgent':True,'opportunity':n+1,'daily_limit':10})
            self.call('browser_navigate',{'url':'https://galatea.abysslumina.com/threads'},{'success':True},sid,'garden',at+2)
            self.call('write_file',{'path':'project/main.py'},{'success':True,'files_modified':['project/main.py']},sid,'code',at+4)
        self.put('logs/autonomy_preflight.jsonl',gates,True)
        value=self.page(limit=100)
        self.assertEqual(value['errors'],[])
        self.assertEqual(len([r for r in value['data'] if r['kind']=='garden']),10)
        self.assertEqual(len([r for r in value['data'] if r['title']=='维护代码']),10)
        self.assertEqual(value['wake']['dailyLimit'],10)
        self.assertFalse((self.root/'workspace/events/impressions.jsonl').exists())
        self.assertEqual(value['data'],self.page(limit=100)['data'])

    def test_native_saved_moment_memory_diary_without_briefing(self):
        self.put('workspace/web-moments.json',{'records':[{'id':'m1','author':'ziwei','kind':'post','at':self.at.isoformat(),'text':'hello','context_note':'PRIVATE'}]})
        self.put('workspace/memory_operations.jsonl',[{'time':self.at.isoformat(),'op':'update','target':'PRIVATE MEMORY','verified':'pending'}],True)
        (self.root/'workspace/diary/2026-10-21.md').write_text('## 今天的片段\n分享的内容')
        value=self.page();self.assertEqual({r['kind'] for r in value['data']},{'moments','memory','diary'})
        self.assertNotIn('PRIVATE',json.dumps(value))
        diary=next(r for r in value['data'] if r['kind']=='diary')
        self.assertEqual(bridge.diary_document(diary['target']['id'])['title'],'今天的片段')

    def test_failures_pending_and_unknown_never_become_success(self):
        self.session(ended=False)
        self.call('browser_navigate',{'url':'https://galatea.abysslumina.com/threads'},{'success':False,'error':'secret'},callid='fail')
        self.call('terminal',{'command':'secret shell'},{'exit_code':1,'output':'PRIVATE'},callid='shell')
        self.call('write_file',{'path':'a.py'},None,callid='pending')
        self.call('terminal',{},'unstructured success',callid='unknown')
        rows=self.page()['data']
        self.assertEqual(sum(r['state']=='failed' for r in rows),2)
        self.assertEqual(sum(r['state']=='in_progress' for r in rows),2)
        self.assertFalse(any(r['state']=='completed' for r in rows))
        self.assertNotIn('PRIVATE',json.dumps(rows));self.assertNotIn('secret',json.dumps(rows))

    def test_cursor_reaches_more_than_fifty_and_new_insert_does_not_duplicate(self):
        self.put('workspace/web-moments.json',{'records':[{'id':str(i),'author':'ziwei','kind':'post','at':(self.at+timedelta(seconds=i)).isoformat()} for i in range(125)]})
        first=self.page(limit=50)
        store=json.loads((self.root/'workspace/web-moments.json').read_text())
        store['records'].append({'id':'new','author':'ziwei','kind':'post','at':(self.at+timedelta(seconds=200)).isoformat()})
        self.put('workspace/web-moments.json',store)
        second=self.page(limit=50,cursor=first['nextCursor']);third=self.page(limit=50,cursor=second['nextCursor'])
        self.assertEqual(first['total'],125);self.assertEqual(len(third['data']),25)
        self.assertIsNone(third['nextCursor'])
        self.assertEqual(len({r['id'] for p in (first,second,third) for r in p['data']}),125)
        self.assertEqual(len(self.page(since=(self.at+timedelta(seconds=100)).isoformat())['data']),26)

    def test_retry_id_and_source_delete(self):
        self.session();self.call('write_file',{'path':'a.py'},{'success':True},callid='same');self.call('write_file',{'path':'a.py'},{'success':True},callid='same')
        self.assertEqual(len([r for r in self.page()['data'] if r['source']=='native_tool']),1)
        self.put('workspace/web-moments.json',{'records':[{'id':'p','author':'ziwei','kind':'post','at':self.at.isoformat()},{'id':'d','author':'ziwei','kind':'delete','target_id':'p','at':self.at.isoformat()}]})
        self.assertEqual([r['title'] for r in self.page()['data'] if r['source']=='moment'],['撤回了一条朋友圈'])

    def test_legacy_retract_malformed_sources_and_no_private_diary(self):
        self.put('workspace/events/impressions.jsonl',[{'id':'old','ts':self.at.isoformat(),'kind':'work','title':'old'},{'op':'retract','target':'old'},{'id':'secret','ts':self.at.isoformat(),'kind':'memo','title':'PRIVATE'}],True)
        (self.root/'workspace/diary/2026-10-21-private.md').write_text('visibility: private\n## PRIVATE\n秘密')
        (self.root/'workspace/memory_operations.jsonl').write_text('[]\nnot json')
        value=self.page();self.assertFalse(value['data']);self.assertTrue(value['errors']);self.assertNotIn('PRIVATE',json.dumps(value))

    def test_partial_source_failure_preserves_other_sources(self):
        self.session();self.call('memory',{'action':'add'},{'success':True})
        (self.root/'workspace/web-moments.json').write_text('{')
        value=self.page();self.assertTrue(value['errors']);self.assertTrue(any(r['kind']=='memory' for r in value['data']))

    def test_garden_exact_host_and_shell_http_not_overclaimed(self):
        self.assertFalse(impressions.garden_url('https://galatea.abysslumina.com.evil.test'))
        self.assertFalse(impressions.garden_url('https://galatea.abysslumina.com@evil.test'))
        result=impressions.tool_activity('terminal',{'command':'curl https://galatea.abysslumina.com/threads'},{'exit_code':0})
        self.assertEqual(result[0],'garden');self.assertEqual(result[3],'recorded')

    def test_deferred_tool_and_incomplete_run(self):
        self.session(reason='cron_incomplete_no_output')
        self.call('tool_call',{'name':'browser_navigate','arguments':{'url':'https://galatea.abysslumina.com/threads'}},{'success':True})
        rows=self.page()['data']
        self.assertTrue(any(r['kind']=='garden' and r['state']=='completed' for r in rows))
        self.assertTrue(any(r['source']=='native_session' and r['state']=='failed' for r in rows))

    def test_malformed_moment_does_not_hide_native_activity(self):
        self.session();self.call('write_file',{'path':'a.py'},{'success':True})
        self.put('workspace/web-moments.json',{'records':[{'id':{},'kind':'delete','target_id':[]} ]})
        value=self.page();self.assertTrue(value['errors']);self.assertTrue(any(r['title']=='维护代码' for r in value['data']))

    def test_invalid_pagination_and_offset_timezone(self):
        for kw in ({'limit':0},{'limit':201},{'cursor':'invalid!'},{'since':'nope'}):
            with self.subTest(kw=kw), self.assertRaises(bridge.MemoryError): self.page(**kw)
        self.assertEqual(impressions.stamp('2026-10-20T18:00:00Z')[:10],'2026-10-21')

    def test_read_only_database_and_skipped_wake(self):
        self.put('logs/autonomy_preflight.jsonl',[{'time':self.at.isoformat(),'wakeAgent':False,'reason':'daily opportunities used'}],True)
        before=(self.root/'state.db').read_bytes();value=self.page()
        self.assertEqual(value['data'][0]['state'],'skipped');self.assertEqual((self.root/'state.db').read_bytes(),before)

if __name__=='__main__': unittest.main()
