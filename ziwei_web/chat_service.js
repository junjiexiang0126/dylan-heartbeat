'use strict';
const path=require('node:path');
const {ChatStore,uuid,hash}=require('./chat_store'),{HermesClient}=require('./hermes_client'),{Attachments}=require('./attachments'),{SSEParser}=require('./sse_parser');
const TERMINAL=['completed','failed','cancelled','interrupted'];
function createChatService(dir,{authorized=()=>true}={}){
 const client=new HermesClient(),store=new ChatStore(dir,hash(client.base+'|'+client.session+'|'+client.key)),files=new Attachments(dir,store);
 let working=false,closing=false,connected=false,lastError=null,lastCheck=0,checking=null;
 const timers=new Set();
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
 async function body(req){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n<=32768)chunks.push(c);}if(n>32768)throw Error('body_too_large');const v=JSON.parse(Buffer.concat(chunks).toString());if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid_body');return v;}
 function finish(id,o){
  if(!TERMINAL.includes(o.status))return false;
  store.transaction(()=>{if(typeof o.output==='string'&&o.output)store.assistant(id,'reply-'+id,o.output,'final',o.status);store.state(id,o.status,o.status==='completed'?null:'hermes_'+o.status);});return true;
 }
 async function consume(r){
  const upstream=await client.stream(r.run_id,r.upstream_seq);
  if(!upstream.ok||!upstream.headers.get('content-type')?.includes('text/event-stream'))return finish(r.id,await client.status(r.run_id));
  let bytes=0,terminal=false;
  const parser=new SSEParser(({data})=>{
   if(!data||typeof data!=='object')return;const event=data.event||data.type;
   store.upstreamEvent(r.id,data.seq,()=>{
    if(event==='message.delta'&&typeof data.delta==='string')store.event(r.id,'message.delta',{delta:data.delta});
    else if(event==='message.interim'&&typeof data.text==='string'){store.assistant(r.id,'interim-'+r.id+'-'+data.seq,data.text,'commentary');}
    else if(/^run\.(completed|failed|cancelled|interrupted)$/.test(event||'')){terminal=finish(r.id,{...data,status:event.slice(4)});}
    else if(event==='approval.request')store.event(r.id,'request.notice',{text:'知微正在等待原有权限系统的批准。'});
    else if(/^tool\.(started|completed|failed)$/.test(event||''))store.event(r.id,'request.notice',{text:event==='tool.started'?'知微正在处理这条消息。':'知微已更新处理进度。'});
   });
  });
  for await(const c of upstream.body){bytes+=c.length;if(bytes>16*1024*1024)throw Error('stream_limit');parser.feed(c);if(terminal)break;}
  parser.end();if(!terminal)terminal=finish(r.id,await client.status(r.run_id));return terminal;
 }
 async function work(){
  if(working||closing||!client.configured())return;working=true;
  try{
   let r=store.next();while(r&&!closing){
    try{
     await client.init();connected=true;lastError=null;
     if(r.state==='queued'){
      // Persist the exact transport before admission; a lost response reuses identical bytes.
      const payload=JSON.parse(r.payload);payload.transport=files.input(payload);
      store.db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify(payload),r.id);
      store.dispatched(r.id);r=store.request(r.id);
     }
     if(!r.run_id){
      if(!r.submitted_at||Date.now()-r.submitted_at>=3600000)throw Error('admission_uncertain_no_resubmit');
      const runId=await client.submit(r.id,JSON.parse(r.payload).transport);store.admitted(r.id,runId);r=store.request(r.id);
     }
     if(!await consume(r))throw Error('run_still_pending');
    }catch(e){lastError=/^[a-z0-9_]+$/.test(e.message)?e.message:'hermes_connection_failed';connected=false;store.state(r.id,!r.run_id&&/^hermes_(auth_rejected|busy|http_40[0349])$/.test(lastError)?'failed':'uncertain',lastError);break;}
    r=store.next();
   }
  }finally{working=false;}
 }
 const recoveryTimer=setInterval(()=>work().catch(()=>{}),10000);recoveryTimer.unref();timers.add(recoveryTimer);
 function status(){return client.configured();}
 async function proxy(req,res,pathname,url){
  if(!pathname.startsWith('/api/chat/'))return json(res,404,{error:'route_not_allowed'});
  try{
   if(pathname==='/api/chat/status'&&req.method==='GET'){
    if(client.configured()&&Date.now()-lastCheck>30000){if(!checking)checking=client.check().then(()=>{connected=true;lastError=null;}).catch(()=>{connected=false;lastError='hermes_connection_failed';}).finally(()=>{lastCheck=Date.now();checking=null;});await checking;}
    return json(res,200,{configured:client.configured(),connected,lastError,session:client.configured()?client.session:null,attachmentLimit:20*1024*1024});
   }
   if(pathname==='/api/chat/messages'&&req.method==='GET'){
    const limit=Number(url.searchParams.get('limit')||50),before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER),q=url.searchParams.get('q')||'',source=url.searchParams.get('source')||'live';
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(before)||before<1||q.length>200||!['live','archive'].includes(source))throw Error('invalid_pagination');
    const data=store.list({limit,before,q,source,favorite:url.searchParams.get('favorite')==='true',trash:url.searchParams.get('trash')==='true'});
    return json(res,200,{data,before:data[0]?.seq||null,hasMore:data.length===limit});
   }
   if(pathname==='/api/chat/requests'&&req.method==='GET')return json(res,200,{data:store.db.prepare("SELECT id,state,run_id,error,created_at FROM requests WHERE state NOT IN ('completed','failed','cancelled','interrupted') ORDER BY seq").all()});
   if(pathname==='/api/chat/send'&&req.method==='POST'){
    if(!client.configured())return json(res,503,{error:'hermes_not_configured'});
    const b=await body(req);if(Object.keys(b).some(k=>!['requestId','message','attachments','replyTo'].includes(k))||!uuid(b.requestId)||typeof b.message!=='string'||b.message.length>10000||/[\x00]/.test(b.message)||!Array.isArray(b.attachments||[])||(b.attachments||[]).length>6||new Set(b.attachments||[]).size!==(b.attachments||[]).length||!b.message.trim()&&!(b.attachments||[]).length)throw Error('invalid_message');
    b.requestId=b.requestId.toLowerCase();
    const attachments=b.attachments||[];attachments.forEach(id=>files.get(id));
    const old=store.request(b.requestId);if(old){const p=JSON.parse(old.payload);if(p.message!==b.message||JSON.stringify(p.attachments)!==JSON.stringify(attachments)||(p.quote?.id||null)!==(b.replyTo||null))throw Error('request_conflict');return json(res,200,{requestId:b.requestId,state:old.state,replayed:true});}
    let quote=null;if(b.replyTo){const m=store.message(b.replyTo);if(!m||m.source!=='live')throw Error('quote_not_found');quote={id:m.id,role:m.role,content:m.content.slice(0,2000)};}
    const result=store.addRequest(b.requestId,{message:b.message,attachments,quote});
    json(res,result.replayed?200:202,{requestId:b.requestId,state:result.request.state,replayed:result.replayed});void work();return;
   }
   if(pathname==='/api/chat/events'&&req.method==='GET'){
    let after=Number(req.headers['last-event-id']||url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw Error('invalid_event_cursor');
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});res.write(': connected\n\n');let ticks=0;
    const timer=setInterval(()=>{
     if(!authorized(req)){res.end();return;}
     for(const e of store.events(after)){after=e.seq;if(!res.write('id: '+e.seq+'\nevent: '+e.kind+'\ndata: '+JSON.stringify({requestId:e.request_id,...e.data})+'\n\n')){res.end();return;}}
     if(++ticks%30===0)res.write(': keepalive\n\n');
    },300);timers.add(timer);res.on('close',()=>{clearInterval(timer);timers.delete(timer);});return;
   }
   if(pathname==='/api/chat/attachments'&&req.method==='POST')return json(res,201,await files.upload(req));
   const metadata=/^\/api\/chat\/attachments\/([a-f0-9-]{36})\/metadata$/.exec(pathname);if(metadata&&req.method==='GET')return json(res,200,files.get(metadata[1]));
   if(pathname.startsWith('/api/chat/attachments/')&&['GET','HEAD'].includes(req.method))return files.serve(req,res,pathname.slice('/api/chat/attachments/'.length));
   if(pathname==='/api/chat/action'&&req.method==='POST'){const b=await body(req);if(Object.keys(b).some(k=>!['id','action'].includes(k))||typeof b.id!=='string'||!['favorite','unfavorite','delete','restore'].includes(b.action))throw Error('invalid_action');store.action(b.id,b.action);return json(res,200,{ok:true});}
   return json(res,404,{error:'route_not_allowed'});
  }catch(e){if(res.headersSent)return res.destroy();const code=e.message;return json(res,['request_conflict','queue_full'].includes(code)?409:code.includes('not_found')?404:['attachment_too_large','attachment_quota','body_too_large'].includes(code)?413:400,{error:/^[a-z_]+$/.test(code)?code:'invalid_request'});}
 }
 function close(){closing=true;for(const t of timers)clearInterval(t);store.close();}
 queueMicrotask(()=>work().catch(()=>{}));
 return {proxy,status,close,store};
}
module.exports={createChatService};
