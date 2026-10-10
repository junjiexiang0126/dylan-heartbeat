'use strict';
// Restricted, opt-in bridge. Never exposes an arbitrary upstream path or an API key.
const {Readable}=require('node:stream');
const SESSION_KEY='agent:main:web:yu';
const enabled=process.env.ZIWEI_BRIDGE_ENABLED==='true';
const base=process.env.ZIWEI_HERMES_URL||'';
const secret=process.env.ZIWEI_HERMES_API_KEY||'';
const sessionId=process.env.ZIWEI_HERMES_WEB_SESSION_ID||'';
function ready(){if(!enabled)return false;if(!base||!secret||!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId))return false;try{const u=new URL(base);return (u.protocol==='https:'||process.env.ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS==='true'&&u.protocol==='http:')&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'}catch{return false}}
function status(){return ready()}
function err(res,status,code){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:code}))}
function pathForHistory(url){const n=Number(url.searchParams.get('limit')||30),offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(n)||n<1||n>100||!Number.isSafeInteger(offset)||offset<0||offset>100000)return null;return '/api/sessions/'+encodeURIComponent(sessionId)+'/messages?order=latest&limit='+n+'&offset='+offset}
async function proxy(req,res,pathname,url){
 if(!ready())return err(res,503,'hermes_bridge_not_enabled');
 let target,method='GET',body,stream=false;
 if(pathname==='/api/web/history'&&req.method==='GET'){target=pathForHistory(url);if(!target)return err(res,400,'invalid_pagination')}
 else if(pathname==='/api/web/stream'&&req.method==='POST'){
   method='POST';stream=true;let input='';try{for await(const part of req){input+=part;if(Buffer.byteLength(input)>8192)return err(res,413,'request_too_large')}}catch{return err(res,400,'invalid_body')}
   let obj;try{obj=JSON.parse(input)}catch{return err(res,400,'invalid_json')}
   if(typeof obj.message!=='string'||!obj.message.trim()||obj.message.length>4000||Object.keys(obj).some(k=>k!=='message'))return err(res,400,'invalid_message');
   target='/api/sessions/'+encodeURIComponent(sessionId)+'/chat/stream';
   body=JSON.stringify({message:obj.message});
 }else return err(res,404,'route_not_allowed');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),stream?240000:15000);
 req.on('close',()=>{if(!res.writableEnded)controller.abort()});
 try{
   const upstream=await fetch(new URL(target,base),{method,headers:{Authorization:'Bearer '+secret,'X-Hermes-Session-Key':SESSION_KEY,...(stream?{'Content-Type':'application/json',Accept:'text/event-stream'}:{Accept:'application/json'})},body,signal:controller.signal,redirect:'error'});
   if(!upstream.ok)return err(res,upstream.status===429?429:502,'upstream_unavailable');
   if(stream){
     const type=upstream.headers.get('content-type')||'';if(!type.includes('text/event-stream'))return err(res,502,'invalid_stream_type');
     res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
     if(!upstream.body){res.end();return}
     Readable.fromWeb(upstream.body).on('error',()=>res.destroy()).pipe(res);
   }else{
     const raw=await upstream.text();if(Buffer.byteLength(raw)>2*1024*1024)return err(res,502,'upstream_too_large');
     let obj;try{obj=JSON.parse(raw)}catch{return err(res,502,'invalid_upstream_json')}
     if(!Array.isArray(obj.data)||!obj.pagination)return err(res,502,'invalid_history_shape');
     res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));
   }
 }catch{if(!res.headersSent)err(res,502,'upstream_unavailable');else res.destroy()}
 finally{clearTimeout(timer)}
}
module.exports={proxy,status,pathForHistory};
