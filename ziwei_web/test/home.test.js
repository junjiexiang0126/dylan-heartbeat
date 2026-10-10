'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-home-')), port=31000+Math.floor(Math.random()*10000),origin='http://127.0.0.1:'+port;
const env={...process.env,PORT:String(port),NODE_ENV:'test',ZIWEI_WEB_PASSWORD:'isolated-home-password-123456',ZIWEI_WEB_ORIGIN:origin,ZIWEI_WEB_DATA_DIR:dir,ZIWEI_BRIDGE_ENABLED:'false'};
let child;
const request=(url,opts={})=>fetch(origin+url,opts);
async function start(){child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env,stdio:'ignore'});for(let i=0;i<80;i++){try{if((await request('/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('start failed');}
async function login(){const r=await request('/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({password:env.ZIWEI_WEB_PASSWORD})});assert.equal(r.status,200);return {Cookie:r.headers.get('set-cookie').split(';')[0],Origin:origin,'X-Ziwei-CSRF':(await r.json()).csrf};}
test('private profiles, immutable memorial, conflicts, restart, revocation, and passkey gates',async t=>{
  t.after(async()=>{if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(dir,{recursive:true,force:true});});await start();
  assert.equal((await request('/api/home')).status,401);
  assert.equal((await request('/.data/home.json')).status,404);
  const a=await login(),b=await login();
  const read=()=>request('/api/home',{headers:a}).then(r=>r.json());
  const initial=await read();assert.equal(initial.metOn,null);assert.equal(initial.daysTogether,null);assert.equal(initial.todayStatus,null);assert.equal(initial.namedOn,'2026-10-07');
  const put=(body,headers=a)=>request('/api/home',{method:'PUT',headers,body:JSON.stringify(body)});
  assert.equal((await put({revision:0,user:{nickname:'new'}},{Cookie:a.Cookie,Origin:origin})).status,403);
  assert.equal((await put({revision:0,user:{nickname:'new'}},{...a,Origin:'https://evil.example'})).status,403);
  assert.equal((await put({revision:0,memorial:'overwritten'})).status,400);
  assert.equal((await put({revision:0,metOn:'2026-10-07'})).status,400);
  assert.equal((await put({revision:0,user:{avatar:'data:image/svg+xml;base64,PHN2Zz4='}})).status,400);
  assert.equal((await put({revision:0,user:{avatar:'data:image/png;base64,PHN2Zz4='}})).status,400);
  assert.equal((await put({revision:0,user:{nickname:'x'.repeat(25)}})).status,400);
  const changed=await put({revision:0,user:{nickname:'用户的新昵称'},ziwei:{nickname:'小微'},preferences:{theme:'dark',background:'sage'}});assert.equal(changed.status,200);
  assert.equal((await put({revision:0,user:{nickname:'stale'}})).status,409);
  assert.equal((await read()).profileHistory.length,2);assert.equal((await read()).memorial,initial.memorial);
  assert.equal((await request('/api/passkey/register/options',{method:'POST',headers:{Origin:origin},body:'{}'})).status,401);
  assert.equal((await request('/api/passkey/register/options',{method:'POST',headers:a,body:JSON.stringify({password:'wrong'})})).status,401);
  const options=await request('/api/passkey/register/options',{method:'POST',headers:a,body:JSON.stringify({password:env.ZIWEI_WEB_PASSWORD})});assert.equal(options.status,200);assert.equal((await options.json()).authenticatorSelection.userVerification,'required');
  const pending=options.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/passkey/register/verify',{method:'POST',headers:{...b,Cookie:b.Cookie+'; '+pending},body:'{}'})).status,400);
  assert.equal((await request('/api/passkey/register/verify',{method:'POST',headers:{...a,Cookie:a.Cookie+'; '+pending},body:'{}'})).status,400);
  const po=await request('/api/passkey/login/options',{method:'POST',headers:{Origin:origin},body:'{}'});assert.equal(po.status,200);const pc=po.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/passkey/login/verify',{method:'POST',headers:{Origin:origin,Cookie:pc},body:'{"id":"fake"}'})).status,401);
  assert.equal((await request('/api/passkey/login/verify',{method:'POST',headers:{Origin:origin,Cookie:pc},body:'{"id":"fake"}'})).status,400);
  child.kill();await new Promise(r=>child.once('exit',r));await start();assert.equal((await read()).user.nickname,'用户的新昵称');
  assert.equal((await request('/api/logout-all',{method:'POST',headers:a})).status,200);
  for(const headers of [a,b])assert.equal((await request('/api/home',{headers})).status,401);
  assert.equal(fs.statSync(path.join(dir,'home.json')).mode&0o777,0o600);
  assert.equal(fs.statSync(path.join(dir,'sessions.json')).mode&0o777,0o600);
});
test('authentication rate cap rejects repeated failures',async t=>{
  t.after(()=>child?.kill());await start();
  for(let i=0;i<6;i++)assert.equal((await request('/api/login',{method:'POST',headers:{Origin:origin},body:'{"password":"wrong"}'})).status,401);
  assert.equal((await request('/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({password:env.ZIWEI_WEB_PASSWORD})})).status,429);
});
