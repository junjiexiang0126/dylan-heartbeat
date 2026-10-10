'use strict';
const http = require('node:http'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const webauthn = require('@simplewebauthn/server');
const bridge = require('./bridge');
const { createHomeStore, atomicWrite, load } = require('./home_store');
const PORT = Number(process.env.PORT || 3000), PASSWORD = process.env.ZIWEI_WEB_PASSWORD || '';
const SECURE = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(process.env.ZIWEI_WEB_DATA_DIR || path.join(__dirname, '.data'));
// Never use the native Agent profile as this application's business storage.
if (DATA_DIR === '/data' || DATA_DIR.startsWith('/data/hermes_native') || DATA_DIR === process.env.HERMES_HOME) throw Error('Use a dedicated Web data directory');
if (SECURE && !process.env.ZIWEI_WEB_DATA_DIR) throw Error('Production requires dedicated persistent ZIWEI_WEB_DATA_DIR');
const ORIGIN = process.env.ZIWEI_WEB_ORIGIN || '';
const originURL = ORIGIN ? new URL(ORIGIN) : null;
if (originURL && (originURL.origin !== ORIGIN || (originURL.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(originURL.hostname) && !SECURE)))) throw Error('Invalid ZIWEI_WEB_ORIGIN');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json'), AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_DAYS = 30, MAX_BODY = 400000, COOKIE = 'ziwei_sid';
const publicDir = path.join(__dirname, 'public');
const files = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png'};
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
if (SECURE) headers['Strict-Transport-Security'] = 'max-age=31536000';
if (PASSWORD && PASSWORD.length < 16) throw Error('ZIWEI_WEB_PASSWORD must be at least 16 characters');
fs.mkdirSync(DATA_DIR, {recursive:true, mode:0o700});
const home = createHomeStore(DATA_DIR);
const sessions = new Map(), attempts = new Map(), challenges = new Map();
let authEpoch = 0;
const authenticating = new Set();
const passwordKey = crypto.scryptSync(PASSWORD, 'ziwei-pwa-password-check-v3', 32);
const passwordVersion = crypto.createHash('sha256').update(passwordKey).digest('hex');
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
async function validPassword(pass) { const key=await new Promise((resolve,reject)=>crypto.scrypt(pass,'ziwei-pwa-password-check-v3',32,(e,k)=>e?reject(e):resolve(k))); return crypto.timingSafeEqual(key,passwordKey); }
function cookie(value,age,name=COOKIE) { return name+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(SECURE?'; Secure':''); }
function rate(req,res) {
  const k=tokenHash(req.socket.remoteAddress||'unknown'), now=Date.now();
  const rec=attempts.get(k)||{count:0, until:0, expires:now+15*60*1000};
  if(rec.until>now || attempts.size>=1024 && !attempts.has(k)){json(res,429,{error:'rate_limited'});return null;}
  // Count attempted authentication before expensive hashing or verification, including concurrent requests.
  rec.count++; if(rec.count>=6)rec.until=now+15*60*1000; rec.expires=now+15*60*1000; attempts.set(k,rec); return k;
}
function issueSession(req,res,k) {
  if(k)attempts.delete(k);
  prune(); if(sessions.size>=128){json(res,429,{error:'too_many_sessions'});return;}
  const old=cookies(req)[COOKIE]; if(old)sessions.delete(tokenHash(old));
  const t=crypto.randomBytes(32).toString('hex'), s={exp:Date.now()+SESSION_DAYS*86400000, csrf:crypto.randomBytes(32).toString('hex'), passwordVersion};
  sessions.set(tokenHash(t),s); persist();
  json(res,200,{authenticated:true,csrf:s.csrf},{'Set-Cookie':[cookie(t,SESSION_DAYS*86400),cookie('',0,'ziwei_challenge')]});
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
    if(req.method!=='GET' && (!validOrigin(req) || !csrfOk(req,s)))return json(res,403,{error:'csrf_rejected'});
    if(pathname==='/api/home') {
      if(req.method==='GET')return json(res,200,home.read());
      if(req.method==='PUT'){const body=await readBody(req);if(session(req)!==s)return json(res,401,{error:'unauthorized'});const updated=home.update(body);return json(res,updated?200:409,updated||{error:'revision_conflict'});}
      return json(res,405,{error:'method_not_allowed'});
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
    return bridge.proxy(req,res,pathname,url);
  }
  if(req.method!=='GET' && req.method!=='HEAD')return json(res,405,{error:'method_not_allowed'});
  const f=files[pathname];if(!f)return json(res,404,{error:'not_found'});
  res.writeHead(200,{'Content-Type':types[path.extname(f)],...headers});if(req.method==='HEAD')return res.end();fs.createReadStream(path.join(publicDir,f)).pipe(res);
} catch(e) { if(!res.headersSent)json(res,e.message==='body_too_large'?413:400,{error:e.message==='body_too_large'?'body_too_large':'bad_request'}); }});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(PORT,'0.0.0.0');
