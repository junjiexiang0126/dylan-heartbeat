'use strict';
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const PORT=Number(process.env.PORT||3000);
const PASSWORD=process.env.ZIWEI_WEB_PASSWORD;
const SECURE=process.env.NODE_ENV==='production';
const sessions=new Map(),attempts=new Map();
const publicDir=path.join(__dirname,'public');
const baseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
function send(res,status,obj,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...baseHeaders,...extra});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let buf='';req.on('data',x=>{buf+=x;if(buf.length>8192){reject(new Error('too large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(buf||'{}'))}catch{reject(new Error('invalid json'))}});req.on('error',reject)})}
function token(req){const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('ziwei_sid='));return raw?.slice(10)}
function auth(req){const t=token(req);const s=t&&sessions.get(crypto.createHash('sha256').update(t).digest('hex'));if(!s||s.exp<Date.now())return null;return s}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return false;try{const u=new URL(origin);const host=req.headers.host;return u.host===host&&(u.protocol==='https:'||!SECURE&&u.protocol==='http:')}catch{return false}}
function hash(v,salt){return crypto.scryptSync(v,salt,32)}
function compare(a,b){const salt=Buffer.from('ziwei-web-password-v1');return crypto.timingSafeEqual(hash(a,salt),hash(b,salt))}
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest'};
http.createServer(async(req,res)=>{try{
 if(req.url==='/health')return send(res,200,{status:'ok',component:'ziwei-web-foundation'});
 if(req.url==='/api/session'&&req.method==='GET')return send(res,200,{authenticated:!!auth(req),chatReady:false});
 if(req.url==='/api/login'&&req.method==='POST'){
  if(!sameOrigin(req))return send(res,403,{error:'origin_rejected'});
  if(!PASSWORD||PASSWORD.length<16)return send(res,503,{error:'password_not_configured'});
  const ip=req.socket.remoteAddress||'unknown',rec=attempts.get(ip)||{count:0,until:0};if(rec.until>Date.now())return send(res,429,{error:'too_many_attempts'});
  const b=await body(req);const pass=typeof b.password==='string'?b.password:'';
  if(!compare(pass,PASSWORD)){rec.count++;rec.until=rec.count>=5?Date.now()+15*60*1000:0;attempts.set(ip,rec);return send(res,401,{error:'invalid_credentials'})}
  attempts.delete(ip);const t=crypto.randomBytes(32).toString('hex');sessions.set(crypto.createHash('sha256').update(t).digest('hex'),{exp:Date.now()+7*86400000});
  return send(res,200,{authenticated:true},{'Set-Cookie':'ziwei_sid='+t+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800'+(SECURE?'; Secure':'')});
 }
 if(req.url==='/api/logout'&&req.method==='POST'){if(!sameOrigin(req))return send(res,403,{error:'origin_rejected'});const t=token(req);if(t)sessions.delete(crypto.createHash('sha256').update(t).digest('hex'));return send(res,200,{ok:true},{'Set-Cookie':'ziwei_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(SECURE?'; Secure':'')})}
 if(req.url.startsWith('/api/'))return send(res,auth(req)?503:401,{error:auth(req)?'hermes_bridge_not_enabled':'unauthorized'});
 if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'method_not_allowed'});
 const file=files[req.url];if(!file)return send(res,404,{error:'not_found'});
 const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json'};
 res.writeHead(200,{'Content-Type':types[path.extname(file)],...baseHeaders});if(req.method==='HEAD')return res.end();fs.createReadStream(path.join(publicDir,file)).pipe(res);
 }catch(e){if(!res.headersSent)send(res,400,{error:'bad_request'})}
}).listen(PORT,'0.0.0.0');
