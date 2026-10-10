'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class RequestLedger{
 constructor(dir){this.file=path.join(dir,'chat-requests.json');this.records=new Map();try{const rows=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Array.isArray(rows))throw Error('bad ledger');for(const [id,record] of rows){if(/^[a-f0-9-]{36}$/.test(id)&&record&&typeof record==='object')this.records.set(id,record)}}catch(e){if(e.code!=='ENOENT')throw e}this.prune()}
 persist(){const tmp=this.file+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...this.records]),{mode:0o600,flag:'wx'});fs.renameSync(tmp,this.file)}
 prune(){const threshold=Date.now()-30*86400000;let changed=false;for(const [id,r] of this.records){if(r.at<threshold){this.records.delete(id);changed=true}}if(changed)this.persist()}
 begin(id,message){if(!/^[a-f0-9-]{36}$/.test(id))return {error:'invalid_request_id'};const hash=crypto.createHash('sha256').update(message).digest('hex');const prior=this.records.get(id);if(prior)return {error:prior.hash===hash?'request_already_seen':'request_id_conflict',state:prior.state};this.records.set(id,{hash,state:'uncertain',at:Date.now()});this.persist();return {ok:true}}
 finish(id,complete){const r=this.records.get(id);if(!r)return;this.records.set(id,{...r,state:complete?'completed':'uncertain',at:Date.now()});this.persist()}
 lookup(id){return this.records.get(id)||null}
}
module.exports={RequestLedger};
