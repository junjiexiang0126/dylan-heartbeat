'use strict';
// Public expressions authored in final output only. Never read native reasoning.
const crypto=require('node:crypto');
const KINDS=new Set(['role_monologue','response_summary']);
function normalize(notes){
 if(!Array.isArray(notes)||notes.length>2)return [];
 const seen=new Set(),valid=[];
 for(const note of notes){
  if(!note||typeof note!=='object'||Array.isArray(note)||Object.keys(note).some(k=>!['kind','text'].includes(k))||!KINDS.has(note.kind)||seen.has(note.kind)||typeof note.text!=='string')continue;
  const text=note.text.trim();
  if(!text||text.length>1200||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))continue;
  seen.add(note.kind);valid.push({kind:note.kind,text});
 }
 return valid;
}
class PublicNotes {
 constructor(db){
  this.db=db;
  db.exec(`CREATE TABLE IF NOT EXISTS public_notes (
   id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES messages(id),
   request_id TEXT NOT NULL REFERENCES requests(id),run_id TEXT NOT NULL,
   kind TEXT NOT NULL CHECK(kind IN ('role_monologue','response_summary')),
   text TEXT NOT NULL,source TEXT NOT NULL CHECK(source='model_public_output'),
   created_at TEXT NOT NULL,observed_at TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,
   UNIQUE(message_id,kind));`);
 }
 save(requestId,messageId,notes){
  const message=this.db.prepare("SELECT * FROM messages WHERE id=? AND request_id=? AND role='assistant' AND kind='final' AND source='live' AND status='completed' AND deleted=0").get(messageId,requestId);
  const request=this.db.prepare('SELECT run_id FROM requests WHERE id=?').get(requestId);
  if(!message||!request?.run_id)return;
  const insert=this.db.prepare(`INSERT OR IGNORE INTO public_notes(id,message_id,request_id,run_id,kind,text,source,created_at,observed_at) VALUES(?,?,?,?,?,?,'model_public_output',?,?)`);
  const now=new Date().toISOString();
  for(const note of normalize(notes)){
   const id=crypto.createHash('sha256').update(messageId+':'+note.kind).digest('hex');
   insert.run(id,messageId,requestId,request.run_id,note.kind,note.text,message.created_at,now);
  }
 }
 list(messageId){
  return this.db.prepare(`SELECT n.* FROM public_notes n JOIN messages m ON m.id=n.message_id
   WHERE n.message_id=? AND m.deleted=0 AND m.role='assistant' AND m.kind='final' AND m.source='live' AND m.status='completed'
   ORDER BY CASE n.kind WHEN 'role_monologue' THEN 0 ELSE 1 END`).all(messageId).map(n=>({
    id:n.id,kind:n.kind,text:n.text,source:n.source,messageId:n.message_id,
    requestId:n.request_id,runId:n.run_id,createdAt:n.created_at,observedAt:n.observed_at,schemaVersion:n.schema_version
   }));
 }
 recent(limit=40){
  const n=Math.max(1,Math.min(40,Number(limit)||40));
  return this.db.prepare(`SELECT n.* FROM public_notes n JOIN messages m ON m.id=n.message_id
   WHERE n.kind='role_monologue' AND m.deleted=0 AND m.role='assistant' AND m.kind='final' AND m.source='live' AND m.status='completed'
   ORDER BY n.created_at DESC,n.id DESC LIMIT ?`).all(n).map(x=>({
    id:x.message_id,role:'assistant',kind:'final',source:'live',status:'completed',publicNotes:[{
     id:x.id,messageId:x.message_id,kind:x.kind,text:x.text,source:x.source,createdAt:x.created_at,observedAt:x.observed_at
    }]
   }));
 }
}
module.exports={normalize,PublicNotes};
