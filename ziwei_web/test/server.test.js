'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-web-test-'));const port=30000+Math.floor(Math.random()*20000),origin='http://127.0.0.1:'+port;
const env={...process.env,PORT:String(port),ZIWEI_WEB_PASSWORD:'test-password-strong-12345',ZIWEI_WEB_DATA_DIR:data,NODE_ENV:'test'};
let child;
async function request(url,opts={}){return fetch(origin+url,opts)}
async function wait(){for(let i=0;i<80;i++){try{const r=await request('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('server did not start')}
test('auth, csrf, restart persistence and protected bridge',async t=>{
 child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env,stdio:'ignore'});await wait();
 t.after(()=>{child?.kill();fs.rmSync(data,{recursive:true,force:true})});
 assert.equal((await request('/api/session').then(r=>r.json())).authenticated,false);
 assert.equal((await request('/api/unknown')).status,401);
 assert.equal((await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:env.ZIWEI_WEB_PASSWORD})})).status,403);
 const bad=await request('/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})});assert.equal(bad.status,401);
 const good=await request('/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:env.ZIWEI_WEB_PASSWORD})});
 assert.equal(good.status,200);const cookie=good.headers.get('set-cookie').split(';')[0];assert.match(good.headers.get('set-cookie'),/HttpOnly/);
 const info=await request('/api/session',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(info.authenticated,true);assert.equal(info.chatReady,false);
 assert.equal((await request('/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin}})).status,403);
 assert.equal((await request('/api/chat',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Ziwei-CSRF':info.csrf}})).status,503);
 child.kill();await new Promise(r=>child.once('exit',r));child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env,stdio:'ignore'});await wait();
 assert.equal((await request('/api/session',{headers:{Cookie:cookie}}).then(r=>r.json())).authenticated,true);
 assert.equal((await request('/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Ziwei-CSRF':info.csrf}})).status,200);
 assert.equal((await request('/api/session',{headers:{Cookie:cookie}}).then(r=>r.json())).authenticated,false);
});
