'use strict';
const {test:base,expect}=require('@playwright/test');
const {spawn,execFileSync}=require('node:child_process');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path'),http=require('node:http'),https=require('node:https');
const {once}=require('node:events');

// Each test gets a real, empty application store. Browser contexts alone do
// not isolate the server's persisted profile, messages, passkeys or Moments.
const test=base.extend({
 _isolatedApp:[async({},use)=>{
  const root=mkdtempSync(path.join(tmpdir(),'ziwei-browser-'));
  let child,proxy,output='';
  try{
   execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(root,'key.pem'),'-out',path.join(root,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
   child=spawn(process.execPath,['scripts/e2e_server.js'],{cwd:path.resolve(__dirname,'../..'),detached:true,env:{...process.env,PORT:'3188',NODE_ENV:'test',ZIWEI_WEB_PASSWORD:'isolated-e2e-password-123456',ZIWEI_WEB_ORIGIN:'https://localhost:3187',ZIWEI_WEB_DATA_DIR:path.join(root,'data'),ZIWEI_BRIDGE_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
   for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output=(output+b).slice(-6000);});
   let ready=false;
   for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Isolated Web exited: '+output);
    try{const r=await fetch('http://127.0.0.1:3188/health',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,50));
   }
   if(!ready)throw Error('Isolated Web startup timed out: '+output);
   // HTTPS is required to exercise WebKit's actual secure-context media and
   // credential APIs. This proxy and certificate exist only inside the test.
   proxy=https.createServer({key:readFileSync(path.join(root,'key.pem')),cert:readFileSync(path.join(root,'cert.pem'))},(req,res)=>{
    const upstream=http.request({host:'127.0.0.1',port:3188,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    res.on('close',()=>upstream.destroy());req.pipe(upstream);
   });
   proxy.listen(3187,'127.0.0.1');await once(proxy,'listening');
   await use();
  }finally{
   if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
   if(child&&child.exitCode===null){const closed=once(child,'close');try{process.kill(-child.pid,'SIGTERM');}catch{}await Promise.race([closed,new Promise(r=>setTimeout(r,2000))]);if(child.exitCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}}
   rmSync(root,{recursive:true,force:true});
  }
 },{auto:true}],
});
module.exports={test,expect};
