'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {fakeHermes}=require('./helpers/fake_hermes');
const {ChatStore}=require('../chat_store'),{DatabaseSync}=require('node:sqlite');
async function listen(s){await new Promise(r=>s.listen(0,'127.0.0.1',r));return s.address().port;}
async function until(fn,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,70));}throw Error('timeout');}
async function setup(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-chat-')),fake=fakeHermes(options),up=await listen(fake.server);const probe=http.createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
 const env={...process.env,PORT:String(port),NODE_ENV:'test',ZIWEI_WEB_PASSWORD:'testing-password-123456',ZIWEI_WEB_DATA_DIR:dir,ZIWEI_WEB_ORIGIN:origin,ZIWEI_BRIDGE_ENABLED:'true',ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS:'true',ZIWEI_HERMES_URL:'http://127.0.0.1:'+up,ZIWEI_HERMES_API_KEY:'protocol-fixture-key',ZIWEI_HERMES_WEB_SESSION_ID:'isolated-test-session',...(options.speech?{ZIWEI_VOICE_PYTHON:process.execPath,ZIWEI_SPEECH_TEST_RUNNER:path.join(__dirname,'helpers/speech_fixture.js')}:{ }),...(options.voice?{ZIWEI_VOICE_PYTHON:process.execPath,ZIWEI_VOICE_MODEL_PATH:__dirname,ZIWEI_VOICE_TEST_RUNNER:path.join(__dirname,'helpers/voice_fixture.js')}:{})};let child;
 const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env,stdio:'ignore'});await until(async()=>{try{return (await fetch(origin+'/health')).ok;}catch{return false;}});};await start();
 const stop=async()=>{const p=child;if(p&&p.exitCode===null){p.kill();await new Promise(r=>p.once('exit',r));}};
 t.after(async()=>{await stop();fake.server.closeAllConnections();await new Promise(r=>fake.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:env.ZIWEI_WEB_PASSWORD})});const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
 const headers={Cookie:cookie,Origin:origin,'X-Ziwei-CSRF':csrf,'Content-Type':'application/json'};
 const api=(route,body)=>fetch(origin+route,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const rows=async()=>(await (await api('/api/chat/messages')).json()).data;
 return {origin,api,rows,headers,cookie,dir,fake,start,stop};
}
test('pinned native runs, cross-tab idempotency, FIFO and durable replies',async t=>{
 const s=await setup(t);assert.equal((await fetch(s.origin+'/api/chat/messages')).status,401);
 assert.equal((await fetch(s.origin+'/api/chat/send',{method:'POST',headers:{Cookie:s.cookie,Origin:s.origin},body:'{}'})).status,403);
 assert.equal((await s.api('/api/chat/messages?limit=999')).status,400);assert.equal((await s.api('/api/admin/jobs')).status,404);assert.equal((await s.api('/api/web/stream',{})).status,404);
 const id=crypto.randomUUID(),b={requestId:id,message:'test',attachments:[]};const [a,c]=await Promise.all([s.api('/api/chat/send',b),s.api('/api/chat/send',{...b,requestId:id.toUpperCase()})]);assert.deepEqual([a.status,c.status].sort(),[200,202]);
 assert.equal((await s.api('/api/chat/send',{...b,message:'different'})).status,409);
 const second=crypto.randomUUID();await s.api('/api/chat/send',{requestId:second,message:'second',attachments:[]});
 const messages=await until(async()=>{const r=await s.rows();return r.filter(m=>m.kind==='final'&&m.role==='assistant').length===2&&r;});assert.equal(s.fake.executions,2);assert.equal(messages.filter(m=>m.role==='user').length,2);assert.equal(messages.filter(m=>m.kind==='commentary').length,2);
 for(const req of s.fake.seen){assert.equal(req.authorization,'Bearer protocol-fixture-key');assert.equal(req.sessionKey,req.url.startsWith('/ziwei/web/moments?')?'agent:main:web:isolated-test-session-moments':'agent:main:web:isolated-test-session');assert.ok(!req.url.includes('/api/jobs'));}
 const accepted=[...s.fake.keys.values()].map(x=>JSON.parse(x.body));assert.ok(accepted.every((x,i)=>x.input.endsWith(['test','second'][i])&&x.input.includes('ziwei.reply.v1')));assert.ok(accepted.every(x=>Object.keys(x).sort().join(',')==='input,session_id'));
 await s.stop();await s.start();assert.equal((await s.rows()).length,messages.length);assert.equal((await s.api('/api/chat/send',b)).status,200);assert.equal(s.fake.executions,2);
});
test('browser disconnect and Web process restart continue the existing native run once',async t=>{
 const s=await setup(t,{delay:1500}),id=crypto.randomUUID();await s.api('/api/chat/send',{requestId:id,message:'restart',attachments:[]});await until(()=>s.fake.executions===1);
 const controller=new AbortController();const stream=await fetch(s.origin+'/api/chat/events',{headers:s.headers,signal:controller.signal});await stream.body.getReader().read();controller.abort();
 await s.stop();await s.start();const rows=await until(async()=>{const r=await s.rows();return r.some(m=>m.id==='reply-'+id)&&r;});assert.equal(s.fake.executions,1);assert.equal(rows.filter(m=>m.role==='user').length,1);assert.equal(rows.filter(m=>m.kind==='final'&&m.role==='assistant').length,1);
});
test('lost native acceptance reuses durable idempotency; quotes, search, favorites and soft deletion preserve native history',async t=>{
 const s=await setup(t,{loseAdmission:true}),id=crypto.randomUUID(),b={requestId:id,message:'quoted text',attachments:[]};await s.api('/api/chat/send',b);
 const rows=await until(async()=>{const r=await s.rows();return r.some(m=>m.id==='reply-'+id)&&r;},18000);assert.equal(s.fake.executions,1);
 const user=rows.find(m=>m.role==='user');await s.api('/api/chat/action',{id:user.id,action:'favorite'});assert.equal((await (await s.api('/api/chat/messages?favorite=true&q=quoted')).json()).data.length,1);
 const id2=crypto.randomUUID();await s.api('/api/chat/send',{requestId:id2,message:'follow up',attachments:[],replyTo:user.id});await until(()=>s.fake.executions===2);assert.match(JSON.parse([...s.fake.keys.values()][1].body).input,/引用此前消息/);
 await s.api('/api/chat/action',{id:user.id,action:'delete'});assert.ok(!(await s.rows()).some(m=>m.id===user.id));assert.equal(s.fake.executions,2);assert.ok(s.fake.seen.every(r=>r.method!=='DELETE'));
});
test('private attachments, type/size gates, range downloads and inline image/text transport',async t=>{
 const s=await setup(t);const upload=(name,b,headers=s.headers)=>fetch(s.origin+'/api/chat/attachments',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(name)},body:b});
 assert.equal((await upload('../secret.txt',Buffer.from('bad'))).status,400);assert.equal((await upload('bad.svg',Buffer.from('<svg></svg>'))).status,400);assert.equal((await upload('bad.html',Buffer.from('<html>'))).status,400);assert.equal((await upload('large.txt',Buffer.alloc(20*1024*1024+1))).status,413);
 const a=await (await upload('notes.txt',Buffer.from('附件资料：hello'))).json();assert.equal(a.mime,'text/plain');assert.equal((await fetch(s.origin+'/api/chat/attachments/'+a.id)).status,401);
 const range=await fetch(s.origin+'/api/chat/attachments/'+a.id,{headers:{...s.headers,Range:'bytes=0-3'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,4);assert.match(range.headers.get('content-disposition'),/attachment/);
 assert.equal((await fetch(s.origin+'/api/chat/attachments/'+a.id,{headers:{...s.headers,Range:'bytes=9999-'}})).status,416);assert.equal((await s.api('/api/chat/attachments/'+a.id+'/metadata')).status,200);assert.equal((await fetch(s.origin+'/api/chat/attachments/'+a.id+'/preview')).status,401);assert.equal((await s.api('/api/chat/attachments/'+a.id+'/preview')).status,415);
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),image=await (await upload('sticker.gif',gif)).json();assert.equal(image.mime,'image/gif');
 await s.api('/api/chat/send',{requestId:crypto.randomUUID(),message:'看附件',attachments:[a.id,image.id]});await until(()=>s.fake.executions===1);const parts=JSON.parse([...s.fake.keys.values()][0].body).input[0].content;assert.match(parts[0].text,/hello/);assert.match(parts[1].image_url.url,/^data:image\/gif;base64,/);
 await s.stop();await s.start();assert.equal((await s.api('/api/chat/attachments/'+a.id)).status,200);
});
test('unknown admission older than the native retention safety window never resubmits',async t=>{
 const s=await setup(t);await s.stop();const db=new DatabaseSync(path.join(s.dir,'chat.sqlite'),{readOnly:true}),scope=db.prepare("SELECT value FROM meta WHERE key='scope'").get().value;db.close();const store=new ChatStore(s.dir,scope),id=crypto.randomUUID();store.addRequest(id,{message:'unknown old request',attachments:[],quote:null});store.db.prepare('UPDATE requests SET state=?,submitted_at=?,payload=? WHERE id=?').run('uncertain',Date.now()-7200000,JSON.stringify({message:'unknown old request',attachments:[],quote:null,transport:'unknown old request'}),id);store.close();await s.start();
 await until(async()=>{const o=await (await s.api('/api/chat/requests')).json();return o.data.some(r=>r.error==='admission_uncertain_no_resubmit');});assert.equal(s.fake.executions,0);assert.ok(s.fake.seen.every(r=>r.url!=='/v1/runs'));
});

test('voice bytes stay private, transcript reaches Hermes once, failed audio does not block text',async t=>{
 const s=await setup(t,{voice:true});
 const upload=async data=>(await (await fetch(s.origin+'/api/chat/attachments',{method:'POST',headers:{...s.headers,'Content-Type':'application/octet-stream','X-Filename':'voice.wav'},body:data})).json());
 const wav=Buffer.alloc(16044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
 const a=await upload(wav);assert.equal(a.mime,'audio/wav');
 assert.equal((await fetch(s.origin+'/api/chat/attachments/'+a.id)).status,401);
 const play=await fetch(s.origin+'/api/chat/attachments/'+a.id,{headers:{...s.headers,Range:'bytes=0-43'}});assert.equal(play.status,206);assert.match(play.headers.get('content-disposition'),/inline/);
 const id=crypto.randomUUID(),body={requestId:id,message:'',attachments:[a.id]};await s.api('/api/chat/send',body);
 await until(async()=>{const r=await s.rows();return r.some(m=>m.id==='reply-'+id);});
 assert.match(JSON.parse([...s.fake.keys.values()][0].body).input,/fixture spoken 427/);
 const message=(await s.rows()).find(m=>m.id==='user-'+id);assert.equal(message.content,'');assert.deepEqual(message.attachments,[a.id]);
 await s.api('/api/chat/send',body);assert.equal(s.fake.executions,1);
 const bad=await upload(Buffer.from('RIFFbad!WAVEbad'));const badId=crypto.randomUUID();await s.api('/api/chat/send',{requestId:badId,message:'',attachments:[bad.id]});
 await until(async()=> (await s.rows()).some(m=>m.id==='user-'+badId&&m.status==='failed'));
 const textId=crypto.randomUUID();await s.api('/api/chat/send',{requestId:textId,message:'after invalid voice',attachments:[]});
 await until(async()=> (await s.rows()).some(m=>m.id==='reply-'+textId));assert.equal(s.fake.executions,2);
 await s.stop();await s.start();assert.equal((await s.rows()).find(m=>m.id==='user-'+id).attachments[0],a.id);assert.equal((await s.api('/api/chat/attachments/'+a.id)).status,200);
});

test('approval cards resolve one exact owned native request and expired choices never execute',async t=>{
 const s=await setup(t,{approval:true,delay:500}),id=crypto.randomUUID();await s.api('/api/chat/send',{requestId:id,message:'approval fixture',attachments:[]});
 const list=await until(async()=>{const a=await (await s.api('/api/chat/approvals')).json();return a.data.length&&a.data;});const a=list[0];assert.deepEqual(a.choices,['once','deny']);
 assert.equal((await s.api('/api/chat/approval',{requestId:id,approvalId:'wrong',choice:'once'})).status,409);
 assert.equal((await s.api('/api/chat/approval',{requestId:id,approvalId:a.approvalId,choice:'always'})).status,400);
 assert.equal((await s.api('/api/chat/approval',{requestId:id,approvalId:a.approvalId,choice:'once'})).status,200);
 await until(async()=> (await s.rows()).some(m=>m.id==='reply-'+id));assert.equal(s.fake.executions,1);assert.equal([...s.fake.runs.values()][0].decision,'once');
 assert.equal((await s.api('/api/chat/approval',{requestId:id,approvalId:a.approvalId,choice:'once'})).status,409);
});

test('native history imports incrementally without duplicate rows or writes to Hermes',async t=>{
 const history=[{id:'web-owner-moments',messages:[{id:1,role:'user',content:'PRIVATE MOMENT CONTEXT',timestamp:1700000000}]},{id:'real-history-fixture',messages:[{id:1,role:'user',content:'older user',timestamp:1700000000},{id:2,role:'assistant',content:'older reply',timestamp:1700000001},{id:1,role:'user',content:'older user',timestamp:1700000000}]}],s=await setup(t,{history});
 assert.equal((await s.api('/api/chat/history/sync',{})).status,202);await until(async()=> (await (await s.api('/api/chat/history')).json()).state==='completed');
 let archive=await (await s.api('/api/chat/messages?source=archive')).json();assert.equal(archive.data.length,2);assert.ok(archive.data[0].source_ref.startsWith('native:'));
 history[1].messages.push({id:3,role:'user',content:'new increment',timestamp:1700000002});await s.api('/api/chat/history/sync',{});await until(async()=>{const state=await (await s.api('/api/chat/history')).json();return state.state==='completed'&&state.messages===3;});
 archive=await (await s.api('/api/chat/messages?source=archive')).json();assert.equal(archive.data.length,3);assert.equal(s.fake.executions,0);assert.equal(s.fake.seen.some(r=>r.method!=='GET'),false);
 await s.stop();await s.start();assert.equal((await (await s.api('/api/chat/history')).json()).messages,3);
});

test('native media is copied privately, verified and linked once; reply reading is cached',async t=>{
 const bytes=Buffer.from('ID3private-fixture-audio'),s=await setup(t,{media:{name:'native.mp3',mime:'audio/mpeg',bytes},speech:true}),id=crypto.randomUUID();
 await s.api('/api/chat/send',{requestId:id,message:'media fixture',attachments:[]});const rows=await until(async()=>{const rows=await s.rows();return rows.find(m=>m.id==='reply-'+id)?.attachments.length&&rows;});const reply=rows.find(m=>m.id==='reply-'+id);assert.equal(reply.attachments.length,1);
 const audioId=reply.attachments[0];assert.equal((await fetch(s.origin+'/api/chat/attachments/'+audioId)).status,401);assert.deepEqual(Buffer.from(await (await s.api('/api/chat/attachments/'+audioId)).arrayBuffer()),bytes);
 await s.api('/api/chat/media/sync',{});assert.equal((await s.rows()).find(m=>m.id===reply.id).attachments.length,1);
 const [one,two]=await Promise.all([s.api('/api/chat/speech',{messageId:reply.id}),s.api('/api/chat/speech',{messageId:reply.id})]);assert.equal(one.status,200);assert.equal(two.status,200);assert.equal((await one.json()).id,(await two.json()).id);
 assert.equal((await s.api('/api/chat/speech',{messageId:'user-'+id})).status,400);
});

test('outgoing text file downloads byte-for-byte, retries once without another model run and persists delivery',async t=>{
 const bytes=Buffer.from('真实文件验收 ZW-FILE-729\n第二行：中文。\n'),media={name:'给小语-20261015.txt',mime:'text/plain',bytes,unavailable:true};
 const s=await setup(t,{media,output:'路径备份：/data/hermes_native/workspace/outbox/给小语-20261015.txt'}),id=crypto.randomUUID(),messageId='reply-'+id;
 await s.api('/api/chat/send',{requestId:id,message:'file delivery fixture',attachments:[]});
 const failed=await until(async()=>{const reply=(await s.rows()).find(m=>m.id===messageId);return reply?.mediaDelivery?.state==='failed'&&reply;});assert.equal(failed.status,'completed');assert.equal(failed.attachments.length,0);assert.ok((await s.rows()).filter(m=>m.kind==='commentary').every(m=>m.mediaDelivery===undefined));
 let sync=await (await s.api('/api/chat/media/sync',{messageId})).json();assert.equal(sync.ok,false);assert.equal(sync.data[0].state,'failed');assert.equal(s.fake.executions,1);
 media.unavailable=false;sync=await (await s.api('/api/chat/media/sync',{messageId})).json();assert.equal(sync.ok,true);const reply=(await s.rows()).find(m=>m.id===messageId);assert.equal(reply.mediaDelivery.state,'complete');assert.equal(reply.attachments.length,1);
 const attachment=reply.attachments[0],download=await s.api('/api/chat/attachments/'+attachment);assert.match(download.headers.get('content-disposition'),/attachment; filename\*=UTF-8/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.equal((await fetch(s.origin+'/api/chat/attachments/'+attachment)).status,401);
 media.errors=[{code:'media_file_missing'}];sync=await(await s.api('/api/chat/media/sync',{messageId})).json();assert.equal(sync.ok,false);assert.equal(sync.data[0].state,'partial');assert.equal((await s.rows()).find(m=>m.id===messageId).attachments.length,1);media.errors=[];
 await s.api('/api/chat/media/sync',{messageId});assert.equal((await s.rows()).find(m=>m.id===messageId).attachments.length,1);assert.equal(s.fake.executions,1);
 assert.equal((await s.api('/api/chat/media/sync',{messageId:'user-'+id})).status,404);assert.equal((await s.api('/api/chat/media/sync',{messageId,run_id:'foreign'})).status,400);
 await s.stop();await s.start();assert.equal((await s.rows()).find(m=>m.id===messageId).mediaDelivery.state,'complete');assert.deepEqual(Buffer.from(await (await s.api('/api/chat/attachments/'+attachment)).arrayBuffer()),bytes);
});
test('missing original file and corrupt download are visible and never falsely mark reply delivery complete',async t=>{
 const media={name:'note.txt',mime:'text/plain',bytes:Buffer.from('expected bytes'),missing:true,errors:[{code:'media_file_missing'}]},s=await setup(t,{media,output:'MEDIA:/data/hermes_native/workspace/outbox/note.txt'}),id=crypto.randomUUID(),messageId='reply-'+id;
 await s.api('/api/chat/send',{requestId:id,message:'missing file fixture',attachments:[]});
 await until(async()=> (await s.rows()).find(m=>m.id===messageId)?.mediaDelivery?.error==='media_file_missing');
 media.missing=false;media.errors=[];media.corrupt=true;
 const sync=await (await s.api('/api/chat/media/sync',{messageId})).json();assert.equal(sync.ok,false);const reply=(await s.rows()).find(m=>m.id===messageId);assert.equal(reply.mediaDelivery.state,'failed');assert.equal(reply.attachments.length,0);assert.equal(s.fake.executions,1);
 media.corrupt=false;assert.equal((await (await s.api('/api/chat/media/sync',{messageId})).json()).ok,true);
});
test('native pat is imported once and user pat replays one exact event and run',async t=>{
 const nativeId=crypto.randomUUID(),s=await setup(t,{pokes:[{id:nativeId,author:'ziwei',target:'user',at:new Date().toISOString()}]});await until(async()=> (await s.rows()).some(m=>m.id==='poke-native-'+nativeId));const id=crypto.randomUUID(),payload={id,target:'ziwei'};
 const one=await s.api('/api/chat/poke',payload),two=await s.api('/api/chat/poke',payload);assert.equal(one.status,200);assert.equal((await two.json()).replayed,true);await until(()=>s.fake.executions===1);const rows=await s.rows();assert.equal(rows.filter(m=>m.id==='poke-'+id).length,1);assert.equal(rows.filter(m=>m.id==='poke-native-'+nativeId).length,1);assert.ok(rows.every(m=>m.id!=='user-'+id));
 assert.equal((await fetch(s.origin+'/api/chat/poke',{method:'POST',headers:{Cookie:s.cookie,Origin:s.origin},body:JSON.stringify(payload)})).status,403);
});


test('records use authenticated read-only native sources; updates stay live and no Agent run is launched',async t=>{
 let revision='first';const s=await setup(t,{records:(kind,url)=>kind==='memory'?{files:[{name:'MEMORY.md',entries:[{text:revision}],updated_at:1700000000,chars:revision.length,lines:1,sha256:'a'.repeat(64)}],errors:[]}:kind==='work'?{data:[{kind:'briefing',title:'rest',body:'实际休息',at:'2026-10-15T08:00:00+07:00',refs:[],failed:false},{kind:'memory_audit',title:'replace',body:'记忆条目',at:'2026-10-15T08:01:00+07:00',refs:[],failed:true}],errors:[],has_more:false}:{source:'hermes_native',data:[],nextOffset:null,total:0,errors:[]}});
 assert.equal((await fetch(s.origin+'/api/records/memory')).status,401);
 assert.equal((await fetch(s.origin+'/api/records/memory',{method:'POST',headers:{Cookie:s.cookie,Origin:s.origin},body:'{}'})).status,403);
 assert.equal((await s.api('/api/records/memory',{})).status,405);
 assert.equal((await s.api('/api/records/private')).status,404);
 assert.equal((await s.api('/api/records/work?path=../secret')).status,400);
 const first=await (await s.api('/api/records/memory')).json();assert.equal(first.data[0].content,'first');assert.equal(first.counts.uncategorized,1);assert.equal(first.counts.protected,0);assert.deepEqual((await (await s.api('/api/records/memory?category=protected')).json()).data,[]);assert.equal((await (await s.api('/api/records/memory?id='+first.data[0].id)).json()).content,'first');
 revision='second';assert.equal((await (await s.api('/api/records/memory?q=second')).json()).data[0].content,'second');
 for(const kind of ['diary','work'])assert.equal((await s.api('/api/records/'+kind)).status,200);const work=await (await s.api('/api/records/work')).json();assert.equal(work.data.find(r=>r.basis==='memory_audit').state,'pending');assert.equal(work.data.find(r=>r.basis==='agent_briefing').state,'recorded');
 assert.equal(s.fake.executions,0);assert.equal(s.fake.seen.filter(x=>/^\/ziwei\/web\/(memory|logs|diary)/.test(x.url)).every(x=>x.method==='GET'),true);
 assert.equal(fs.existsSync(path.join(s.dir,'memory.sqlite')),false);
});

test('unavailable native records remain an explicit failure and SSE tail skips historical event replay',async t=>{
 const s=await setup(t),id=crypto.randomUUID();assert.equal((await s.api('/api/records/diary')).status,503);
 await s.api('/api/chat/send',{requestId:id,message:'old event',attachments:[]});await until(async()=> (await s.rows()).some(m=>m.id==='reply-'+id));
 const messages=await (await s.api('/api/chat/messages')).json();assert.ok(messages.eventCursor>0);
 const controller=new AbortController(),stream=await fetch(s.origin+'/api/chat/events?tail=true',{headers:s.headers,signal:controller.signal});
 const text=new TextDecoder().decode((await stream.body.getReader().read()).value);assert.match(text,/event: cursor/);assert.match(text,new RegExp('id: '+messages.eventCursor));assert.doesNotMatch(text,/request.state|message.delta/);controller.abort();
});

test('Agent-chosen segments persist as independent messages; summaries and exact raw output survive restart',async t=>{
 const output=JSON.stringify({type:'ziwei.reply.v1',messages:['第一条完整消息','第二条\n```js\nconst x=1;\n```'],summary:'先确认需求，再给出示例。'});
 const s=await setup(t,{output,interim:false}),id=crypto.randomUUID();
 await s.api('/api/chat/send',{requestId:id,message:'由你决定消息数量',attachments:[]});
 const rows=await until(async()=>{const rows=await s.rows();return rows.filter(x=>x.role==='assistant'&&x.kind==='final').length===2&&rows;});
 assert.deepEqual(rows.filter(x=>x.kind==='final'&&x.role==='assistant').map(x=>x.content),JSON.parse(output).messages);
 assert.equal(rows.find(x=>x.kind==='summary').content,JSON.parse(output).summary);
 const final=rows.find(x=>x.id==='reply-'+id);assert.equal(final.content,JSON.parse(output).messages[1]);
 await s.stop();const db=new DatabaseSync(path.join(s.dir,'chat.sqlite'));assert.equal(JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('presentation:'+id).value).raw,output);db.close();
 await s.start();assert.deepEqual((await s.rows()).filter(x=>x.role==='assistant'&&x.kind==='final').map(x=>x.content),JSON.parse(output).messages);assert.equal(s.fake.executions,1);
});

test('public tool actions survive restart in real order while thinking, args and reasoning never persist',async t=>{
 const secret='PRIVATE_THINKING_SENTINEL',s=await setup(t,{delay:350,toolEvents:[
  {event:'tool.started',data:{tool_name:'terminal',preview:'wc -l',args:{secret},ts:'2026-10-16T10:00:00Z'}},
  {event:'tool.progress',data:{tool_name:'_thinking',delta:secret,reasoning_content:secret}},
  {event:'tool.completed',data:{tool_name:'terminal',args:{secret},ts:'2026-10-16T10:00:00.100Z'}},
  {event:'tool.started',data:{tool_name:'read_file',preview:'notes.md',ts:'2026-10-16T10:00:00.120Z'}},
  {event:'tool.failed',data:{tool_name:'read_file',reasoning_content:secret,ts:'2026-10-16T10:00:00.220Z'}},
  {event:'tool.started',data:{tool_name:'browser',preview:'打开网页',ts:'2026-10-16T10:00:00.300Z'}}
 ]}),id=crypto.randomUUID();await s.api('/api/chat/send',{requestId:id,message:'action fixture',attachments:[]});
 const rows=await until(async()=>{const r=await s.rows();return r.find(m=>m.id==='reply-'+id)&&r;}),actions=rows.find(m=>m.id==='reply-'+id).toolActions;assert.deepEqual(actions.map(r=>r.tool),['terminal','read_file','browser']);assert.deepEqual(actions.map(r=>r.state),['completed','failed','in_progress']);assert.equal(actions[0].elapsedMs,100);assert.ok(!JSON.stringify(rows).includes(secret));assert.equal(rows.filter(m=>m.toolActions?.length).length,1);
 await s.stop();const db=new DatabaseSync(path.join(s.dir,'chat.sqlite'),{readOnly:true});for(const table of ['tool_actions','messages','events','meta'])assert.ok(!JSON.stringify(db.prepare('SELECT * FROM '+table).all()).includes(secret));db.close();await s.start();assert.deepEqual((await s.rows()).find(m=>m.id==='reply-'+id).toolActions,actions);assert.equal(s.fake.executions,1);
});

test('photo BFF authenticates byte proxies, verifies hashes, limits uploads and forwards native ownership failures',async t=>{
 const pid=crypto.randomUUID(),note=crypto.randomUUID(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),seen=[];let corrupt=false;
 const s=await setup(t,{photoRoute:async(req,res,json)=>{let body=Buffer.alloc(0);for await(const c of req)body=Buffer.concat([body,c]);seen.push({url:req.url,method:req.method,headers:req.headers,body});if(req.url.includes('/file')){res.writeHead(200,{'Content-Type':'image/png','X-Content-Sha256':crypto.createHash('sha256').update(corrupt?Buffer.from('bad'):bytes).digest('hex')});return res.end(bytes);}if(req.method==='PATCH'||req.method==='DELETE')return json(403,{error:'not_owner'});if(req.method==='POST')return json(201,{photo:{id:pid,source:'user'},annotation:{id:note,author:'user'}});return json(200,{data:[],total:0,next_cursor:null,errors:[]});}});
 const url=s.origin+'/api/photos/'+pid+'/file';assert.equal((await fetch(url)).status,401);const good=await fetch(url,{headers:s.headers});assert.equal(good.status,200);assert.deepEqual(Buffer.from(await good.arrayBuffer()),bytes);assert.equal(good.headers.get('cache-control'),'no-store');corrupt=true;assert.equal((await fetch(url,{headers:s.headers})).status,503);corrupt=false;
 const upload=body=>fetch(s.origin+'/api/photos',{method:'POST',headers:{...s.headers,'Content-Type':'image/png','X-Photo-Id':pid,'X-Photo-Name':'tiny.png','X-Photo-Actor':'ziwei'},body});assert.equal((await upload(bytes)).status,201);assert.deepEqual(seen.at(-1).body,bytes);assert.equal(seen.at(-1).headers['x-photo-actor'],undefined);assert.equal(seen.at(-1).headers.authorization,'Bearer protocol-fixture-key');assert.equal((await upload(Buffer.alloc(9500001))).status,413);assert.equal((await upload(Buffer.from('<svg>'))).status,400);
 const count=seen.length,route='/api/photos/'+pid+'/annotations/'+note;assert.equal((await fetch(s.origin+route,{method:'PATCH',headers:s.headers,body:JSON.stringify({text:'attempt',author:'ziwei'})})).status,400);assert.equal(seen.length,count);assert.equal((await fetch(s.origin+route,{method:'PATCH',headers:s.headers,body:JSON.stringify({text:'attempt'})})).status,403);assert.equal((await fetch(s.origin+route,{method:'DELETE',headers:s.headers})).status,403);assert.equal((await fetch(s.origin+'/api/photos',{method:'POST',headers:{Cookie:s.cookie,Origin:s.origin},body:bytes})).status,403);
});
