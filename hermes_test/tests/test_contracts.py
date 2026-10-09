"""Real SQLite/HTTP/MCP component tests. CannedExecutor is NOT LLM acceptance."""
import concurrent.futures
import json
import os
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ziwei.config import Settings
from ziwei.store import Store,Denied,Conflict,BudgetExceeded
from ziwei.server import Application,create_server
from ziwei.admin import restore

class StoreTests(unittest.TestCase):
    def setUp(self): self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def test_read_capability_cannot_add(self):
        token=self.store.grant('r')
        with self.assertRaises(Denied): self.store.mutate('add','x',key='x',actor='r',token=token)
        self.assertEqual(self.store.search(),[])
    def test_positive_service_budget_requires_prior_audit(self):
        with self.assertRaises(ValueError): Settings(Path(self.tmp.name),secrets.token_urlsafe(32),budget_fen=2000).validate()
    def test_add_capability_cannot_update_or_delete(self):
        token=self.store.grant('r',True);row=self.store.mutate('add','x',key='x',actor='r',token=token)
        for op in ('update','delete'):
            with self.assertRaises(Denied): self.store.mutate(op,'y',row['id'],1,key=op,actor='r',token=token)
    def test_revoked_capability_cannot_write(self):
        token=self.store.grant('r',True);self.store.revoke('r')
        with self.assertRaises(Denied): self.store.mutate('add','x',key='x',actor='r',token=token)
    def test_cas_and_retained_versions(self):
        row=self.store.mutate('add','first',key='a')
        updated=self.store.mutate('update','second',row['id'],1,'b')
        with self.assertRaises(Conflict): self.store.mutate('update','third',row['id'],1,'c')
        self.store.mutate('delete',ident=row['id'],revision=updated['revision'],key='d')
        with self.store.transaction() as db:
            self.assertEqual([r['content'] for r in db.execute('SELECT * FROM versions ORDER BY revision')],['first','second','second'])
        self.assertEqual(self.store.search(),[])
    def test_idempotency_and_duplicate_content(self):
        first=self.store.mutate('add','fact',key='a')
        self.assertEqual(first,self.store.mutate('add','fact',key='a'))
        self.assertEqual(first,self.store.mutate('add','fact',key='b'))
        with self.assertRaises(Conflict): self.store.mutate('add','other',key='a')
    def test_remember_after_delete(self):
        old=self.store.mutate('add','fact',key='a');self.store.mutate('delete',ident=old['id'],revision=1,key='d')
        self.assertNotEqual(old['id'],self.store.mutate('add','fact',key='b')['id'])
    def test_old_memory_retrieval(self):
        self.store.mutate('add','oldneedle',key='a')
        for n in range(230): self.store.mutate('add','recent '+str(n),key=str(n))
        self.assertEqual(self.store.search('oldneedle')[0]['content'],'oldneedle')
    def test_budget_concurrency(self):
        def reserve(n):
            try: self.store.reserve(2000,str(n));return True
            except BudgetExceeded: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool: accepted=list(pool.map(reserve,range(32)))
        self.assertEqual(sum(accepted),10);self.assertEqual(self.store.budget()['reserved_fen'],2000)
    def test_failed_call_retains_budget_after_restart(self):
        ident=self.store.reserve(200,'r');self.store.complete_call(ident,'failed')
        with self.assertRaises(BudgetExceeded): Store(self.tmp.name).reserve(200,'next')
    def test_prior_audit_import_once(self):
        path=Path(self.tmp.name)/'audit.json';path.write_text(json.dumps({'limit_cny':20,'reserved_cny':20,'input_tokens':31082,'output_tokens':822}))
        self.store.import_prior(path);self.store.import_prior(path)
        self.assertEqual(self.store.budget()['reserved_fen'],2000)
        with self.assertRaises(BudgetExceeded): self.store.reserve(2000,'next')
    def test_restore_preserves_higher_budget(self):
        self.store.mutate('add','fact',key='a');backup=self.store.backup();self.store.reserve(2000,'r')
        restore(self.tmp.name,backup)
        self.assertEqual(self.store.budget()['reserved_fen'],200);self.assertEqual(self.store.search()[0]['content'],'fact')
    def test_restore_denies_active_lock(self):
        import fcntl
        backup=self.store.backup()
        with (Path(self.tmp.name)/'service.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): restore(self.tmp.name,backup)
    def test_running_job_not_replayed_after_restart(self):
        ident=self.store.create_job('work',time.time()-1);self.store.claim();self.store.recover()
        self.assertIsNone(self.store.claim());self.assertEqual(self.store.jobs()[0]['status'],'interrupted')
    def test_completed_job_claimed_once(self):
        ident=self.store.create_job('work',time.time()-1);self.store.claim();self.store.finish(ident,'completed','53','execution-proof')
        self.assertIsNone(self.store.claim());self.assertEqual(self.store.context()['completed_jobs'][0]['execution_id'],'execution-proof')
    def test_context_is_bounded_original_preserved(self):
        row=self.store.mutate('add','a'*4000,key='a')
        self.assertEqual(len(self.store.memory(row['id'])['content']),4000)
        self.assertTrue(self.store.context()['memories'][0]['truncated'])

class CannedExecutor:
    """Only verifies scheduler/transport plumbing; no model or Hermes simulation claim."""
    def __init__(self): self.count=0;self.allows=[]
    def run(self,messages,allow_add=False):
        self.count+=1;self.allows.append(allow_add)
        return {'final_response':'component fixture result 53','ziwei_run_id':'fixture-execution','usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}

class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.keys=[secrets.token_urlsafe(32) for _ in range(4)]
        self.app=Application(Settings(Path(self.tmp.name),*self.keys,port=0));self.server=create_server(self.app)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self): self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def request(self,path,key=0,body=None,method=None,idem=None):
        headers={'Authorization':'Bearer '+(self.keys[key] if isinstance(key,int) else key),'Connection':'close'}
        if body is not None: headers['Content-Type']='application/json'
        if idem: headers['Idempotency-Key']=idem
        req=urllib.request.Request(self.base+path,headers=headers,data=json.dumps(body).encode() if body is not None else None,method=method)
        try:
            with urllib.request.urlopen(req,timeout=5) as response: return response.status,response.read()
        except urllib.error.HTTPError as error: return error.code,error.read()
    def chat(self,text,key=0,stream=False): return self.request('/v1/chat/completions',key,{'model':'ziwei-hermes','messages':[{'role':'user','content':text}],'stream':stream})
    def test_wrong_key_and_model_listing(self):
        self.assertEqual(self.request('/v1/models','invalid')[0],401)
        self.assertEqual(json.loads(self.request('/v1/models')[1])['data'][0]['id'],'ziwei-hermes')
    def test_read_chat_cannot_remember(self):
        self.assertEqual(self.chat('/记住 denied')[0],403);self.assertEqual(self.app.store.search(),[])
    def test_cross_http_request_memory(self):
        self.assertEqual(self.chat('/记住 6729',1)[0],200)
        self.assertIn('6729',self.chat('/回忆 6729')[1].decode())
    def test_sse_framing(self):
        status,raw=self.chat('/回忆',stream=True);self.assertEqual(status,200);self.assertTrue(raw.endswith(b'data: [DONE]\n\n'))
        frames=[json.loads(line[6:]) for line in raw.decode().splitlines() if line.startswith('data: {')]
        self.assertEqual(frames[-1]['choices'][0]['finish_reason'],'stop')
    def test_update_delete_scope_and_revision(self):
        row=self.app.store.mutate('add','fact',key='a');path='/v1/memories/'+row['id']
        self.assertEqual(self.request(path,0,{'content':'new','revision':1},'PATCH','b')[0],403)
        self.assertEqual(self.request(path,1,{'content':'new','revision':1},'PATCH','b')[0],200)
        self.assertEqual(self.request(path,1,{'content':'stale','revision':1},'PATCH','c')[0],409)
        self.assertEqual(self.request(path,1,{'revision':2},'DELETE','d')[0],403)
        self.assertEqual(self.request(path,2,{'revision':2},'DELETE','d')[0],200)
    def test_missing_revision_denied(self):
        row=self.app.store.mutate('add','fact',key='a')
        self.assertEqual(self.request('/v1/memories/'+row['id'],1,{'content':'new'},'PATCH','b')[0],409)
    def test_disabled_model_before_executor(self):
        executor=CannedExecutor();self.app.executor=executor
        self.assertEqual(self.chat('ordinary chat')[0],402);self.assertEqual(executor.count,0)
    def test_client_tools_and_multimodal_rejected(self):
        for message,extras in [({'role':'user','content':'test'},{'tools':[]}),({'role':'user','content':[]},{})]:
            self.assertEqual(self.request('/v1/chat/completions',0,{'model':'ziwei-hermes','messages':[message],**extras})[0],400)
    def test_model_cap_blocks_before_upstream(self):
        self.app.settings.model_key='not-a-real-key';token=self.app.store.grant('r')
        body={'model':'deepseek-flash','messages':[{'role':'user','content':'test'}]}
        self.assertEqual(self.request('/internal/model/v1/chat/completions',token,body)[0],402)
        self.assertEqual(self.app.store.budget()['calls'],0)
    def test_internal_capability_revocation_and_write_scope(self):
        token=self.app.store.grant('r')
        self.assertEqual(self.request('/internal/memory/add',token,{'content':'no','idempotency_key':'x'})[0],403)
        self.app.store.revoke('r')
        self.assertEqual(self.request('/internal/memory/read',token,{'query':''})[0],403)
    def test_missing_dataset_actual_failure(self):
        token=self.app.store.grant('r')
        self.assertEqual(self.request('/internal/dataset',token,{})[0],503)
    def test_background_job_readback_component_only(self):
        executor=CannedExecutor();self.app.executor=executor;self.app.settings.model_key='not-real';self.app.settings.budget_fen=200
        self.app.store.create_job('fixture',time.time()-1);self.app.tick();self.app.tick()
        self.assertEqual(executor.count,1);self.assertEqual(executor.allows,[False]);self.assertIn('53',self.chat('/后台成果')[1].decode())
    def test_ordinary_chat_readonly_even_write_key(self):
        executor=CannedExecutor();self.app.executor=executor;self.app.settings.model_key='not-real';self.app.settings.budget_fen=200
        self.assertEqual(self.chat('fixture chat',1)[0],200);self.assertEqual(executor.allows,[False])
    def test_backup_admin_only_and_real_sqlite_download(self):
        self.assertEqual(self.request('/admin/backup',0,{})[0],403)
        status,raw=self.request('/admin/backup',3,{});self.assertEqual(status,200)
        path='/admin/backups/'+json.loads(raw)['file']
        self.assertEqual(self.request(path,0)[0],403);self.assertTrue(self.request(path,3)[1].startswith(b'SQLite format 3'))
    def test_mcp_real_stdio_readonly_no_add(self):
        token=self.app.store.grant('r')
        env={**os.environ,'ZIWEI_INTERNAL_URL':self.base,'ZIWEI_RUN_CAPABILITY':token,'ZIWEI_CAN_ADD':'0'}
        requests=[{'jsonrpc':'2.0','id':1,'method':'tools/list'}, {'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'add_memory','arguments':{'content':'no','idempotency_key':'x'}}}]
        script=Path(__file__).resolve().parents[1]/'ziwei'/'mcp_server.py'
        result=subprocess.run([sys.executable,str(script)],input='\n'.join(map(json.dumps,requests))+'\n',text=True,capture_output=True,env=env,timeout=5)
        lines=[json.loads(line) for line in result.stdout.splitlines()]
        self.assertNotIn('add_memory',[x['name'] for x in lines[0]['result']['tools']]);self.assertTrue(lines[1]['result']['isError'])
    def test_mcp_invalid_json_does_not_crash(self):
        env={**os.environ,'ZIWEI_INTERNAL_URL':self.base,'ZIWEI_RUN_CAPABILITY':'invalid'}
        script=Path(__file__).resolve().parents[1]/'ziwei'/'mcp_server.py'
        result=subprocess.run([sys.executable,str(script)],input='bad\n[]\n',text=True,capture_output=True,env=env,timeout=5)
        self.assertEqual(result.returncode,0);self.assertEqual(len(result.stdout.splitlines()),2)

if __name__=='__main__': unittest.main()
