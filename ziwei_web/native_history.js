'use strict';
// Read-only import from the connected Hermes. No writes to Hermes or its memory.
const {hash}=require('./chat_store');
class NativeHistory {
 constructor(client,store){this.client=client;this.store=store;this.running=null;this.snapshot=null;this.closed=false;try{this.snapshot=JSON.parse(store.db.prepare("SELECT value FROM meta WHERE key='native_history_sync'").get()?.value||'null');if(this.snapshot?.state==='running')this.snapshot.state='interrupted';}catch{}}
 status(){return this.snapshot||{state:'idle',sessions:0,messages:0,at:null,scope:'当前 Hermes 可访问会话；不包含未提供的旧环境数据。'};}
 async sync(){if(this.running)return this.status();this.snapshot={...this.status(),state:'running',error:null};this.running=this.run().catch(()=>{this.snapshot={...this.status(),state:'failed',error:'历史同步未完成，已同步记录保留，可重试。'};}).finally(()=>{this.running=null;});return this.status();}
 async run(){
  let offset=0,sessions=0,messages=0;const ids=new Set();
  while(!this.closed){
   const page=await this.client.json('/api/sessions?limit=200&offset='+offset);if(!Array.isArray(page.data))throw Error('invalid_history');
   if(this.closed)return;for(const session of page.data){
    if(typeof session.id!=='string'||session.id.endsWith('-moments')||ids.has(session.id))continue;ids.add(session.id);
    if(/^(?:security-probe|isolated-|browser-protocol-fixture|ziwei-home-phase2-validation-)/.test(session.id))continue;
    const sid=encodeURIComponent(session.id);let pos=0;
    for(;;){
     const rows=await this.client.json('/api/sessions/'+sid+'/messages?limit=500&offset='+pos+'&order=oldest&include_compacted=true');if(!Array.isArray(rows.data))throw Error('invalid_history');
     if(this.closed)return;const valid=[];
     for(const m of rows.data){if(!['user','assistant'].includes(m.role)||m.id===undefined)continue;
      const content=typeof m.content==='string'?m.content:JSON.stringify(m.content??'');
      let at=m.timestamp;if(typeof at==='number')at=new Date(at<1e12?at*1000:at).toISOString();if(!at||!Number.isFinite(Date.parse(at)))continue;
      valid.push({id:'native-'+hash((m.session_id||session.id)+':'+m.id),ref:'native:'+(m.session_id||session.id)+':'+m.id,role:m.role,content,at:new Date(at).toISOString()});
     }
     this.store.transaction(()=>{for(const m of valid){const old=this.store.db.prepare("SELECT content,role FROM messages WHERE source='archive' AND source_ref=?").get(m.ref);if(old&&(old.content!==m.content||old.role!==m.role))throw Error('native_history_changed');this.store.db.prepare("INSERT OR IGNORE INTO messages(id,role,content,created_at,status,source,source_ref) VALUES(?,?,?,?,?,'archive',?)").run(m.id,m.role,m.content,m.at,'archived',m.ref);}});
     messages+=valid.length;this.snapshot={...this.status(),sessions,messages};if(rows.data.length<500)break;pos+=500;if(pos>1000000)throw Error('history_limit');
    }
    sessions++;this.snapshot={...this.status(),sessions,messages};
   }
   if(page.has_more===false||page.data.length<200)break;offset+=200;if(offset>100000)throw Error('history_limit');
  }
  messages=this.store.db.prepare("SELECT count(*) n FROM messages WHERE source='archive' AND source_ref LIKE 'native:%'").get().n;this.snapshot={...this.status(),state:'completed',sessions,messages,at:new Date().toISOString()};
  this.store.db.prepare("INSERT INTO meta(key,value) VALUES('native_history_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(this.snapshot));
  this.store.event(null,'timeline.changed',{source:'archive'});if(process.env.NODE_ENV==='production')console.log('NATIVE_HISTORY_SYNC '+JSON.stringify({sessions,messages,state:'completed'}));
 }
 close(){this.closed=true;}
}
module.exports={NativeHistory};
