'use strict';
const path=require('node:path'),fs=require('node:fs');
const {NativeHistory}=require('./native_history'),{VoiceSynthesizer}=require('./voice_synthesizer'),{extract}=require('./document_text');
const {ChatStore,uuid,hash}=require('./chat_store'),{HermesClient}=require('./hermes_client'),{Attachments}=require('./attachments'),{SSEParser}=require('./sse_parser');
const TERMINAL=['completed','failed','cancelled','interrupted'];
const {VoiceTranscriber}=require('./voice_transcriber');
function createChatService(dir,{authorized=()=>true}={}){
 const client=new HermesClient(),store=new ChatStore(dir,hash(client.base+'|'+client.session+'|'+client.key)),files=new Attachments(dir,store),voice=new VoiceTranscriber();
 const history=new NativeHistory(client,store),speech=new VoiceSynthesizer(files);
 let presenceCache=null,working=false,closing=false,connected=false,lastError=null,lastCheck=0,checking=null;
 const timers=new Set();
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
 async function body(req){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n<=32768)chunks.push(c);}if(n>32768)throw Error('body_too_large');const v=JSON.parse(Buffer.concat(chunks).toString());if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid_body');return v;}
 async function presence(){
  if(presenceCache&&Date.now()-presenceCache.at<10000)return presenceCache.value;
  let value={state:null,source:null,updatedAt:null,stale:true};
  try{const o=await client.json('/ziwei/web/state',{signal:AbortSignal.timeout(2500)});value.available=true;if(o.source==='ziwei'&&['在工作','在休息','在思考','在想你'].includes(o.state)&&Number.isFinite(Date.parse(o.updatedAt)))value={available:true,state:o.state,source:'ziwei',updatedAt:o.updatedAt,stale:o.stale!==false||Date.now()-Date.parse(o.updatedAt)>1800000};}catch{}
  presenceCache={at:Date.now(),value};return value;
 }
 function approvalRecord(id,data){
  const requestId=data.request_id;
  if(typeof requestId!=='string'||!requestId||requestId.length>256)return;
  const choices=['once','deny'].filter(c=>(data.choices||[]).includes(c));
  const record={requestId:id,approvalId:requestId,command:String(data.command||data.description||'原生权限请求').slice(0,4000),choices,at:new Date().toISOString()};
  store.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('approval:'+id,JSON.stringify(record));
  store.event(id,'approval.pending',record);
 }
 const mediaJobs=new Map();
 function delivery(r,value){
  if(closing)return value;
  store.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('media:'+r.id,JSON.stringify(value));
  store.event(r.id,'timeline.changed',{id:'reply-'+r.id});return value;
 }
 async function collectMedia(r){
  if(!r.run_id||closing)return {state:'unavailable',error:'media_run_unavailable'};
  if(mediaJobs.has(r.id))return mediaJobs.get(r.id);
  const job=(async()=>{
   const ids=[],issues=[];let expected=false;
   try{
    const reply=store.message('reply-'+r.id);expected=!!reply&&(/MEDIA:|\/workspace\/outbox\//.test(reply.content));
    const result=await client.json('/ziwei/web/runs/'+r.run_id+'/media');
    if(!Array.isArray(result.data)||result.data.length>6)throw Error('media_manifest_invalid');
    for(const issue of result.errors||[])issues.push(typeof issue.code==='string'?issue.code:'media_unavailable');
    for(const [position,a] of result.data.entries()){
     try{
      if(!a||typeof a.name!=='string'||/[\x00-\x1f\x7f/\\]/.test(a.name)||a.name.length>160||!Number.isSafeInteger(a.size)||a.size<1||a.size>20*1024*1024||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('media_manifest_invalid');
      const index=a.index===undefined?position:a.index;if(!Number.isSafeInteger(index)||index<0||index>5)throw Error('media_manifest_invalid');
      const prior=reply?.attachments.map(id=>store.attachment(id)).find(old=>old?.sha256===a.sha256&&old.name===a.name);
      const seed=hash(r.id+':'+position+':'+a.sha256),id=prior?.id||seed.slice(0,8)+'-'+seed.slice(8,12)+'-4'+seed.slice(13,16)+'-8'+seed.slice(17,20)+'-'+seed.slice(20,32);
      if(!store.attachment(id)){
       const response=await client.fetch('/ziwei/web/runs/'+r.run_id+'/media/'+index);if(!response.ok)throw Error('media_read_failed');
       const chunks=[];let n=0;for await(const c of response.body){n+=c.length;if(n>a.size)throw Error('media_size');chunks.push(c);}const bytes=Buffer.concat(chunks);
       if(n!==a.size||hash(bytes)!==a.sha256)throw Error('media_integrity');if(closing)return {state:'unavailable',error:'media_stopped'};files.save(bytes,a.name,id);
      }
      ids.push(id);store.addMedia('reply-'+r.id,[id]);
     }catch(e){issues.push(e.message);}
    }
    if(!ids.length&&!issues.length&&expected)issues.push('media_not_registered');
   }catch(e){if(expected)issues.push(e.message);else return delivery(r,{state:'unavailable',count:0,error:'media_manifest_unavailable'});}
   const value={state:issues.length?(ids.length?'partial':'failed'):ids.length?'complete':'none',count:ids.length,error:issues.length?String(issues[0]).replace(/[^a-z0-9_]/g,'').slice(0,80):null};
   return delivery(r,value);
  })().finally(()=>mediaJobs.delete(r.id));mediaJobs.set(r.id,job);return job;
 }

 function finish(id,o){
  if(!TERMINAL.includes(o.status))return false;
  store.db.prepare('DELETE FROM meta WHERE key=?').run('approval:'+id);
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
    else if(event==='approval.request'){approvalRecord(r.id,data);store.event(r.id,'request.notice',{text:'知微正在等待你的批准。'});}
    else if(event==='approval.responded'){store.db.prepare('DELETE FROM meta WHERE key=?').run('approval:'+r.id);store.event(r.id,'approval.resolved',{});}
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
      const payload=JSON.parse(r.payload),transcripts=await files.transcripts(payload,voice),documents={};for(const id of payload.attachments){const a=files.get(id),d=await extract(path.join(files.dir,id),a.name);if(d?.text)documents[id]=d;}payload.transport=files.input(payload,transcripts,documents);
      store.db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify(payload),r.id);
      store.dispatched(r.id);r=store.request(r.id);
     }
     if(!r.run_id){
      if(!r.submitted_at||Date.now()-r.submitted_at>=3600000)throw Error('admission_uncertain_no_resubmit');
      const runId=await client.submit(r.id,JSON.parse(r.payload).transport);store.admitted(r.id,runId);r=store.request(r.id);
     }
     if(!await consume(r))throw Error('run_still_pending');
     await collectMedia(r);
    }catch(e){lastError=/^[a-z0-9_]+$/.test(e.message)?e.message:'hermes_connection_failed';connected=false;const voiceFailure=!r.run_id&&/^voice_/.test(lastError);store.state(r.id,voiceFailure||!r.run_id&&/^hermes_(auth_rejected|busy|http_40[0349])$/.test(lastError)?'failed':'uncertain',lastError);if(voiceFailure){r=store.next();continue;}break;}
    r=store.next();
   }
  }finally{working=false;}
 }
 const historyTimer=setInterval(()=>{if(!closing&&client.configured())void history.sync();},60000);historyTimer.unref();timers.add(historyTimer);
 const recoveryTimer=setInterval(()=>work().catch(()=>{}),10000);recoveryTimer.unref();timers.add(recoveryTimer);
 function status(){return client.configured();}
 async function proxy(req,res,pathname,url){
  if(!pathname.startsWith('/api/chat/'))return json(res,404,{error:'route_not_allowed'});
  try{
   if(pathname==='/api/chat/status'&&req.method==='GET'){
    if(client.configured()&&Date.now()-lastCheck>30000){if(!checking)checking=client.check().then(()=>{connected=true;lastError=null;}).catch(()=>{connected=false;lastError='hermes_connection_failed';}).finally(()=>{lastCheck=Date.now();checking=null;});await checking;}
    return json(res,200,{configured:client.configured(),connected,lastError,voiceConfigured:voice.available(),presence:await presence(),session:client.configured()?client.session:null,attachmentLimit:20*1024*1024});
   }
   if(pathname==='/api/chat/history/sync'&&req.method==='POST'){await body(req);return json(res,202,await history.sync());}
   if(pathname==='/api/chat/history'&&req.method==='GET')return json(res,200,history.status());
   if(pathname==='/api/chat/presence'&&req.method==='GET')return json(res,200,await presence());
   if(pathname==='/api/chat/approvals'&&req.method==='GET'){
    const data=store.db.prepare("SELECT value FROM meta WHERE key LIKE 'approval:%'").all().map(r=>JSON.parse(r.value));return json(res,200,{data});
   }
   if(pathname==='/api/chat/approval'&&req.method==='POST'){
    const b=await body(req);if(Object.keys(b).some(k=>!['requestId','approvalId','choice'].includes(k))||!uuid(b.requestId)||typeof b.approvalId!=='string'||!['once','deny'].includes(b.choice))throw Error('invalid_approval');
    const r=store.request(b.requestId),row=store.db.prepare('SELECT value FROM meta WHERE key=?').get('approval:'+b.requestId),a=row&&JSON.parse(row.value);
    if(!r?.run_id||!a||a.approvalId!==b.approvalId||!a.choices.includes(b.choice))return json(res,409,{error:'approval_expired'});
    const current=await client.status(r.run_id);if(current.status!=='waiting_for_approval'||current.approval?.request_id!==b.approvalId){store.db.prepare('DELETE FROM meta WHERE key=?').run('approval:'+r.id);return json(res,409,{error:'approval_expired'});}
    const result=await client.json('/v1/runs/'+r.run_id+'/approval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:b.approvalId,choice:b.choice})});
    if(!result.resolved)return json(res,409,{error:'approval_expired'});store.db.prepare('DELETE FROM meta WHERE key=?').run('approval:'+r.id);store.event(r.id,'approval.resolved',{});return json(res,200,{ok:true});
   }
   if(pathname==='/api/chat/media/sync'&&req.method==='POST'){
    const b=await body(req);if(Object.keys(b).some(k=>k!=='messageId')||b.messageId!==undefined&&typeof b.messageId!=='string')throw Error('invalid_media_sync');
    let rows;if(b.messageId){const m=store.message(b.messageId);if(!m||m.role!=='assistant'||m.source!=='live'||!m.request_id)throw Error('message_not_found');const r=store.request(m.request_id);if(!r?.run_id||!TERMINAL.includes(r.state))throw Error('media_run_unavailable');rows=[r];}
    else rows=store.db.prepare("SELECT * FROM requests WHERE run_id IS NOT NULL AND state IN ('completed','failed','interrupted') ORDER BY seq DESC LIMIT 10").all();
    const data=[];for(const r of rows)data.push({messageId:'reply-'+r.id,...await collectMedia(r)});
    return json(res,200,{ok:data.every(r=>!['partial','failed','unavailable'].includes(r.state)),data});
   }
   if(pathname==='/api/chat/speech'&&req.method==='POST'){const b=await body(req);if(Object.keys(b).some(k=>k!=='messageId')||typeof b.messageId!=='string')throw Error('invalid_speech');const m=store.message(b.messageId);if(!m)throw Error('message_not_found');return json(res,200,await speech.read(m));}
   if(pathname==='/api/chat/messages'&&req.method==='GET'){
    const limit=Number(url.searchParams.get('limit')||50),before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER),q=url.searchParams.get('q')||'',source=url.searchParams.get('source')||'live';
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(before)||before<1||q.length>200||!['live','archive'].includes(source))throw Error('invalid_pagination');
    const data=store.list({limit,before,q,source,favorite:url.searchParams.get('favorite')==='true',trash:url.searchParams.get('trash')==='true'});
    return json(res,200,{data,before:data[0]?.seq||null,hasMore:data.length===limit});
   }
   const requestIdMatch=/^\/api\/chat\/requests\/([a-f0-9-]{36})$/.exec(pathname);if(requestIdMatch&&req.method==='GET'){const r=store.request(requestIdMatch[1]);if(!r)return json(res,404,{error:'request_not_found'});return json(res,200,{requestId:r.id,state:r.state,error:r.error});}
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
  }catch(e){if(res.headersSent)return res.destroy();const code=e.message;return json(res,['request_conflict','queue_full','speech_busy','hermes_http_409'].includes(code)?409:code.includes('not_found')?404:['attachment_too_large','attachment_quota','body_too_large'].includes(code)?413:400,{error:/^[a-z_]+$/.test(code)?code:'invalid_request'});}
 }
 function close(){closing=true;history.close();for(const t of timers)clearInterval(t);store.close();}
 queueMicrotask(()=>{void work().catch(()=>{});if(process.env.NODE_ENV==='production'&&client.configured()){void history.sync();void client.check().then(async()=>console.log('WEB_INTEGRATION_READY '+JSON.stringify({transport:true,stateEndpoint:!!(await presence()).available,voice:voice.available()}))).catch(()=>console.log('WEB_INTEGRATION_READY '+JSON.stringify({transport:false})));}});
 return {proxy,status,close,store,presence};
}
module.exports={createChatService};
