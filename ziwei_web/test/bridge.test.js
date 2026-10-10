'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {fakeHermes}=require('./helpers/fake_hermes');
const {ChatStore}=require('../chat_store'),{DatabaseSync}=require('node:sqlite');
async function listen(s){await new Promise(r=>s.listen(0,'127.0.0.1',r));return s.address().port;}
async function until(fn,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,70));}throw Error('timeout');}
async function setup(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-chat-')),fake=fakeHermes(options),up=await listen(fake.server);const probe=http.createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
 const env={...process.env,PORT:String(port),NODE_ENV:'test',ZIWEI_WEB_PASSWORD:'testing-password-123456',ZIWEI_WEB_DATA_DIR:dir,ZIWEI_WEB_ORIGIN:origin,ZIWEI_BRIDGE_ENABLED:'true',ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS:'true',ZIWEI_HERMES_URL:'http://127.0.0.1:'+up,ZIWEI_HERMES_API_KEY:'protocol-fixture-key',ZIWEI_HERMES_WEB_SESSION_ID:'isolated-test-session'};let child;
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
 for(const req of s.fake.seen){assert.equal(req.authorization,'Bearer protocol-fixture-key');assert.equal(req.sessionKey,'agent:main:web:isolated-test-session');assert.ok(!req.url.includes('/api/jobs'));}
 const accepted=[...s.fake.keys.values()].map(x=>JSON.parse(x.body));assert.deepEqual(accepted.map(x=>x.input),['test','second']);assert.ok(accepted.every(x=>Object.keys(x).sort().join(',')==='input,session_id'));
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
 assert.equal((await fetch(s.origin+'/api/chat/attachments/'+a.id,{headers:{...s.headers,Range:'bytes=9999-'}})).status,416);assert.equal((await s.api('/api/chat/attachments/'+a.id+'/metadata')).status,200);
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),image=await (await upload('sticker.gif',gif)).json();assert.equal(image.mime,'image/gif');
 await s.api('/api/chat/send',{requestId:crypto.randomUUID(),message:'看附件',attachments:[a.id,image.id]});await until(()=>s.fake.executions===1);const parts=JSON.parse([...s.fake.keys.values()][0].body).input[0].content;assert.match(parts[0].text,/hello/);assert.match(parts[1].image_url.url,/^data:image\/gif;base64,/);
 await s.stop();await s.start();assert.equal((await s.api('/api/chat/attachments/'+a.id)).status,200);
});
test('unknown admission older than the native retention safety window never resubmits',async t=>{
 const s=await setup(t);await s.stop();const db=new DatabaseSync(path.join(s.dir,'chat.sqlite'),{readOnly:true}),scope=db.prepare("SELECT value FROM meta WHERE key='scope'").get().value;db.close();const store=new ChatStore(s.dir,scope),id=crypto.randomUUID();store.addRequest(id,{message:'unknown old request',attachments:[],quote:null});store.db.prepare('UPDATE requests SET state=?,submitted_at=?,payload=? WHERE id=?').run('uncertain',Date.now()-7200000,JSON.stringify({message:'unknown old request',attachments:[],quote:null,transport:'unknown old request'}),id);store.close();await s.start();
 await until(async()=>{const o=await (await s.api('/api/chat/requests')).json();return o.data.some(r=>r.error==='admission_uncertain_no_resubmit');});assert.equal(s.fake.executions,0);assert.ok(s.fake.seen.every(r=>r.url!=='/v1/runs'));
});
