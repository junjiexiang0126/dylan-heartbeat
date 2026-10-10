'use strict';
const fs=require('node:fs');
class HermesClient {
 constructor(env=process.env){
  this.base=env.ZIWEI_HERMES_URL||'';this.session=env.ZIWEI_HERMES_WEB_SESSION_ID||'';
  this.key=env.ZIWEI_HERMES_API_KEY_FILE?fs.readFileSync(env.ZIWEI_HERMES_API_KEY_FILE,'utf8').trim():env.ZIWEI_HERMES_API_KEY||'';
  this.enabled=env.ZIWEI_BRIDGE_ENABLED==='true';this.test=env.NODE_ENV==='test'&&env.ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS==='true';
  this.sessionKey='agent:main:web:'+this.session;this.initialized=false;
 }
 configured(){try{const u=new URL(this.base);return this.enabled&&!!this.key&&/^[a-zA-Z0-9_-]{1,128}$/.test(this.session)&&(u.protocol==='https:'||this.test&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/';}catch{return false;}}
 async fetch(route,options={}){
  if(!this.configured())throw Error('hermes_not_configured');
  const r=await fetch(new URL(route,this.base),{...options,headers:{Authorization:'Bearer '+this.key,'X-Hermes-Session-Key':this.sessionKey,...options.headers},redirect:'error',signal:options.signal||AbortSignal.timeout(15000)});
  return r;
 }
 async json(route,options={}){const r=await this.fetch(route,options);if(!r.ok)throw Error(r.status===401?'hermes_auth_rejected':r.status===429?'hermes_busy':'hermes_http_'+r.status);const text=await r.text();if(Buffer.byteLength(text)>8*1024*1024)throw Error('hermes_response_limit');return JSON.parse(text);}
 async check(){
  const c=await this.json('/v1/capabilities');if(!c.features?.runs_idempotency?.durable||!c.features?.run_events_sse||Number(c.features.runs_idempotency.retention_seconds)<3600)throw Error('hermes_contract_unverified');
 }
 async init(){
  if(this.initialized)return;
  await this.check();
  const r=await this.fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:this.session,source:'api_server'})});
  if(r.status!==201&&r.status!==409)throw Error('hermes_session_failed');
  const s=await this.json('/api/sessions/'+this.session);if(s.session?.id!==this.session)throw Error('hermes_session_mismatch');
  this.initialized=true;
 }
 async submit(id,input){await this.init();const o=await this.json('/v1/runs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'ziwei-home:'+id},body:JSON.stringify({input:typeof input==='string'?input:[{role:'user',content:input}],session_id:this.session})});if(!/^run_[a-zA-Z0-9_-]+$/.test(o.run_id))throw Error('hermes_invalid_run');return o.run_id;}
 status(id){if(!/^run_[a-zA-Z0-9_-]+$/.test(id))throw Error('invalid_run_id');return this.json('/v1/runs/'+id);}
 stream(id,after){return this.fetch('/v1/runs/'+id+'/events?last_seq='+after,{signal:AbortSignal.timeout(1200000),headers:{Accept:'text/event-stream'}});}
}
module.exports={HermesClient};
