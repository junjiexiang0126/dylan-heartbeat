import hashlib
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

class Denied(Exception): pass
class Conflict(Exception): pass
class BudgetExceeded(Exception): pass

class Store:
    def __init__(self,data):
        self.data=Path(data); self.data.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.path=self.data/'ziwei.sqlite'
        with self.transaction() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,content TEXT,revision INTEGER,deleted INTEGER,source TEXT,updated REAL);
            CREATE TABLE IF NOT EXISTS versions(id TEXT,revision INTEGER,content TEXT,deleted INTEGER,updated REAL,PRIMARY KEY(id,revision));
            CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY,digest TEXT,result TEXT);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,operation TEXT,object_id TEXT,actor TEXT,created REAL);
            CREATE TABLE IF NOT EXISTS grants(digest TEXT PRIMARY KEY,run_id TEXT,scopes TEXT,expires REAL,revoked INTEGER);
            CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY,run_id TEXT,reserved_fen INTEGER,status TEXT,input_tokens INTEGER,output_tokens INTEGER,created REAL);
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,prompt TEXT,due REAL,allow_add INTEGER,status TEXT,result TEXT,execution_id TEXT,updated REAL);
            CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY,run_id TEXT,messages TEXT,created REAL);
            ''')
        os.chmod(self.path,0o600)

    @contextmanager
    def transaction(self):
        db=sqlite3.connect(self.path,timeout=15); db.row_factory=sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE'); yield db; db.commit()
        except Exception: db.rollback(); raise
        finally: db.close()

    @staticmethod
    def _scope(db,token,scope,run_id=None):
        row=db.execute('SELECT * FROM grants WHERE digest=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        if not row or row['revoked'] or row['expires']<time.time() or scope not in json.loads(row['scopes']) or (run_id and row['run_id']!=run_id):
            raise Denied('Capability expired, revoked or out of scope')
        return row['run_id']

    def authorize(self,token,scope):
        with self.transaction() as db: return self._scope(db,token,scope)

    def grant(self,run_id,allow_add=False):
        token=secrets.token_urlsafe(32)
        scopes=['memory:read','dataset:read','model:call']+(['memory:add'] if allow_add else [])
        with self.transaction() as db:
            db.execute('INSERT INTO grants VALUES(?,?,?,?,0)',(hashlib.sha256(token.encode()).hexdigest(),run_id,json.dumps(scopes),time.time()+300))
        return token

    def revoke(self,run_id):
        with self.transaction() as db: db.execute('UPDATE grants SET revoked=1 WHERE run_id=?',(run_id,))

    def memory(self,ident):
        with self.transaction() as db:
            row=db.execute('SELECT * FROM memories WHERE id=?',(ident,)).fetchone()
            return dict(row) if row else None

    def search(self,query='',limit=20,token=None):
        limit=min(max(int(limit),1),50)
        with self.transaction() as db:
            if token: self._scope(db,token,'memory:read')
            words=query.split()[:12]
            if words:
                patterns=['%'+w.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%' for w in words]
                where=' OR '.join("content LIKE ? ESCAPE '\\'" for _ in words)
                rows=db.execute('SELECT * FROM memories WHERE deleted=0 AND ('+where+') ORDER BY updated DESC LIMIT ?',(*patterns,limit)).fetchall()
                if rows: return [dict(r) for r in rows]
            return [dict(r) for r in db.execute('SELECT * FROM memories WHERE deleted=0 ORDER BY updated DESC LIMIT ?',(limit,))]

    def mutate(self,operation,content='',ident=None,revision=None,key='',actor='user',source='user',token=None):
        if operation not in ('add','update','delete') or not key: raise ValueError('Explicit operation and idempotency key required')
        if operation!='delete' and (not isinstance(content,str) or not 1<=len(content.strip())<=4000): raise ValueError('Memory content must be 1..4000 characters')
        content=content.strip()
        digest=hashlib.sha256(json.dumps([operation,content,ident,revision],ensure_ascii=False).encode()).hexdigest()
        with self.transaction() as db:
            if token: self._scope(db,token,'memory:'+operation,actor)
            prior=db.execute('SELECT * FROM receipts WHERE key=?',(key,)).fetchone()
            if prior:
                if prior['digest']!=digest: raise Conflict('Idempotency key already used for another request')
                return json.loads(prior['result'])
            if operation=='add':
                old=db.execute('SELECT * FROM memories WHERE deleted=0 AND content=? AND source=?',(content,source)).fetchone() if source=='user' else None
                result=dict(old) if old else dict(id=uuid.uuid4().hex,content=content,revision=1,deleted=0,source=source,updated=time.time())
                if not old: db.execute('INSERT INTO memories VALUES(:id,:content,:revision,:deleted,:source,:updated)',result)
            else:
                old=db.execute('SELECT * FROM memories WHERE id=?',(ident,)).fetchone()
                if not old or old['deleted'] or revision!=old['revision']: raise Conflict('Memory missing, deleted, or revision changed')
                result={**dict(old),'content':content if operation=='update' else old['content'],'revision':revision+1,'deleted':int(operation=='delete'),'updated':time.time()}
                db.execute('UPDATE memories SET content=:content,revision=:revision,deleted=:deleted,updated=:updated WHERE id=:id',result)
            db.execute('INSERT OR IGNORE INTO versions VALUES(:id,:revision,:content,:deleted,:updated)',result)
            db.execute('INSERT INTO receipts VALUES(?,?,?)',(key,digest,json.dumps(result,ensure_ascii=False)))
            db.execute('INSERT INTO audit(operation,object_id,actor,created) VALUES(?,?,?,?)',(operation,result['id'],actor,time.time()))
            return result

    def budget(self):
        with self.transaction() as db:
            return dict(db.execute('SELECT COUNT(*) calls,COALESCE(SUM(reserved_fen),0) reserved_fen,COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens FROM calls').fetchone())

    def reserve(self,limit,run_id,token=None):
        if not 0<=limit<=2000: raise ValueError('Budget maximum is 2000 fen')
        with self.transaction() as db:
            if token: self._scope(db,token,'model:call',run_id)
            used=db.execute('SELECT COALESCE(SUM(reserved_fen),0) FROM calls').fetchone()[0]
            if used+200>limit: raise BudgetExceeded('Budget exhausted; reservation is never reset')
            return db.execute("INSERT INTO calls(run_id,reserved_fen,status,input_tokens,output_tokens,created) VALUES(?,200,'reserved',0,0,?)",(run_id,time.time())).lastrowid

    def complete_call(self,ident,status,usage=None):
        usage=usage or {}
        with self.transaction() as db:
            db.execute('UPDATE calls SET status=?,input_tokens=?,output_tokens=? WHERE id=?',(status,int(usage.get('prompt_tokens',0)),int(usage.get('completion_tokens',0)),ident))

    def import_prior(self,path):
        audit=json.loads(Path(path).read_text())
        if audit.get('limit_cny')!=20 or audit.get('reserved_cny')!=20: raise ValueError('Expected preserved 20 yuan audit')
        with self.transaction() as db:
            if db.execute("SELECT 1 FROM receipts WHERE key='prior-budget'").fetchone(): return
            if db.execute('SELECT COUNT(*) FROM calls').fetchone()[0]: raise Conflict('Import audit before new calls')
            db.execute("INSERT INTO calls(run_id,reserved_fen,status,input_tokens,output_tokens,created) VALUES('prior-validation',2000,'prior-audit',?,?,?)",(audit['input_tokens'],audit['output_tokens'],time.time()))
            db.execute("INSERT INTO receipts VALUES('prior-budget','import','{}')")

    def create_job(self,prompt,due,allow_add=False):
        if not isinstance(prompt,str) or not 1<=len(prompt)<=8000: raise ValueError('Task prompt must be 1..8000 characters')
        ident=uuid.uuid4().hex
        with self.transaction() as db: db.execute("INSERT INTO jobs VALUES(?,?,?,?,'queued','',NULL,?)",(ident,prompt,float(due),int(allow_add),time.time()))
        return ident

    def jobs(self):
        with self.transaction() as db: return [dict(r) for r in db.execute('SELECT * FROM jobs ORDER BY updated DESC LIMIT 50')]

    def claim(self):
        with self.transaction() as db:
            row=db.execute("SELECT * FROM jobs WHERE status='queued' AND due<=? ORDER BY due LIMIT 1",(time.time(),)).fetchone()
            if row: db.execute("UPDATE jobs SET status='running',updated=? WHERE id=?",(time.time(),row['id']))
            return dict(row) if row else None

    def finish(self,ident,status,result,execution_id=''):
        with self.transaction() as db: db.execute('UPDATE jobs SET status=?,result=?,execution_id=?,updated=? WHERE id=? AND status=\'running\'',(status,result,execution_id,time.time(),ident))

    def recover(self):
        with self.transaction() as db:
            db.execute('UPDATE grants SET revoked=1')
            db.execute("UPDATE jobs SET status='interrupted',result='Execution interrupted; requires explicit review',updated=? WHERE status='running'",(time.time(),))

    def context(self,query=''):
        value={'memories':[{**r,'content':r['content'][:1000],'truncated':len(r['content'])>1000} for r in self.search(query,12)],
               'completed_jobs':[{**r,'prompt':r['prompt'][:500],'result':r['result'][:2000],'truncated':len(r['result'])>2000} for r in self.jobs() if r['status']=='completed'][:5]}
        while len(json.dumps(value,ensure_ascii=False).encode())>16000:
            if value['memories']: value['memories'].pop()
            elif value['completed_jobs']: value['completed_jobs'].pop()
            else: raise ValueError('Context too large')
        return value

    def save_conversation(self,run_id,messages):
        with self.transaction() as db: db.execute('INSERT INTO conversations(run_id,messages,created) VALUES(?,?,?)',(run_id,json.dumps(messages,ensure_ascii=False),time.time()))

    def run_usage(self,run_id):
        with self.transaction() as db:
            rows=db.execute('SELECT * FROM calls WHERE run_id=?',(run_id,)).fetchall()
            if not rows or any(r['status']!='success' for r in rows): raise RuntimeError('Model call evidence missing or failed')
            p=sum(r['input_tokens'] for r in rows); c=sum(r['output_tokens'] for r in rows)
            return {'prompt_tokens':p,'completion_tokens':c,'total_tokens':p+c}

    def backup(self):
        folder=self.data/'backups';folder.mkdir(exist_ok=True,mode=0o700)
        path=folder/('ziwei-'+uuid.uuid4().hex+'.sqlite')
        with sqlite3.connect(self.path) as source,sqlite3.connect(path) as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('Backup integrity failed')
        os.chmod(path,0o600); return path
