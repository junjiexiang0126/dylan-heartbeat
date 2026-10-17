'use strict';
// Restricted, opt-in bridge. Never exposes an arbitrary upstream path or an API key.
const {SSEParser}=require('./sse_parser');
const path=require('node:path');
const {RequestLedger}=require('./request_ledger');
const {classify}=require('./recovery');
const ledger=new RequestLedger(process.env.ZIWEI_WEB_DATA_DIR||path.join(__dirname,'.data'));
const SESSION_KEY='agent:main:web:yu';
const enabled=process.env.ZIWEI_BRIDGE_ENABLED==='true';
const base=process.env.ZIWEI_HERMES_URL||'';
const secret=process.env.ZIWEI_HERMES_API_KEY||'';
const sessionId=process.env.ZIWEI_HERMES_WEB_SESSION_ID||'';
let sessionReady=false,creationPromise=null,streamBusy=false;
function ready(){if(!enabled)return false;if(!base||!secret||!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId))return false;try{const u=new URL(base);return (u.protocol==='https:'||process.env.ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS==='true'&&u.protocol==='http:')&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'}catch{return false}}
function status(){return ready()}
function jsonRecovery(res,data){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function err(res,status,code){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:code}))}
async function ensureSession(){
 if(sessionReady)return;
 if(!creationPromise)creationPromise=(async()=>{
  const r=await fetch(new URL('/api/sessions',base),{method:'POST',headers:{Authorization:'Bearer '+secret,'X-Hermes-Session-Key':SESSION_KEY,'Content-Type':'application/json'},body:JSON.stringify({id:sessionId,source:'api_server',title:'网页对话'}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(r.status!==201&&r.status!==409)throw Error('session_create_failed');
  sessionReady=true;
 })().finally(()=>{creationPromise=null});
 return creationPromise;
}
function pathForHistory(url){const n=Number(url.searchParams.get('limit')||30),offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(n)||n<1||n>100||!Number.isSafeInteger(offset)||offset<0||offset>100000)return null;return '/api/sessions/'+encodeURIComponent(sessionId)+'/messages?order=latest&limit='+n+'&offset='+offset}
async function getHistoryPage(limit=100){const r=await fetch(new URL('/api/sessions/'+encodeURIComponent(sessionId)+'/messages?order=latest&limit='+limit+'&offset=0',base),{headers:{Authorization:'Bearer '+secret,'X-Hermes-Session-Key':SESSION_KEY,Accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('history_unavailable');const obj=await r.json();if(!Array.isArray(obj.data))throw Error('history_invalid');return obj.data}
async function proxy(req,res,pathname,url){
 if(!ready())return err(res,503,'hermes_bridge_not_enabled');
 let target,method='GET',body,stream=false,requestId=null,requestComplete=false;
 if(pathname==='/api/web/recover'&&req.method==='GET'){
  const id=url.searchParams.get('requestId');if(!id||!/^[a-f0-9-]{36}$/.test(id))return err(res,400,'invalid_request_id');
  const record=ledger.lookup(id);if(!record)return err(res,404,'request_not_found');
  if(record.state==='completed')return jsonRecovery(res,{state:'completed',retrySafe:false});
  try{await ensureSession();const rows=await getHistoryPage();return jsonRecovery(res,classify(record,rows))}catch{return err(res,503,'recovery_unavailable')}
 }
 if(pathname==='/api/web/history'&&req.method==='GET'){target=pathForHistory(url);if(!target)return err(res,400,'invalid_pagination')}
 else if(pathname==='/api/web/stream'&&req.method==='POST'){
   method='POST';stream=true;let input='';try{for await(const part of req){input+=part;if(Buffer.byteLength(input)>8192)return err(res,413,'request_too_large')}}catch{return err(res,400,'invalid_body')}
   let obj;try{obj=JSON.parse(input)}catch{return err(res,400,'invalid_json')}
   if(typeof obj.message!=='string'||!obj.message.trim()||obj.message.length>4000||Object.keys(obj).some(k=>k!=='message'&&k!=='requestId'))return err(res,400,'invalid_message');
   if(typeof obj.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(obj.requestId))return err(res,400,'request_id_required');
   if(streamBusy)return err(res,409,'chat_in_progress');
   const started=ledger.begin(obj.requestId,obj.message);if(!started.ok)return err(res,409,started.error);
   requestId=obj.requestId;
   streamBusy=true;
   target='/api/sessions/'+encodeURIComponent(sessionId)+'/chat/stream';
   body=JSON.stringify({message:obj.message});
 }else return err(res,404,'route_not_allowed');
 try{await ensureSession()}catch{if(stream)streamBusy=false;return err(res,502,'session_initialization_failed')}
 if(stream){try{const rows=await getHistoryPage(1);const newest=rows.reduce((max,m)=>Number.isSafeInteger(m.id)?Math.max(max,m.id):max,0);ledger.setBaseline(requestId,newest)}catch{streamBusy=false;return err(res,503,'baseline_unavailable')}}
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),stream?240000:15000);
 res.on('close',()=>{if(!res.writableEnded)controller.abort()});
 try{
   const upstream=await fetch(new URL(target,base),{method,headers:{Authorization:'Bearer '+secret,'X-Hermes-Session-Key':SESSION_KEY,...(stream?{'Content-Type':'application/json',Accept:'text/event-stream'}:{Accept:'application/json'})},body,signal:controller.signal,redirect:'error'});
   if(!upstream.ok)return err(res,upstream.status===429?429:502,'upstream_unavailable');
   if(stream){
     const type=upstream.headers.get('content-type')||'';if(!type.includes('text/event-stream'))return err(res,502,'invalid_stream_type');
     res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
     if(!upstream.body){res.end();return}
     let completed=false,assistantCompleted=false;
     const parser=new SSEParser(({event,data})=>{if(event==='done')completed=true;if(event==='assistant.completed'&&data&&typeof data.content==='string')assistantCompleted=true});
     try{
       for await(const chunk of upstream.body){
         parser.feed(chunk);
         if(!res.write(Buffer.from(chunk)))await new Promise(resolve=>res.once('drain',resolve));
       }
       parser.end();
       requestComplete=completed&&assistantCompleted;
       if(!requestComplete){
         res.write('event: bridge.incomplete\ndata: {"error":"stream_incomplete","retrySafe":false}\n\n');
       }
       res.end();
     }catch{
       if(!res.destroyed){res.write('event: bridge.incomplete\ndata: {"error":"stream_interrupted","retrySafe":false}\n\n');res.end()}
     }
   }else{
     const raw=await upstream.text();if(Buffer.byteLength(raw)>2*1024*1024)return err(res,502,'upstream_too_large');
     let obj;try{obj=JSON.parse(raw)}catch{return err(res,502,'invalid_upstream_json')}
     if(!Array.isArray(obj.data)||!obj.pagination)return err(res,502,'invalid_history_shape');
     res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));
   }
 }catch{if(!res.headersSent)err(res,502,'upstream_unavailable');else res.destroy()}
 finally{clearTimeout(timer);if(stream){try{ledger.finish(requestId,requestComplete)}finally{streamBusy=false}}}
}
module.exports={proxy,status,pathForHistory};
