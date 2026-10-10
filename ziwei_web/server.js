'use strict';
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const PORT=Number(process.env.PORT||3000),PASSWORD=process.env.ZIWEI_WEB_PASSWORD||'';
const SECURE=process.env.NODE_ENV==='production';
const DATA_DIR=process.env.ZIWEI_WEB_DATA_DIR||path.join(__dirname,'.data');
const SESSION_FILE=path.join(DATA_DIR,'sessions.json');
const SESSION_DAYS=7,MAX_BODY=4096,COOKIE='ziwei_sid';
const publicDir=path.join(__dirname,'public');
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
if(PASSWORD&&PASSWORD.length<16)throw new Error('ZIWEI_WEB_PASSWORD must be at least 16 characters');
if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
const sessions=new Map(),attempts=new Map();
try{const disk=JSON.parse(fs.readFileSync(SESSION_FILE,'utf8'));if(!Array.isArray(disk))throw Error('bad session format');for(const [key,v] of disk){if(/^[a-f0-9]{64}$/.test(key)&&v.exp>Date.now()&&typeof v.csrf==='string')sessions.set(key,v)}}catch(e){if(e.code!=='ENOENT')throw e}
function persist(){const tmp=SESSION_FILE+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...sessions]),{mode:0o600,flag:'wx'});fs.renameSync(tmp,SESSION_FILE)}
function prune(){let changed=false;for(const [k,v] of sessions){if(v.exp<Date.now()){sessions.delete(k);changed=true}}if(changed)persist()}
function json(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers,...extra});res.end(JSON.stringify(data))}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')).filter(v=>v.length===2))}
function tokenHash(t){return crypto.createHash('sha256').update(t).digest('hex')}
function session(req){const t=cookies(req)[COOKIE];if(!t||!/^[a-f0-9]{64}$/.test(t))return null;const s=sessions.get(tokenHash(t));return s&&s.exp>Date.now()?s:null}
function validOrigin(req){const origin=req.headers.origin;if(!origin)return false;try{const o=new URL(origin);return o.host===req.headers.host&&(o.protocol==='https:'||(!SECURE&&o.protocol==='http:'))}catch{return false}}
function csrfOk(req,s){const t=req.headers['x-ziwei-csrf'];return typeof t==='string'&&/^[a-f0-9]{64}$/.test(t)&&crypto.timingSafeEqual(Buffer.from(t),Buffer.from(s.csrf))}
function readBody(req){return new Promise((resolve,reject)=>{let buf='';req.on('data',x=>{buf+=x;if(buf.length>MAX_BODY){reject(Error('body_too_large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(buf||'{}'))}catch{reject(Error('invalid_json'))}});req.on('error',reject)})}
const passwordSalt=Buffer.from('ziwei-pwa-password-check-v2');
function validPassword(pass){const a=crypto.scryptSync(pass,passwordSalt,32),b=crypto.scryptSync(PASSWORD,passwordSalt,32);return crypto.timingSafeEqual(a,b)}
function cookie(value,age){return COOKIE+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(SECURE?'; Secure':'')}
function failureKey(req){return crypto.createHash('sha256').update(req.socket.remoteAddress||'unknown').digest('hex')}
const server=http.createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/health'&&req.method==='GET')return json(res,200,{status:'ok',component:'ziwei-web-foundation'});
 if(pathname==='/api/session'&&req.method==='GET'){prune();const s=session(req);return json(res,200,{authenticated:!!s,csrf:s?.csrf||null,chatReady:false})}
 if(pathname==='/api/login'&&req.method==='POST'){
  if(!validOrigin(req))return json(res,403,{error:'origin_rejected'});
  if(!PASSWORD)return json(res,503,{error:'password_not_configured'});
  const k=failureKey(req),rec=attempts.get(k)||{count:0,until:0};if(rec.until>Date.now())return json(res,429,{error:'rate_limited'});
  const body=await readBody(req),pass=typeof body.password==='string'?body.password:'';
  if(pass.length>512)return json(res,400,{error:'invalid_input'});
  if(!validPassword(pass)){rec.count++;rec.until=rec.count>=5?Date.now()+15*60*1000:0;attempts.set(k,rec);return json(res,401,{error:'invalid_credentials'})}
  attempts.delete(k);const t=crypto.randomBytes(32).toString('hex'),s={exp:Date.now()+SESSION_DAYS*86400000,csrf:crypto.randomBytes(32).toString('hex')};sessions.set(tokenHash(t),s);persist();
  return json(res,200,{authenticated:true,csrf:s.csrf},{'Set-Cookie':cookie(t,SESSION_DAYS*86400)});
 }
 if(pathname==='/api/logout'&&req.method==='POST'){
  const s=session(req);if(!s)return json(res,401,{error:'unauthorized'});
  if(!validOrigin(req)||!csrfOk(req,s))return json(res,403,{error:'csrf_rejected'});
  sessions.delete(tokenHash(cookies(req)[COOKIE]));persist();return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
 }
 if(pathname.startsWith('/api/')){const s=session(req);if(!s)return json(res,401,{error:'unauthorized'});if(req.method!=='GET'&&(!validOrigin(req)||!csrfOk(req,s)))return json(res,403,{error:'csrf_rejected'});return json(res,503,{error:'hermes_bridge_not_enabled'})}
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'method_not_allowed'});
 const f=files[pathname];if(!f)return json(res,404,{error:'not_found'});
 res.writeHead(200,{'Content-Type':types[path.extname(f)],...headers});if(req.method==='HEAD')return res.end();fs.createReadStream(path.join(publicDir,f)).pipe(res);
 }catch(e){if(!res.headersSent)json(res,400,{error:'bad_request'})}});
server.listen(PORT,'0.0.0.0');
