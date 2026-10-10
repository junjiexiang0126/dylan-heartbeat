'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-bridge-'));let child,upstream;
async function listen(s){await new Promise(r=>s.listen(0,'127.0.0.1',r));return s.address().port}
async function wait(url){for(let i=0;i<60;i++){try{const r=await fetch(url+'/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('timeout')}
test('bridge only permits authenticated, CSRF-protected, pinned session paths',async t=>{
 const seen=[];upstream=http.createServer(async(req,res)=>{seen.push({url:req.url,method:req.method,auth:req.headers.authorization,session:req.headers['x-hermes-session-key']});if(req.url.endsWith('/chat/stream')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: {"type":"test"}\n\ndata: [DONE]\n\n')}else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({object:'list',data:[],pagination:{limit:2,offset:0,order:'latest',returned:0}}))}});
 const upstreamPort=await listen(upstream),port=await (async()=>{const s=http.createServer();const p=await listen(s);await new Promise(r=>s.close(r));return p})();
 const origin='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'test',ZIWEI_WEB_PASSWORD:'testing-password-123456',ZIWEI_WEB_DATA_DIR:tmp,ZIWEI_BRIDGE_ENABLED:'true',ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS:'true',ZIWEI_HERMES_URL:'http://127.0.0.1:'+upstreamPort+'/',ZIWEI_HERMES_API_KEY:'mock-key-not-a-real-secret',ZIWEI_HERMES_WEB_SESSION_ID:'isolated-test-session'},stdio:'ignore'});
 t.after(async()=>{child.kill();await new Promise(r=>upstream.close(r));fs.rmSync(tmp,{recursive:true,force:true})});
 await wait(origin);
 assert.equal((await fetch(origin+'/api/web/history')).status,401);
 const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'testing-password-123456'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
 const headers={Cookie:cookie,Origin:origin,'X-Ziwei-CSRF':csrf,'Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/api/web/stream',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({message:'hi'})})).status,403);
 assert.equal((await fetch(origin+'/api/web/history?order=latest&limit=999',{headers:{Cookie:cookie}})).status,400);
 assert.equal((await fetch(origin+'/api/admin/jobs',{headers:{Cookie:cookie}})).status,404);
 const history=await fetch(origin+'/api/web/history?limit=2',{headers:{Cookie:cookie}});assert.equal(history.status,200);assert.equal((await history.json()).pagination.order,'latest');
 const stream=await fetch(origin+'/api/web/stream',{method:'POST',headers,body:JSON.stringify({message:'test'})});assert.equal(stream.status,200);assert.match(await stream.text(),/data: \[DONE\]/);
 assert.equal(seen.length,2);assert.equal(seen[0].url,'/api/sessions/isolated-test-session/messages?order=latest&limit=2&offset=0');assert.equal(seen[1].url,'/api/sessions/isolated-test-session/chat/stream');assert.equal(seen[1].auth,'Bearer mock-key-not-a-real-secret');assert.equal(seen[1].session,'agent:main:web:yu');
});
