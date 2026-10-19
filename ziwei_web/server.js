'use strict';
const http = require('node:http'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const webauthn = require('@simplewebauthn/server');
const {createChatService} = require('./chat_service');
const {createMomentsService} = require('./moments_service');
const {checkedDirectory}=require('./data_directory');
const { createHomeStore, atomicWrite, load } = require('./home_store');
const PORT = Number(process.env.PORT || 3000), PASSWORD = process.env.ZIWEI_WEB_PASSWORD || '';
const SECURE = process.env.NODE_ENV === 'production';
const DATA_DIR = checkedDirectory(process.env.ZIWEI_WEB_DATA_DIR || path.join(__dirname, '.data'));
// Never use the native Agent profile as this application's business storage.
if (DATA_DIR === '/data' || DATA_DIR.startsWith('/data/hermes_native') || DATA_DIR === process.env.HERMES_HOME) throw Error('Use a dedicated Web data directory');
if (SECURE && !process.env.ZIWEI_WEB_DATA_DIR) throw Error('Production requires dedicated persistent ZIWEI_WEB_DATA_DIR');
const ORIGIN = process.env.ZIWEI_WEB_ORIGIN || '';
const originURL = ORIGIN ? new URL(ORIGIN) : null;
if (originURL && (originURL.origin !== ORIGIN || (originURL.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(originURL.hostname) && !SECURE)))) throw Error('Invalid ZIWEI_WEB_ORIGIN');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json'), AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const PASSWORD_FILE = path.join(DATA_DIR, 'password.json'), SETUP_TOKEN_FILE = path.join(DATA_DIR, 'setup-token.txt');
let pwSalt = 'ziwei-pwa-password-check-v3', pwHash = null;
try {
  const raw = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
  if (raw && typeof raw.salt === 'string' && /^[a-f0-9]{32,64}$/.test(raw.salt) && typeof raw.hash === 'string' && /^[a-f0-9]{64}$/.test(raw.hash)) { pwSalt = raw.salt; pwHash = Buffer.from(raw.hash, 'hex'); }
} catch {}
const SESSION_DAYS = 30, MAX_BODY = 400000, COOKIE = 'ziwei_sid';
const publicDir = path.join(__dirname, 'public');
const files = {'/raven-view.js':'raven-view.js','/raven.css':'raven.css','/raven-preview.html':'raven-preview.html','/raven-preview.js':'raven-preview.js','/models/raven.glb':'models/raven.glb','/models/raven-poster.png':'models/raven-poster.png','/models/raven-manifest.json':'models/raven-manifest.json','/photos.js':'photos.js','/photos.css':'photos.css','/voice-ui.js':'voice-ui.js','/paper.svg':'paper.svg','/theme-init.js':'theme-init.js','/chat-render.js':'chat-render.js','/file-viewer.js':'file-viewer.js','/refinement.css':'refinement.css','/bubble-skin.css':'bubble-skin.css','/skin-wing.svg':'skin-wing.svg','/skin-raven.svg':'skin-raven.svg','/skin-paw.svg':'skin-paw.svg','/skin-heart.svg':'skin-heart.svg','/skin-star.svg':'skin-star.svg','/tokens.css':'tokens.css','/records.js':'records.js','/records.css':'records.css','/save-file.js':'save-file.js','/impressions.js':'impressions.js','/impressions.css':'impressions.css','/records-material.css':'records-material.css','/flow-glow.css':'flow-glow.css','/EBGaramond.woff2':'EBGaramond.woff2','/home.css':'home.css','/stickers/watercolor-heart-v1.png':'stickers/watercolor-heart-v1.png','/stickers/watercolor-ribbon-v1.png':'stickers/watercolor-ribbon-v1.png','/stickers/watercolor-blossoms-v1.png':'stickers/watercolor-blossoms-v1.png','/stickers/watercolor-leaves-v1.png':'stickers/watercolor-leaves-v1.png','/stickers/books.png':'stickers/books.png','/stickers/button-flower.png':'stickers/button-flower.png','/stickers/button-plain.png':'stickers/button-plain.png','/stickers/card-frame.png':'stickers/card-frame.png','/stickers/corner-ribbon-left.png':'stickers/corner-ribbon-left.png','/stickers/corner-ribbon-right.png':'stickers/corner-ribbon-right.png','/stickers/diary.png':'stickers/diary.png','/stickers/flower-bud.png':'stickers/flower-bud.png','/stickers/flower-front.png':'stickers/flower-front.png','/stickers/flower-side.png':'stickers/flower-side.png','/stickers/lock.png':'stickers/lock.png','/stickers/paw.png':'stickers/paw.png','/stickers/petals.png':'stickers/petals.png','/stickers/sticker-sakura.svg':'stickers/sticker-sakura.svg','/stickers/sticker-rose.svg':'stickers/sticker-rose.svg','/stickers/sticker-bow.svg':'stickers/sticker-bow.svg','/stickers/photo-frame.png':'stickers/photo-frame.png','/stickers/ribbon-bow.png':'stickers/ribbon-bow.png','/stickers/ribbon-flow.png':'stickers/ribbon-flow.png','/stickers/small-flower.png':'stickers/small-flower.png','/stickers/expressions/exp6-01.png':'stickers/expressions/exp6-01.png','/stickers/expressions/exp6-02.png':'stickers/expressions/exp6-02.png','/stickers/expressions/exp6-03.png':'stickers/expressions/exp6-03.png','/stickers/expressions/exp6-04.png':'stickers/expressions/exp6-04.png','/stickers/expressions/exp6-05.png':'stickers/expressions/exp6-05.png','/stickers/expressions/exp6-06.png':'stickers/expressions/exp6-06.png','/':'index.html','/index.html':'index.html','/app.js':'app.js','/chat.js':'chat.js','/affection.js':'affection.js','/affection.css':'affection.css','/chat-extra.js':'chat-extra.js','/raven.js':'raven.js','/chat-call.js':'chat-call.js','/workbench.js':'workbench.js','/work.js':'work.js','/work.css':'work.css','/moments.js':'moments.js','/moments.css':'moments.css','/style.css':'style.css','/chat.css':'chat.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/font-preview.html':'font-preview.html','/icon-512.png':'icon-512.png'};
const types = {'.woff2':'font/woff2','.glb':'model/gltf-binary','.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.mp3':'audio/mpeg'};
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
if (SECURE) headers['Strict-Transport-Security'] = 'max-age=31536000';
if (PASSWORD && PASSWORD.length < 16) throw Error('ZIWEI_WEB_PASSWORD must be at least 16 characters');
fs.mkdirSync(DATA_DIR, {recursive:true, mode:0o700});
const LOCK_FILE=path.join(DATA_DIR,'server.lock');
// Railway restarts reuse PID namespaces: a persisted numeric PID alone is not
// proof that the old Web process is still alive. Record deployment identity too.
const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID || '';
const lockToken = crypto.randomUUID();
const lockRecord = JSON.stringify({pid:process.pid, deploymentId, token:lockToken});
if(fs.existsSync(LOCK_FILE)){
 const previous = fs.readFileSync(LOCK_FILE,'utf8');
 let lock;
 try {
   lock = previous.trim().startsWith('{') ? JSON.parse(previous) : {pid:Number(previous)};
 } catch { throw Error('invalid_server_lock'); }
 if(!Number.isSafeInteger(lock.pid)||lock.pid<1)throw Error('invalid_server_lock');
 // Never assume a PID from an older Railway deployment refers to this container.
 // Deploy overlap is disabled for this single-replica, volume-backed service.
 const sameDeployment = !deploymentId || !lock.deploymentId || lock.deploymentId===deploymentId;
 if(sameDeployment && lock.pid!==process.pid){
   try{process.kill(lock.pid,0);throw Error('Web data directory already in use');}
   catch(e){if(e.code!=='ESRCH')throw e;}
 }
 // The previous lock is stale if it names this very PID before we acquired it,
 // or belongs to a different Railway deployment.
 if(fs.readFileSync(LOCK_FILE,'utf8')!==previous)throw Error('server_lock_changed');
 fs.unlinkSync(LOCK_FILE);
}
fs.writeFileSync(LOCK_FILE,lockRecord,{flag:'wx',mode:0o600});
process.on('exit',()=>{
 try{if(fs.readFileSync(LOCK_FILE,'utf8')===lockRecord)fs.unlinkSync(LOCK_FILE);}
 catch(e){if(e.code!=='ENOENT')console.error('web_lock_cleanup_failed',e.message);}
});
// 会话号可由数据目录里的文件覆盖：切换对话时写入，容器重启后生效。
try{const f=path.join(DATA_DIR,'current-session.txt');const v=fs.readFileSync(f,'utf8').trim();if(/^[a-zA-Z0-9_-]{1,128}$/.test(v))process.env.ZIWEI_HERMES_WEB_SESSION_ID=v;}catch{}
const bridge=createChatService(DATA_DIR,{authorized:req=>!!session(req)});
const workService=require('./work_service').createWorkService(DATA_DIR);
const home = createHomeStore(DATA_DIR);
const moments = createMomentsService(DATA_DIR);
const workbench=require('./workbench').createWorkbench({bridge,moments});
const records=require('./records').createRecords();
const photos=require('./photos').createPhotos({authorized:req=>!!session(req)});
const sessions = new Map(), attempts = new Map(), challenges = new Map();
let authEpoch = 0;
const authenticating = new Set();
let passwordKey = pwHash || crypto.scryptSync(PASSWORD, pwSalt, 32);
let passwordVersion = crypto.createHash('sha256').update(passwordKey).digest('hex');
for (const [key,v] of load(SESSION_FILE, [])) {
  if (/^[a-f0-9]{64}$/.test(key) && v.exp > Date.now() && /^[a-f0-9]{64}$/.test(v.csrf) && v.passwordVersion === passwordVersion) sessions.set(key,v);
}
const auth = load(AUTH_FILE, {userID:crypto.randomBytes(32).toString('base64url'), credentials:[]});
if (!Array.isArray(auth.credentials) || typeof auth.userID !== 'string') throw Error('invalid_auth_store');
function persist() { atomicWrite(SESSION_FILE,[...sessions]); }
function prune() {
  let changed=false;
  for (const [k,v] of sessions) if (v.exp <= Date.now()) { sessions.delete(k); changed=true; }
  if (changed) persist();
  for (const [k,v] of challenges) if (v.exp <= Date.now()) challenges.delete(k);
  for (const [k,v] of attempts) if (v.expires <= Date.now()) attempts.delete(k);
}
function json(res,status,data,extra={}) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers,...extra}); res.end(JSON.stringify(data)); }
function cookies(req) { return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')).filter(v=>v.length===2)); }
function tokenHash(t) { return crypto.createHash('sha256').update(t).digest('hex'); }
function session(req) { const t=cookies(req)[COOKIE]; if (!t || !/^[a-f0-9]{64}$/.test(t)) return null; const s=sessions.get(tokenHash(t)); return s && s.exp>Date.now() ? s : null; }
function validOrigin(req) {
  if (!req.headers.origin) return false;
  try { const o=new URL(req.headers.origin); return ORIGIN ? o.origin===ORIGIN && req.headers.host===originURL.host : o.host===req.headers.host && (o.protocol==='https:' || (!SECURE && o.protocol==='http:')); } catch { return false; }
}
function csrfOk(req,s) { const t=req.headers['x-ziwei-csrf']; return typeof t==='string' && /^[a-f0-9]{64}$/.test(t) && crypto.timingSafeEqual(Buffer.from(t),Buffer.from(s.csrf)); }
function readBody(req, limit=MAX_BODY) {
  return new Promise((resolve,reject)=>{
    const chunks=[]; let size=0, tooLarge=false;
    req.on('data',x=>{size+=x.length; if(size>limit){tooLarge=true;} else chunks.push(x);});
    req.on('end',()=>{if(tooLarge)return reject(Error('body_too_large')); try{const b=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'); if(!b || typeof b!=='object' || Array.isArray(b))throw Error(); resolve(b);}catch{reject(Error('invalid_json'));}});
    req.on('error',reject);
  });
}
async function validPassword(pass) { const key=await new Promise((resolve,reject)=>crypto.scrypt(pass,pwSalt,32,(e,k)=>e?reject(e):resolve(k))); return crypto.timingSafeEqual(key,passwordKey); }
function cookie(value,age,name=COOKIE) { return name+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(SECURE?'; Secure':''); }
function rate(req,res) {
  const k=tokenHash(req.socket.remoteAddress||'unknown'), now=Date.now();
  const rec=attempts.get(k)||{count:0, until:0, expires:now+15*60*1000};
  if(rec.until>now || attempts.size>=1024 && !attempts.has(k)){json(res,429,{error:'rate_limited'});return null;}
  // Count attempted authentication before expensive hashing or verification, including concurrent requests.
  rec.count++; if(rec.count>=6)rec.until=now+15*60*1000; rec.expires=now+15*60*1000; attempts.set(k,rec); return k;
}
function issueSession(req,res,k,redirectTo) {
  if(k)attempts.delete(k);
  prune(); if(sessions.size>=128){json(res,429,{error:'too_many_sessions'});return;}
  const old=cookies(req)[COOKIE]; if(old)sessions.delete(tokenHash(old));
  const t=crypto.randomBytes(32).toString('hex'), s={exp:Date.now()+SESSION_DAYS*86400000, csrf:crypto.randomBytes(32).toString('hex'), passwordVersion};
  sessions.set(tokenHash(t),s); persist();
  const setCookies=[cookie(t,SESSION_DAYS*86400),cookie('',0,'ziwei_challenge')];
  if(redirectTo){res.writeHead(302,{...headers,Location:redirectTo,'Set-Cookie':setCookies,'Cache-Control':'no-store'});return res.end();}
  json(res,200,{authenticated:true,csrf:s.csrf},{'Set-Cookie':setCookies});
}
function setChallenge(res, options, kind, owner) {
  if(challenges.size>=128)return json(res,429,{error:'too_many_challenges'});
  const id=crypto.randomBytes(32).toString('hex');
  challenges.set(tokenHash(id),{challenge:options.challenge,kind,owner,exp:Date.now()+120000});
  json(res,200,options,{'Set-Cookie':cookie(id,120,'ziwei_challenge')});
}
function consumeChallenge(req,kind,owner) {
  const id=cookies(req).ziwei_challenge; if(!id || !/^[a-f0-9]{64}$/.test(id))throw Error('invalid_challenge');
  const k=tokenHash(id), c=challenges.get(k); challenges.delete(k);
  if(!c || c.kind!==kind || c.owner!==owner || c.exp<=Date.now())throw Error('invalid_challenge'); return c.challenge;
}
const SETUP_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>设置登录密码</title><style>
:root{color-scheme:light}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f6efea;color:#3a2f2b;
font:16px/1.7 -apple-system,"PingFang SC","Songti SC",serif;padding:24px;box-sizing:border-box}
.card{width:100%;max-width:380px;background:#fffdfb;border-radius:22px;padding:26px 22px;
box-shadow:0 18px 40px rgba(120,90,80,.14);border:1px solid #efe2da}
h1{font-size:19px;margin:0 0 6px;font-weight:600}
p{font-size:14px;color:#8a7a72;margin:0 0 18px}
input{width:100%;box-sizing:border-box;font-size:17px;padding:13px 14px;border-radius:14px;
border:1px solid #e5d5cc;background:#fff;margin-bottom:12px;outline:none}
input:focus{border-color:#c9a89a}
button{width:100%;font-size:16px;padding:14px;border:0;border-radius:14px;background:#b5846f;color:#fff;font-weight:600}
button:disabled{opacity:.55}
.hint{font-size:13px;color:#a08e86;margin-top:12px;min-height:20px}
</style></head><body><div class="card">
<h1>给这扇门配一把钥匙</h1>
<p>这是你自己的服务器。设一个只有你知道的密码，之后就用它进来。</p>
<input id="p1" type="password" placeholder="新密码（至少 8 位）" autocomplete="new-password">
<input id="p2" type="password" placeholder="再输一次" autocomplete="new-password">
<button id="go">设好了，进去</button>
<div class="hint" id="hint"></div>
</div><script>
var T="__TOKEN__";
document.getElementById('go').onclick=async function(){
  var a=document.getElementById('p1').value,b=document.getElementById('p2').value,h=document.getElementById('hint');
  if(a.length<8){h.textContent='至少 8 位';return;}
  if(a!==b){h.textContent='两次不一样';return;}
  this.disabled=true;h.textContent='正在保存…';
  try{
    var r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:T,password:a})});
    if(!r.ok){var j=await r.json().catch(function(){return{};});h.textContent='没成功：'+(j.error||r.status);this.disabled=false;return;}
    h.textContent='好了，正在进去…';location.replace('/');
  }catch(e){h.textContent='网络没通，再试一次';this.disabled=false;}
};
</script></body></html>`;

const SETUP_CLOSED_HTML = `<!doctype html><meta charset="utf-8"><title>未开放</title>
<body style="font:16px/1.8 -apple-system,sans-serif;padding:40px;color:#5a4b45">
<p>这个设置入口现在没有开放。</p><p>要重新开放，让知微在服务器上生成一个设置链接。</p></body>`;
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'), pathname=url.pathname;
  if(pathname==='/health' && req.method==='GET')return json(res,200,{status:'ok',component:'ziwei-web-foundation'});
  if(pathname==='/api/session' && req.method==='GET') { prune(); const s=session(req); return json(res,200,{authenticated:!!s,csrf:s?.csrf||null,chatReady:bridge.status(),passkeyAvailable:!!originURL,passkeyCount:s?auth.credentials.length:undefined}); }
  if(pathname==='/api/login' && req.method==='POST') {
    if(!validOrigin(req))return json(res,403,{error:'origin_rejected'});
    if(!PASSWORD)return json(res,503,{error:'password_not_configured'});
    const k=rate(req,res); if(!k)return;
    const b=await readBody(req,4096), pass=typeof b.password==='string'?b.password:'';
    if(pass.length>512)return json(res,400,{error:'invalid_input'});
    if(!await validPassword(pass))return json(res,401,{error:'invalid_credentials'});
    return issueSession(req,res,k);
  }
  if(pathname==='/enter' && req.method==='GET') {
    let tok=''; try{tok=fs.readFileSync(path.join(DATA_DIR,'enter-token.txt'),'utf8').trim();}catch{}
    const given=url.searchParams.get('t')||'';
    if(!/^[a-f0-9]{32,64}$/.test(tok) || given!==tok) {
      res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(SETUP_CLOSED_HTML);
    }
    /* 15 分钟内可重复点击：单次有效太脆，用户点两下或我用 curl 核验就会作废 */
    try{const age=(Date.now()-fs.statSync(path.join(DATA_DIR,'enter-token.txt')).mtimeMs)/1000; if(age>900){res.writeHead(410,{'Content-Type':'text/html; charset=utf-8'});return res.end(SETUP_CLOSED_HTML);}}catch{return json(res,410,{error:'enter_closed'});}
    return issueSession(req,res,null,'/');
  }
  if(pathname==='/setup' && req.method==='GET') {
    let tok=''; try{tok=fs.readFileSync(SETUP_TOKEN_FILE,'utf8').trim();}catch{}
    const loggedIn=!!session(req);
    if(!loggedIn && (!/^[a-f0-9]{32,64}$/.test(tok) || url.searchParams.get('t')!==tok)) {
      res.writeHead(404,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(SETUP_CLOSED_HTML);
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
    return res.end(SETUP_HTML.replace('__TOKEN__', loggedIn?'':tok));
  }
  if(pathname==='/api/setup' && req.method==='POST') {
    if(!validOrigin(req)){console.log('SETUP_FAILED origin', req.headers.origin, req.headers.host);return json(res,403,{error:'origin_rejected'});}
    let tok=''; try{tok=fs.readFileSync(SETUP_TOKEN_FILE,'utf8').trim();}catch{}
    const loggedIn=!!session(req);
    if(!tok && !loggedIn){console.log('SETUP_FAILED closed');return json(res,410,{error:'setup_closed'});}
    const k=rate(req,res); if(!k)return;
    const b=await readBody(req,4096);
    const given=typeof b.token==='string'?b.token:'';
    if(!loggedIn && (given.length!==tok.length || !crypto.timingSafeEqual(Buffer.from(given),Buffer.from(tok)))){console.log('SETUP_FAILED bad_token', given.length, tok&&tok.length);return json(res,403,{error:'invalid_token'});}
    const pass=typeof b.password==='string'?b.password:'';
    if(pass.length<8){console.log('SETUP_FAILED short');return json(res,400,{error:'password_too_short'});}
    if(pass.length>512)return json(res,400,{error:'invalid_input'});
    const salt=crypto.randomBytes(16).toString('hex');
    const hash=await new Promise((resolve,reject)=>crypto.scrypt(pass,salt,32,(e,k2)=>e?reject(e):resolve(k2)));
    fs.writeFileSync(PASSWORD_FILE, JSON.stringify({salt, hash:hash.toString('hex'), at:new Date().toISOString()}), {mode:0o600});
    try{fs.unlinkSync(SETUP_TOKEN_FILE);}catch{}
    console.log('SETUP_OK password set');
    pwSalt=salt; passwordKey=hash; passwordVersion=crypto.createHash('sha256').update(passwordKey).digest('hex');
    sessions.clear(); persist();
    return json(res,200,{ok:true});
  }
  if(pathname.startsWith('/api/passkey/login/') && req.method==='POST') {
    if(!validOrigin(req))return json(res,403,{error:'origin_rejected'});
    if(!originURL || !PASSWORD)return json(res,503,{error:'passkey_unavailable'});
    const k=rate(req,res); if(!k)return;
    if(pathname==='/api/passkey/login/options') {
      const options=await webauthn.generateAuthenticationOptions({rpID:originURL.hostname,userVerification:'required',allowCredentials:[]});
      return setChallenge(res,options,'login',null);
    }
    if(pathname==='/api/passkey/login/verify') {
      const epoch=authEpoch, challenge=consumeChallenge(req,'login',null), response=await readBody(req,16384);
      const credential=auth.credentials.find(c=>c.id===response.id);
      if(!credential)return json(res,401,{error:'invalid_credentials'});
      // Counter verification awaits crypto: serialize authentication per credential.
      if(authenticating.has(credential.id))return json(res,409,{error:'authentication_in_progress'});
      authenticating.add(credential.id);
      try {
        const result=await webauthn.verifyAuthenticationResponse({response,expectedChallenge:challenge,expectedOrigin:ORIGIN,expectedRPID:originURL.hostname,requireUserVerification:true,credential:{id:credential.id,publicKey:Buffer.from(credential.publicKey,'base64url'),counter:credential.counter,transports:credential.transports}});
        if(!result.verified || epoch!==authEpoch || !auth.credentials.includes(credential))return json(res,401,{error:'invalid_credentials'});
        credential.counter=result.authenticationInfo.newCounter; atomicWrite(AUTH_FILE,auth);
        return issueSession(req,res,k);
      } finally { authenticating.delete(credential.id); }
    }
    return json(res,404,{error:'not_found'});
  }
  if(pathname.startsWith('/api/')) {
    const s=session(req); if(!s)return json(res,401,{error:'unauthorized'});
    if(!['GET','HEAD'].includes(req.method) && (!validOrigin(req) || !csrfOk(req,s)))return json(res,403,{error:'csrf_rejected'});
    if(pathname==='/api/home') {
      if(req.method==='GET')return json(res,200,{...home.read(),todayStatus:await bridge.presence()});
      if(req.method==='PUT'){const body=await readBody(req);if(session(req)!==s)return json(res,401,{error:'unauthorized'});const updated=home.update(body);return json(res,updated?200:409,updated?{...updated,todayStatus:await bridge.presence()}:{error:'revision_conflict'});}
      return json(res,405,{error:'method_not_allowed'});
    }
    if(pathname==='/api/chat/session' && req.method==='POST') {
      /* 换一段对话：写新会话号，然后让进程退出、容器自动重启读新号。
         旧会话的消息仍在网关与本地库里，不删。 */
      const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
      const next='ziwei-home-web-'+stamp;
      if(!/^[a-zA-Z0-9_-]{1,128}$/.test(next))return json(res,400,{error:'invalid_session'});
      try{fs.writeFileSync(path.join(DATA_DIR,'current-session.txt'), next, {mode:0o600});}catch(e){return json(res,500,{error:'session_write_failed'});}
      json(res,200,{session:next});
      setTimeout(()=>process.exit(0), 500);
      return;
    }
    if(['/api/logout','/api/logout-all'].includes(pathname) && req.method==='POST') {
      if(pathname==='/api/logout-all'){sessions.clear();authEpoch++;}else sessions.delete(tokenHash(cookies(req)[COOKIE]));
      challenges.clear();persist(); return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
    }
    if(pathname==='/api/passkey/register/options' && req.method==='POST') {
      if(!originURL || !PASSWORD)return json(res,503,{error:'passkey_unavailable'});
      const k=rate(req,res);if(!k)return;
      const b=await readBody(req,4096); if(typeof b.password!=='string' || b.password.length>512 || !await validPassword(b.password))return json(res,401,{error:'invalid_credentials'});
      if(session(req)!==s)return json(res,401,{error:'unauthorized'});
      attempts.delete(k); if(auth.credentials.length>=10)return json(res,409,{error:'credential_limit'});
      const options=await webauthn.generateRegistrationOptions({rpName:'知微之家',rpID:originURL.hostname,userID:Buffer.from(auth.userID,'base64url'),userName:'ziwei-home-owner',attestationType:'none',supportedAlgorithmIDs:[-7,-257],excludeCredentials:auth.credentials.map(c=>({id:c.id,transports:c.transports})),authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'required',userVerification:'required'}});
      return setChallenge(res,options,'register',tokenHash(cookies(req)[COOKIE]));
    }
    if(pathname==='/api/passkey/register/verify' && req.method==='POST') {
      const epoch=authEpoch, challenge=consumeChallenge(req,'register',tokenHash(cookies(req)[COOKIE])), response=await readBody(req,16384);
      const result=await webauthn.verifyRegistrationResponse({response,expectedChallenge:challenge,expectedOrigin:ORIGIN,expectedRPID:originURL.hostname,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
      if(session(req)!==s)return json(res,401,{error:'unauthorized'});
      if(epoch!==authEpoch || !result.verified || auth.credentials.length>=10 || auth.credentials.some(c=>c.id===result.registrationInfo.credential.id))return json(res,400,{error:'registration_rejected'});
      const c=result.registrationInfo.credential;
      auth.credentials.push({id:c.id,publicKey:Buffer.from(c.publicKey).toString('base64url'),counter:c.counter,transports:c.transports,createdAt:new Date().toISOString()});
      atomicWrite(AUTH_FILE,auth);return json(res,200,{ok:true});
    }
    if(pathname==='/api/passkey/remove-all' && req.method==='POST') {
      const k=rate(req,res);if(!k)return;
      const b=await readBody(req,4096); if(typeof b.password!=='string' || b.password.length>512 || !await validPassword(b.password))return json(res,401,{error:'invalid_credentials'});
      if(session(req)!==s)return json(res,401,{error:'unauthorized'});
      attempts.delete(k);authEpoch++;auth.credentials=[];atomicWrite(AUTH_FILE,auth);challenges.clear();return json(res,200,{ok:true});
    }
    if(pathname==='/api/photos'||pathname.startsWith('/api/photos/'))return photos(req,res,url);
    if(pathname.startsWith('/api/records/'))return records(req,res,url);
    if(pathname.startsWith('/api/workbench'))return workbench(req,res,url);
    if(pathname.startsWith('/api/work/'))return workService.handle(req,res,pathname,readBody,json);
    if(pathname==='/api/moments'||pathname.startsWith('/api/moments/'))return moments.proxy(req,res,pathname,url);
    return bridge.proxy(req,res,pathname,url);
  }
  if(req.method!=='GET' && req.method!=='HEAD')return json(res,405,{error:'method_not_allowed'});
  // 课堂游戏站（知微做的，静态目录 /game/）
  if(pathname==='/game' || pathname.startsWith('/game/')){
    let rel = pathname.slice(6).replace(/^\/+/,'');
    if(rel==='') rel='index.html';
    const ext = path.extname(rel).toLowerCase();
    const allowed = ['.html','.js','.css','.png','.mp3','.svg','.json','.webmanifest','.map','.woff','.woff2'];
    if(rel.includes('..') || !allowed.includes(ext)) return json(res,404,{error:'not_found'});
    const abs = path.join(publicDir,'game',rel);
    if(!fs.existsSync(abs)) return json(res,404,{error:'not_found'});
    const gameHeaders = { ...headers, 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream',...gameHeaders});
    if(req.method==='HEAD') return res.end();
    return fs.createReadStream(abs).pipe(res);
  }
  // 自托管字体目录：/fonts/*（woff2 分片 + css），2026-10-19 加
  if(pathname.startsWith('/fonts/')){
    let rel=pathname.slice(7).replace(/^\/+/,'');
    const ext=path.extname(rel).toLowerCase();
    if(rel.includes('..')||!['.woff2','.css'].includes(ext))return json(res,404,{error:'not_found'});
    const abs=path.join(publicDir,'fonts',rel);
    if(!fs.existsSync(abs))return json(res,404,{error:'not_found'});
    res.writeHead(200,{'Content-Type':ext==='.css'?'text/css; charset=utf-8':'font/woff2',...headers});
    if(req.method==='HEAD')return res.end();
    return fs.createReadStream(abs).pipe(res);
  }
  const f=files[pathname];if(!f)return json(res,404,{error:'not_found'});
  res.writeHead(200,{'Content-Type':types[path.extname(f)],...headers});if(req.method==='HEAD')return res.end();fs.createReadStream(path.join(publicDir,f)).pipe(res);
} catch(e) { if(!res.headersSent)json(res,e.message==='body_too_large'?413:400,{error:e.message==='body_too_large'?'body_too_large':'bad_request'}); }});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(PORT,SECURE?'0.0.0.0':'127.0.0.1',()=>{
 if(process.env.ZIWEI_HERMES_PRIVATE_PROBE_HOST!==undefined)void require('./hermes_private_probe').probePrivateTransport().then(value=>console.log('WEB_PRIVATE_TRANSPORT_PROBE '+JSON.stringify(value))).catch(()=>console.log('WEB_PRIVATE_TRANSPORT_PROBE '+JSON.stringify({verified:false,modelCalls:0})));
 if(process.env.ZIWEI_WEB_VERIFY==='phase12-v1')void require('./scripts/verify_voice_output').run();
 if(process.env.ZIWEI_VOICE_ACCEPTANCE==='voice-427-v1')require('./scripts/live_voice_acceptance').run().catch(e=>console.log('VOICE_ACCEPTANCE '+JSON.stringify({passed:false,error:/^acceptance_[a-z0-9_]+$/.test(e.message)?e.message:'acceptance_failed'})));
});
