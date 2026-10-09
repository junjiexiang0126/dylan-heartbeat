import fcntl
import hmac
import json
import re
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from .config import Settings
from .pricing import request_bounds
from .store import Store,Denied,Conflict,BudgetExceeded
from .runner import Runner

class Application:
    def __init__(self,settings):
        settings.validate();self.settings=settings;self.store=Store(settings.data)
        # Seed a fixed, non-sensitive fixture only when absent; never overwrite user data.
        dataset_dir=settings.data/'tools';dataset_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
        dataset=dataset_dir/'dataset.csv'
        try:
            with dataset.open('x',encoding='utf-8') as fixture:
                fixture.write('item,quantity\napples,12\nbananas,18\noranges,23\n')
        except FileExistsError:
            pass
        if settings.prior_budget: self.store.import_prior(settings.prior_budget)
        self.store.recover();self.busy=threading.Lock();self.executor=None;self.stopped=threading.Event()

    def model_ready(self):
        return bool(self.settings.model_key and self.store.can_reserve(self.settings.budget_fen))

    def role(self,token):
        for role,key in [('read',self.settings.read_key),('write',self.settings.write_key),('delete',self.settings.delete_key),('admin',self.settings.admin_key)]:
            if key and hmac.compare_digest(key,token): return role
        raise Denied('Invalid credentials')

    def invoke(self,messages,allow_add=False):
        if not self.model_ready(): raise BudgetExceeded('Model disabled or budget exhausted')
        if not self.busy.acquire(blocking=False): raise Conflict('Another Hermes task is running')
        try: return self.executor.run(messages,allow_add=allow_add)
        finally: self.busy.release()

    def tick(self):
        if not self.model_ready() or not self.busy.acquire(blocking=False): return
        try:
            job=self.store.claim()
            if not job: return
            try:
                result=self.executor.run([{'role':'user','content':job['prompt']}],allow_add=bool(job['allow_add']))
                self.store.finish(job['id'],'completed',result['final_response'],result.get('ziwei_run_id',''))
            except Exception: self.store.finish(job['id'],'failed','Execution failed; no success claimed')
        finally: self.busy.release()

    def schedule(self):
        while not self.stopped.wait(2): self.tick()

    def chat(self,body,role,idempotency):
        if body.get('model')!='ziwei-hermes': raise ValueError('Use model ziwei-hermes')
        if any(k in body for k in ('tools','functions')): raise ValueError('Client tools are not supported')
        if not isinstance(body.get('stream',False),bool): raise ValueError('stream must be a boolean')
        messages=body.get('messages')
        if not isinstance(messages,list) or not 1<=len(messages)<=200: raise ValueError('messages must have 1..200 items')
        if any(not isinstance(m,dict) or m.get('role') not in ('user','assistant','system') or not isinstance(m.get('content'),str) for m in messages): raise ValueError('Only text messages supported')
        if messages[-1]['role']!='user': raise ValueError('Last message must be from user')
        text=messages[-1]['content'];usage={'prompt_tokens':0,'completion_tokens':0,'total_tokens':0}
        if text.startswith('/记住 '):
            if role!='write': raise Denied('Memory write key required')
            row=self.store.mutate('add',text[4:],key=idempotency or uuid.uuid4().hex)
            verified=self.store.memory(row['id'])
            if verified['deleted'] or verified['content']!=row['content']: raise Conflict('Memory readback failed')
            reply='已保存记忆 '+row['id']+'，版本 '+str(row['revision'])+'：'+row['content']
        elif text.startswith('/更新记忆 '):
            if role!='write': raise Denied('Memory write key required')
            _,ident,rev,content=text.split(' ',3)
            row=self.store.mutate('update',content,ident,int(rev),idempotency or uuid.uuid4().hex)
            if self.store.memory(ident)!=row: raise Conflict('Memory readback failed')
            reply='已更新记忆 '+ident+'，版本 '+str(row['revision'])+'：'+row['content']
        elif text.startswith('/回忆'):
            reply=json.dumps(self.store.search(text[3:].strip()),ensure_ascii=False)
        elif text.strip()=='/后台成果':
            reply=json.dumps(self.store.jobs(),ensure_ascii=False)
        else:
            result=self.invoke(messages,False);reply=result['final_response'];usage=result['usage']
        return {'id':'chatcmpl-'+uuid.uuid4().hex,'object':'chat.completion','created':int(time.time()),'model':'ziwei-hermes',
                'choices':[{'index':0,'message':{'role':'assistant','content':reply},'finish_reason':'stop'}],'usage':usage}

def create_server(app):
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args): pass
        def token(self):
            value=self.headers.get('Authorization','')
            return value[7:] if value.startswith('Bearer ') else ''
        def body(self):
            size=int(self.headers.get('Content-Length','0'))
            if not 0<=size<=100000: raise ValueError('Request exceeds byte cap')
            body=json.loads(self.rfile.read(size) or b'{}')
            if not isinstance(body,dict): raise ValueError('JSON object required')
            return body
        def send(self,status,value):
            data=json.dumps(value,ensure_ascii=False).encode()
            self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(data)));self.send_header('Connection','close');self.end_headers();self.wfile.write(data);self.close_connection=True
        def require(self,role,allowed):
            if role not in allowed: raise Denied('Credential lacks required scope')
        def dispatch(self):
            try: self.route()
            except BudgetExceeded: self.send(402,{'error':{'message':'Model disabled or persisted budget exhausted'}})
            except Denied: self.send(403 if self.token() else 401,{'error':{'message':'Permission denied'}})
            except Conflict as error: self.send(409,{'error':{'message':str(error)}})
            except (ValueError,TypeError,KeyError,IndexError): self.send(400,{'error':{'message':'Invalid request'}})
            except Exception: self.send(503,{'error':{'message':'Execution unavailable; success not claimed'}})
        def route(self):
            path=self.path.split('?')[0]
            if self.command=='GET' and path in ('/healthz','/readyz'):
                ready=app.model_ready(); self.send(200 if path=='/healthz' or ready else 503,{'alive':True,'model_ready':ready});return
            if path.startswith('/internal/'):
                if self.client_address[0] not in ('127.0.0.1','::1'): raise Denied('Internal endpoint only')
                if self.command!='POST': raise ValueError('POST required')
                body=self.body();token=self.token()
                if path=='/internal/memory/read':
                    self.send(200,{'memories':app.store.search(body.get('query',''),token=token)});return
                if path=='/internal/memory/add':
                    run_id=app.store.authorize(token,'memory:add')
                    result=app.store.mutate('add',body['content'],key=run_id+':'+body['idempotency_key'],actor=run_id,source='task',token=token)
                    self.send(200,result);return
                if path=='/internal/dataset':
                    app.store.authorize(token,'dataset:read');data=(app.settings.data/'tools'/'dataset.csv').read_text()
                    if len(data)>12000: raise ValueError('Dataset exceeds cap')
                    self.send(200,{'csv':data});return
                if path=='/internal/model/v1/chat/completions':
                    run_id=app.store.authorize(token,'model:call')
                    if not app.settings.model_key: raise BudgetExceeded('No model credential')
                    permitted=('model','messages','tools','tool_choice','temperature','top_p','max_tokens','stream','stop','presence_penalty','frequency_penalty','parallel_tool_calls')
                    request={k:v for k,v in body.items() if k in permitted}
                    if request.get('model')!='deepseek-flash': raise ValueError('Fixed model required')
                    request.update(stream=False,max_tokens=max(1,min(int(request.get('max_tokens',2048)),2048)),thinking={'type':'disabled'})
                    encoded=json.dumps(request,ensure_ascii=False).encode()
                    if len(encoded)>100000: raise ValueError('Upstream byte cap exceeded')
                    input_bound,output_bound=request_bounds(encoded,request)
                    ident=app.store.reserve(app.settings.budget_fen,run_id,token,input_bound,output_bound)
                    try:
                        req=urllib.request.Request('https://api.deepseek.com/chat/completions',data=encoded,
                            headers={'Authorization':'Bearer '+app.settings.model_key,'Content-Type':'application/json'})
                        with urllib.request.urlopen(req,timeout=60) as response: result=json.load(response)
                        if not result.get('choices'): raise RuntimeError('No choices')
                        if result.get('model') not in ('deepseek-flash','deepseek-v4.1-flash','deepseek-v4-flash'):
                            with app.store.transaction() as db:
                                db.execute("INSERT OR REPLACE INTO budget_flags VALUES('halt','Unexpected provider model; verify pricing')")
                            raise RuntimeError('Unexpected provider model')
                        app.store.complete_call(ident,'success',result.get('usage'));self.send(200,result)
                    except Exception:
                        app.store.complete_call(ident,'failed');raise
                    return
                raise ValueError('Unknown internal endpoint')
            token=self.token()
            try: role=app.role(token)
            except Denied:
                self.send(401,{'error':{'message':'Invalid credentials'}});return
            if self.command=='GET' and path=='/v1/models':
                self.send(200,{'object':'list','data':[{'id':'ziwei-hermes','object':'model','created':0,'owned_by':'ziwei'}]});return
            if self.command=='POST' and path=='/v1/chat/completions':
                self.require(role,('read','write'));body=self.body();result=app.chat(body,role,self.headers.get('Idempotency-Key',''))
                if not body.get('stream'): self.send(200,result);return
                chunk={'id':result['id'],'object':'chat.completion.chunk','created':result['created'],'model':result['model']}
                frames=[{**chunk,'choices':[{'index':0,'delta':{'role':'assistant'},'finish_reason':None}]},
                    {**chunk,'choices':[{'index':0,'delta':{'content':result['choices'][0]['message']['content']},'finish_reason':None}]},
                    {**chunk,'choices':[{'index':0,'delta':{},'finish_reason':'stop'}],'usage':result['usage']}]
                raw=(''.join('data: '+json.dumps(x,ensure_ascii=False)+'\n\n' for x in frames)+'data: [DONE]\n\n').encode()
                self.send_response(200);self.send_header('Content-Type','text/event-stream; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Connection','close');self.end_headers();self.wfile.write(raw);self.close_connection=True;return
            if self.command=='GET' and path=='/v1/memories':
                self.require(role,('read','write','delete','admin'));self.send(200,{'memories':app.store.search()});return
            if path.startswith('/v1/memories/'):
                ident=path.rsplit('/',1)[1]
                if self.command=='GET': self.send(200,{'memory':app.store.memory(ident)});return
                body=self.body();operation='delete' if self.command=='DELETE' else 'update' if self.command=='PATCH' else ''
                self.require(role,('delete',) if operation=='delete' else ('write',))
                result=app.store.mutate(operation,body.get('content',''),ident,body.get('revision'),self.headers.get('Idempotency-Key',''))
                self.send(200,result);return
            if path=='/v1/jobs':
                self.require(role,('admin',))
                if self.command=='GET': self.send(200,{'jobs':app.store.jobs()});return
                body=self.body();allow=body.get('allow_memory_add',False)
                if not isinstance(allow,bool): raise ValueError('Boolean permission required')
                self.send(201,{'id':app.store.create_job(body['prompt'],body.get('due',time.time()),allow)});return
            if path.startswith('/admin/'):
                self.require(role,('admin',))
                if self.command=='GET' and path=='/admin/budget': self.send(200,app.store.budget(app.settings.budget_fen));return
                if self.command=='POST' and path=='/admin/inspect':
                    self.body();self.send(200,app.executor.run([{'role':'user','content':'inspect only'}],inspect_only=True));return
                if self.command=='POST' and path=='/admin/backup':
                    self.body();self.send(200,{'file':app.store.backup().name});return
                if self.command=='GET' and re.fullmatch(r'/admin/backups/ziwei-[0-9a-f]{32}\.sqlite',path):
                    backup=app.settings.data/'backups'/path.rsplit('/',1)[1]
                    self.send_response(200);self.send_header('Content-Type','application/vnd.sqlite3');self.send_header('Content-Length',str(backup.stat().st_size));self.send_header('Connection','close');self.end_headers()
                    with backup.open('rb') as handle:
                        while data:=handle.read(65536): self.wfile.write(data)
                    self.close_connection=True;return
            self.send(404,{'error':{'message':'Unknown endpoint'}})
        do_GET=dispatch
        do_POST=dispatch
        do_PATCH=dispatch
        do_DELETE=dispatch
    server=ThreadingHTTPServer((app.settings.host,app.settings.port),Handler)
    app.executor=Runner(app.settings,app.store,'http://127.0.0.1:'+str(server.server_port))
    return server

def main():
    settings=Settings.environment();settings.validate()
    with (settings.data/'service.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        app=Application(settings);server=create_server(app)
        threading.Thread(target=app.schedule,daemon=True).start()
        try: server.serve_forever()
        finally: app.stopped.set();server.server_close()

if __name__=='__main__': main()
