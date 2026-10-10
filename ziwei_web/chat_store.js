'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {checkedDirectory}=require('./data_directory');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
class ChatStore {
 constructor(dir,scope) {
  dir=checkedDirectory(dir);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(fs.existsSync(path.join(dir,'chat.sqlite'))&&fs.lstatSync(path.join(dir,'chat.sqlite')).isSymbolicLink())throw Error('Symlinked chat database forbidden');
  this.db=new DatabaseSync(path.join(dir,'chat.sqlite'));
  fs.chmodSync(path.join(dir,'chat.sqlite'),0o600);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS requests (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,run_id TEXT,upstream_seq INTEGER NOT NULL DEFAULT -1,submitted_at INTEGER,created_at TEXT NOT NULL,error TEXT);
   CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,request_id TEXT,role TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'final',content TEXT NOT NULL,attachments TEXT NOT NULL DEFAULT '[]',quote TEXT,created_at TEXT NOT NULL,status TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'live',source_ref TEXT,UNIQUE(source,source_ref));
   CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS imports (sha256 TEXT PRIMARY KEY,label TEXT NOT NULL,created_at TEXT NOT NULL,count INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS message_order ON messages(source,seq);
   CREATE INDEX IF NOT EXISTS request_state ON requests(state,seq);`);
  const old=this.db.prepare('SELECT value FROM meta WHERE key=?').get('scope');
  if(old&&old.value!==scope){if(this.db.prepare('SELECT count(*) n FROM requests').get().n){this.db.close();throw Error('chat_scope_changed_review_migration');}this.db.prepare('UPDATE meta SET value=? WHERE key=?').run(scope,'scope');}
  this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('scope',scope);
  this.db.prepare("UPDATE requests SET state='recovering' WHERE state IN ('dispatching','running')").run();
 }
 transaction(fn){if(this.inTransaction)return fn();this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.inTransaction=false;}}
 request(id){return this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);}
 addRequest(id,payload){
  const fingerprint=hash(JSON.stringify(payload));
  return this.transaction(()=>{
   const old=this.request(id);if(old){if(old.hash!==fingerprint)throw Error('request_conflict');return {request:old,replayed:true};}
   if(this.db.prepare("SELECT count(*) n FROM requests WHERE state IN ('queued','dispatching','running','recovering','uncertain')").get().n>=20)throw Error('queue_full');
   const now=new Date().toISOString();
   this.db.prepare('INSERT INTO requests(id,hash,payload,state,created_at) VALUES(?,?,?,?,?)').run(id,fingerprint,JSON.stringify(payload),'queued',now);
   this.db.prepare('INSERT INTO messages(id,request_id,role,content,attachments,quote,created_at,status) VALUES(?,?,?,?,?,?,?,?)').run('user-'+id,id,'user',payload.message,JSON.stringify(payload.attachments),payload.quote?JSON.stringify(payload.quote):null,now,'queued');
   this.event(id,'request.state',{state:'queued'});return {request:this.request(id),replayed:false};
  });
 }
 next(){return this.db.prepare("SELECT * FROM requests WHERE state IN ('queued','recovering','uncertain') ORDER BY seq LIMIT 1").get();}
 state(id,state,error=null){this.db.prepare('UPDATE requests SET state=?,error=? WHERE id=?').run(state,error,id);this.db.prepare("UPDATE messages SET status=? WHERE request_id=? AND role='user'").run(state,id);this.event(id,'request.state',{state,error});}
 dispatched(id){this.db.prepare('UPDATE requests SET submitted_at=?,state=? WHERE id=?').run(Date.now(),'dispatching',id);this.state(id,'dispatching');}
 admitted(id,runId){this.db.prepare('UPDATE requests SET run_id=? WHERE id=?').run(runId,id);this.state(id,'running');}
 event(id,kind,data){return Number(this.db.prepare('INSERT INTO events(request_id,kind,data) VALUES(?,?,?)').run(id||'',kind,JSON.stringify(data)).lastInsertRowid);}
 events(after=0){return this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 500').all(after).map(x=>({...x,data:JSON.parse(x.data)}));}
 upstreamEvent(id,seq,fn){return this.transaction(()=>{const r=this.request(id);if(Number.isSafeInteger(seq)&&seq<=r.upstream_seq)return false;fn();if(Number.isSafeInteger(seq))this.db.prepare('UPDATE requests SET upstream_seq=? WHERE id=?').run(seq,id);return true;});}
 assistant(id,key,text,kind='final',status='completed'){
  if(typeof text!=='string')return;
  this.db.prepare('INSERT INTO messages(id,request_id,role,kind,content,created_at,status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,status=excluded.status').run(key,id,'assistant',kind,text,new Date().toISOString(),status);
  this.event(id,'message.saved',{id:key});
 }
 message(id){const m=this.db.prepare('SELECT * FROM messages WHERE id=? AND deleted=0').get(id);return m?this.decode(m):null;}
 decode(m){return {...m,attachments:JSON.parse(m.attachments),quote:m.quote?JSON.parse(m.quote):null,favorite:!!m.favorite,deleted:!!m.deleted};}
 list({before=Number.MAX_SAFE_INTEGER,limit=50,q='',favorite=false,source='live',trash=false}={}){
  const cursor=before===Number.MAX_SAFE_INTEGER?null:this.db.prepare('SELECT created_at FROM messages WHERE source=? AND seq=?').get(source,before);
  if(before!==Number.MAX_SAFE_INTEGER&&!cursor)return [];
  const cursorFilter=cursor?' AND (julianday(created_at)<julianday(?) OR (julianday(created_at)=julianday(?) AND seq<?))':'';
  const where="source=? AND deleted=? AND instr(lower(content),lower(?))>0"+cursorFilter+(favorite?' AND favorite=1':'');
  const rows=this.db.prepare('SELECT * FROM messages WHERE '+where+' ORDER BY julianday(created_at) DESC,seq DESC LIMIT ?').all(source,trash?1:0,q,...(cursor?[cursor.created_at,cursor.created_at,before]:[]),limit);
  return rows.reverse().map(m=>this.decode(m));
 }
 action(id,action){const m=this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);if(!m)throw Error('message_not_found');if(['delete','restore'].includes(action)){if(m.source!=='live')throw Error('archive_is_readonly');this.db.prepare('UPDATE messages SET deleted=? WHERE id=?').run(action==='delete'?1:0,id);}else{this.db.prepare('UPDATE messages SET favorite=? WHERE id=?').run(action==='favorite'?1:0,id);}this.event(null,'timeline.changed',{id,action});}
 addAttachment(a){this.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?)').run(a.id,a.name,a.mime,a.size,a.sha256,new Date().toISOString());}
 attachment(id){return this.db.prepare('SELECT * FROM attachments WHERE id=?').get(id);}
 attachmentBytes(){return this.db.prepare('SELECT coalesce(sum(size),0) n FROM attachments').get().n;}
 importArchive(document,label){
  if(!/^[a-f0-9]{64}$/.test(document.sha256)||!Array.isArray(document.records))throw Error('invalid_archive');
  return this.transaction(()=>{
   let inserted=0;
   for(const m of document.records){
    if(typeof m.ref!=='string'||typeof m.content!=='string'||!['user','assistant','archive'].includes(m.role)||!Number.isFinite(Date.parse(m.at)))throw Error('invalid_archive_record');
    const key=document.sha256+':'+m.ref,old=this.db.prepare('SELECT content,role,created_at FROM messages WHERE source=? AND source_ref=?').get('archive',key);
    if(old&&(old.content!==m.content||old.role!==m.role||old.created_at!==m.at))throw Error('archive_source_conflict');
    inserted+=Number(this.db.prepare('INSERT OR IGNORE INTO messages(id,role,content,created_at,status,source,source_ref) VALUES(?,?,?,?,?,?,?)').run('archive-'+hash(document.sha256+':'+m.ref),m.role,m.content,m.at,'archived','archive',key).changes);
   }
   const count=this.db.prepare('SELECT count(*) n FROM messages WHERE source=? AND source_ref LIKE ?').get('archive',document.sha256+':%').n;
   this.db.prepare('INSERT INTO imports VALUES(?,?,?,?) ON CONFLICT(sha256) DO UPDATE SET count=excluded.count').run(document.sha256,label,new Date().toISOString(),count);
   return {replayed:inserted===0,count,inserted};
  });
 }
 close(){this.db.close();}
}
module.exports={ChatStore,uuid,hash};
