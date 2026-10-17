'use strict';
// Opt-in deployment acceptance using a public test recording only. No public endpoint,
// credentials or user history are written to logs. Durable admission is reused.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Native Node fetch ignores custom Host. http.request preserves the site's
// normal Host + Origin checks on a loopback acceptance request.
function httpFetch(url,options={}){return new Promise((resolve,reject)=>{
 const req=require('node:http').request(url,{method:options.method||'GET',headers:options.headers,timeout:30000},res=>{
  const chunks=[];let size=0;res.on('data',c=>{size+=c.length;if(size>8*1024*1024){req.destroy(Error('acceptance_response_limit'));return;}chunks.push(c);});res.on('error',reject);res.on('end',()=>{const headers=[];for(let i=0;i<res.rawHeaders.length;i+=2)headers.push([res.rawHeaders[i],res.rawHeaders[i+1]]);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});
 });req.on('timeout',()=>req.destroy(Error('acceptance_http_timeout')));req.on('error',reject);req.end(options.body);
});}
async function run(){
 if(process.env.ZIWEI_VOICE_ACCEPTANCE!=='voice-427-v1')return;
 const dir=process.env.ZIWEI_WEB_DATA_DIR,file=path.join(dir,'voice-acceptance-mandarin-v4.json');
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{requestId:crypto.randomUUID()};
 const save=()=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600});fs.renameSync(temp,file);};
 if(state.done){console.log('VOICE_ACCEPTANCE '+JSON.stringify(state.result));return;}save();
 const origin=process.env.ZIWEI_WEB_ORIGIN,base='http://127.0.0.1:'+(process.env.PORT||3000),host=new URL(origin).host;
 const login=await httpFetch(base+'/api/login',{method:'POST',headers:{Host:host,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ZIWEI_WEB_PASSWORD})});
 if(!login.ok){const reason=await login.json().catch(()=>({}));throw Error('acceptance_login_'+login.status+'_'+(/^[a-z_]+$/.test(reason.error)?reason.error:'rejected'));}
 const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).filter(v=>!v.endsWith('=')).join('; '),csrf=(await login.json()).csrf;
 const headers={Host:host,Cookie:cookie,Origin:origin,'X-Ziwei-CSRF':csrf};
 const api=async(route,body,extra={})=>{const r=await httpFetch(base+route,{headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...extra.headers},...(body?{method:'POST',body:JSON.stringify(body)}:{}),...extra});if(!r.ok)throw Error('acceptance_http_'+r.status);return r;};
 try{
  const status=await (await api('/api/chat/status')).json();if(!status.connected||!status.voiceConfigured)throw Error('acceptance_not_connected');
  if(!state.attachmentId){
   // Public human Mandarin speech. The text prompt never supplies its words.
   const bytes=fs.readFileSync('/opt/voice-acceptance.wav');state.fixtureLanguage='zh-CN';state.fixtureSource='SpeechBrain/asr-transformer-aishell/example_mandarin.wav';state.audioHash=crypto.createHash('sha256').update(bytes).digest('hex');
   if(state.audioHash!=='bc86e7fd26157eaf3357850c85b4c5f6578e7ab5ed5e08eb791c5001ad64bd4a')throw Error('acceptance_fixture_hash');
   const r=await httpFetch(base+'/api/chat/attachments',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Filename':'voice-integration-mandarin.wav'},body:bytes});if(!r.ok)throw Error('acceptance_upload_failed');state.attachmentId=(await r.json()).id;save();
  }
  const playback=await api('/api/chat/attachments/'+state.attachmentId,null,{headers:{...headers,Range:'bytes=0-43'}});if(playback.status!==206||!playback.headers.get('content-type')?.startsWith('audio/')||(await playback.arrayBuffer()).byteLength!==44)throw Error('acceptance_playback_failed');
  const admitted=await (await api('/api/chat/send',{requestId:state.requestId,message:'语音接入验收：这是一条自动测试消息，请逐字复述录音内容，只输出听到的那句话。',attachments:[state.attachmentId]})).json();
  if(!['queued','dispatching','running','recovering','completed'].includes(admitted.state))throw Error('acceptance_admission_'+admitted.state);
  const end=Date.now()+240000;
  while(Date.now()<end){
   const data=(await (await api('/api/chat/messages?limit=100')).json()).data,own=data.find(m=>m.id==='user-'+state.requestId),reply=data.find(m=>m.id==='reply-'+state.requestId);
   if(own&&['failed','cancelled','interrupted'].includes(own.status))throw Error('acceptance_run_'+own.status);
   if(reply){
    if(!/他[应應][该該]也是(?:喜欢|喜歡)/.test(reply.content)){const db=new (require('node:sqlite').DatabaseSync)(path.join(dir,'chat.sqlite'),{readOnly:true}),row=db.prepare('SELECT payload,run_id FROM requests WHERE id=?').get(state.requestId);db.close();console.log('VOICE_ACCEPTANCE_DIAGNOSTIC '+JSON.stringify({requestId:state.requestId,nativeRunId:row?.run_id,fixtureInput:String(JSON.parse(row.payload).transport).slice(0,600),fixtureReply:reply.content.slice(0,400)}));throw Error('acceptance_voice_challenge_mismatch');}
    const replay=await (await api('/api/chat/send',{requestId:state.requestId,message:'语音接入验收：这是一条自动测试消息，请逐字复述录音内容，只输出听到的那句话。',attachments:[state.attachmentId]})).json();if(!replay.replayed)throw Error('acceptance_idempotency_failed');
    const db=new (require('node:sqlite').DatabaseSync)(path.join(dir,'chat.sqlite'),{readOnly:true}),nativeRunId=db.prepare('SELECT run_id FROM requests WHERE id=?').get(state.requestId)?.run_id;db.close();if(!nativeRunId)throw Error('acceptance_missing_native_run');
    state.done=true;state.result={passed:true,requestId:state.requestId,attachmentId:state.attachmentId,nativeRunId,fixtureLanguage:state.fixtureLanguage,fixtureSource:state.fixtureSource,connected:true,voiceConfigured:true,privateAudioRange:true,realReplyMatchesMandarinFixture:true,replayed:true,completedAt:new Date().toISOString()};save();console.log('VOICE_ACCEPTANCE '+JSON.stringify(state.result));return;
   }
   await sleep(1500);
  }
  throw Error('acceptance_timeout');
 }finally{await api('/api/logout',{}).catch(()=>{});}
}
module.exports={run};
