'use strict';
// Read-only, resumable import. Native memory is never read or written here.
const {hash}=require('./chat_store');
class NativeHistory {
 constructor(client,store){this.client=client;this.store=store;this.running=null;this.closed=false;this.timer=null;this.snapshot=this.meta('native_history_sync')||null;if(this.snapshot?.state==='running')this.snapshot.state='interrupted';}
 meta(key){try{return JSON.parse(this.store.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value||'null');}catch{return null;}}
 save(key,value){this.store.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 status(){return this.snapshot||{state:'idle',sessions:0,messages:0,at:null,scope:'当前 Hermes 可访问的聊天档案；与长期记忆分开。'};}
 persist(){if(!this.closed)this.save('native_history_sync',this.snapshot);}
 async sync(){
  if(this.closed||this.running)return this.status();clearTimeout(this.timer);this.snapshot={...this.status(),state:'running',error:null};this.persist();
  this.running=this.run().catch(e=>{if(!this.closed){this.snapshot={...this.status(),state:'failed',error:e.message==='native_history_changed'?'原生历史内容已变化，已有档案保留，需核对来源。':'历史同步未完成；已保存进度，下次从断点继续。',failedAt:this.location||null};this.persist();}}).finally(()=>{this.running=null;if(!this.closed&&this.snapshot.state==='pending'){this.timer=setTimeout(()=>{void this.sync();},1000);this.timer.unref?.();}});
  return this.status();
 }
 async run(){
  const started=Date.now();let calls=0,changed=0,offset=this.meta('native_history_listing')?.offset||0,sessions=0;
  const enough=()=>calls>=20||Date.now()-started>=20000;
  const pending=()=>{this.snapshot={...this.status(),state:'pending',messages:this.count()};this.persist();if(changed)this.store.event(null,'timeline.changed',{source:'archive'});};
  const ids=new Set();
  while(!this.closed){
   this.location={stage:'sessions',offset};const page=await this.client.json('/api/sessions?limit=200&offset='+offset);calls++;
   if(!Array.isArray(page.data))throw Error('invalid_history');if(this.closed)return;
   for(const session of page.data){
    if(typeof session.id!=='string'||session.id.endsWith('-moments')||ids.has(session.id)||/^(?:security-probe|isolated-|browser-protocol-fixture|ziwei-home-phase2-validation-)/.test(session.id))continue;
    ids.add(session.id);sessions++;
    const key='native_history_session:'+hash(session.id),old=this.meta(key),signature=session.message_count!==undefined||session.last_active!==undefined?JSON.stringify([session.message_count,session.last_active,session.ended_at]):null;
    if(old?.complete&&signature&&old.signature===signature&&Date.now()-old.checkedAt<86400000)continue;
    let pos=old&&!old.complete?old.offset:old?.complete&&!(Number.isFinite(session.message_count)&&session.message_count<old.messageCount)?Math.max(0,old.offset-20):0;
    for(;;){
     if(enough()){this.save(key,{...old,complete:false,offset:pos,signature});pending();return;}
     this.location={stage:'messages',session:session.id,offset:pos};
     const rows=await this.client.json('/api/sessions/'+encodeURIComponent(session.id)+'/messages?limit=500&offset='+pos+'&order=oldest&include_compacted=true');calls++;
     if(!Array.isArray(rows.data)||rows.data.length>500)throw Error('invalid_history');if(this.closed)return;
     const valid=[];
     for(const m of rows.data){
      if(!['user','assistant'].includes(m.role)||m.id===undefined)continue;
      const content=typeof m.content==='string'?m.content:JSON.stringify(m.content??'');let at=m.timestamp;
      if(typeof at==='number')at=new Date(at<1e12?at*1000:at).toISOString();if(!at||!Number.isFinite(Date.parse(at)))continue;
      valid.push({id:'native-'+hash((m.session_id||session.id)+':'+m.id),ref:'native:'+(m.session_id||session.id)+':'+m.id,role:m.role,content,at:new Date(at).toISOString()});
     }
     this.store.transaction(()=>{
      for(const m of valid){const prior=this.store.db.prepare("SELECT content,role FROM messages WHERE source='archive' AND source_ref=?").get(m.ref);if(prior&&(prior.content!==m.content||prior.role!==m.role))throw Error('native_history_changed');changed+=Number(this.store.db.prepare("INSERT OR IGNORE INTO messages(id,role,content,created_at,status,source,source_ref) VALUES(?,?,?,?,?,'archive',?)").run(m.id,m.role,m.content,m.at,'archived',m.ref).changes);}
      pos+=rows.data.length;this.save(key,{complete:rows.data.length<500,offset:pos,signature,messageCount:session.message_count,checkedAt:Date.now()});
     });
     this.snapshot={...this.status(),sessions,messages:this.count(),currentSession:session.id};this.persist();
     if(rows.data.length<500)break;if(pos>1000000)throw Error('history_limit');
    }
   }
   if(page.has_more===false||page.data.length<200)break;offset+=200;this.save('native_history_listing',{offset});if(offset>100000)throw Error('history_limit');if(enough()){pending();return;}
  }
  if(this.closed)return;
  this.save('native_history_listing',{offset:0});this.snapshot={...this.status(),state:'completed',sessions,messages:this.count(),at:new Date().toISOString(),currentSession:null,failedAt:null};this.persist();
  if(changed)this.store.event(null,'timeline.changed',{source:'archive'});
  if(process.env.NODE_ENV==='production')console.log('NATIVE_HISTORY_SYNC '+JSON.stringify({sessions,messages:this.snapshot.messages,imported:changed,state:'completed'}));
 }
 count(){return this.store.db.prepare("SELECT count(*) n FROM messages WHERE source='archive' AND source_ref LIKE 'native:%'").get().n;}
 close(){this.closed=true;clearTimeout(this.timer);}
}
module.exports={NativeHistory};
