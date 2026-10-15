'use strict';
// Protocol fixture only: never considered evidence of a live Agent reply.
const http=require('node:http'),crypto=require('node:crypto');
function fakeHermes({delay=500,loseAdmission=false,interim=true,approval=false,media=null,presence=null,history=[]}={}){
 const runs=new Map(),keys=new Map(),seen=[];let executions=0;
 const server=http.createServer(async(req,res)=>{
  seen.push({url:req.url,method:req.method,authorization:req.headers.authorization,sessionKey:req.headers['x-hermes-session-key']});
  const json=(code,o)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
  if(req.headers.authorization!=='Bearer protocol-fixture-key')return json(401,{error:'unauthorized'});
  if(req.url==='/v1/capabilities')return json(200,{features:{runs_idempotency:{durable:true,retention_seconds:86400},run_events_sse:true}});
  if(req.url==='/api/sessions'&&req.method==='POST')return json(201,{object:'hermes.session'});
  if(req.url.startsWith('/api/sessions?'))return json(200,{data:history,has_more:false});
  const hm=/^\/api\/sessions\/([^/]+)\/messages/.exec(req.url);if(hm){const session=history.find(s=>s.id===decodeURIComponent(hm[1]));return json(200,{data:session?.messages||[]});}
  if(req.url==='/ziwei/web/state')return json(200,presence||{state:null,source:null,updatedAt:null,stale:true});
  if(req.url.startsWith('/api/sessions/')&&req.method==='GET')return json(200,{session:{id:req.url.slice('/api/sessions/'.length)}});
  if(req.url==='/v1/runs'&&req.method==='POST'){
   let text='';for await(const c of req)text+=c;JSON.parse(text);const key=req.headers['idempotency-key'];
   if(keys.has(key)){const r=keys.get(key);if(r.body!==text)return json(409,{error:'idempotency_key_conflict'});return json(202,{run_id:r.id,status:'started',replayed:true});}
   executions++;const id='run_'+crypto.randomUUID().replaceAll('-',''),r={id,body:text,status:approval?'waiting_for_approval':'running',approval:approval?{request_id:'approval-'+id,command:'fixture command',choices:['once','deny']}:null,output:'协议测试回复',events:[],clients:new Set()};keys.set(key,r);runs.set(id,r);
   const send=(event,fields)=>{const e={event,run_id:id,seq:r.events.length,...fields};r.events.push(e);for(const client of r.clients)client.write('id: '+e.seq+'\ndata: '+JSON.stringify(e)+'\n\n');};
   if(approval)setTimeout(()=>send('approval.request',r.approval),10);
   setTimeout(()=>send('message.delta',{delta:'协议测试'}),Math.floor(delay/4));
   if(interim)setTimeout(()=>send('message.interim',{text:'这是过程消息',already_streamed:false}),Math.floor(delay/2));
   r.complete=()=>{r.status='completed';send('run.completed',{output:r.output});for(const client of r.clients)client.end();r.clients.clear();};setTimeout(()=>{if(r.status!=='waiting_for_approval')r.complete();},delay);
   if(loseAdmission){loseAdmission=false;req.socket.destroy();return;}return json(202,{run_id:id,status:'started',replayed:false});
  }
  const am=/^\/ziwei\/web\/runs\/(run_[a-z0-9]+)\/media(?:\/(\d+))?$/.exec(req.url);if(am){if(!runs.has(am[1]))return json(404,{error:'not_found'});if(am[2]!==undefined){if(!media||am[2]!=='0')return json(404,{error:'not_found'});res.writeHead(200,{'Content-Type':media.mime});return res.end(media.bytes);}return json(200,{data:media?[{name:media.name,mime:media.mime,size:media.bytes.length,sha256:crypto.createHash('sha256').update(media.bytes).digest('hex')}]:[]});}
  const ap=/^\/v1\/runs\/(run_[a-z0-9]+)\/approval$/.exec(req.url);if(ap&&req.method==='POST'){const run=runs.get(ap[1]);let body='';for await(const c of req)body+=c;const b=JSON.parse(body);if(!run||run.status!=='waiting_for_approval'||b.request_id!==run.approval.request_id)return json(409,{error:'expired'});run.decision=b.choice;json(200,{resolved:1});run.complete();return;}
  const m=/^\/v1\/runs\/(run_[a-z0-9]+)(\/events)?/.exec(req.url);if(m){const r=runs.get(m[1]);if(!r)return json(404,{error:'not_found'});
   if(!m[2])return json(200,{run_id:r.id,status:r.status,approval:r.approval,...(r.status==='completed'?{output:r.output}:{})});
   const after=Number(new URL(req.url,'http://localhost').searchParams.get('last_seq')||-1);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': open\n\n');
   for(const e of r.events)if(e.seq>after)res.write('id: '+e.seq+'\ndata: '+JSON.stringify(e)+'\n\n');
   if(r.status==='completed')return res.end();r.clients.add(res);res.on('close',()=>r.clients.delete(res));return;
  }
  return json(404,{error:'not_found'});
 });
 return {server,seen,runs,keys,get executions(){return executions;}};
}
module.exports={fakeHermes};
