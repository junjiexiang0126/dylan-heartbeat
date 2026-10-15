'use strict';
// Half-duplex voice turns using the same private, durable chat requests.
window.ZiweiChatCall=(()=>{
 const $=s=>document.querySelector(s),audio=$('#chatCallAudio');let api=null,stopVoice=null,refresh=null,epoch=0,active=false,stream=null,context=null,analyser=null,recorder=null,tick=null,timeout=null,urls=[],round=0,started=0;
 const state=text=>$('#chatCallState').textContent=text;
 function configure(deps){api=deps.request;stopVoice=deps.stopVoice;refresh=deps.load;}
 function end(close=true){epoch++;active=false;clearInterval(tick);clearTimeout(timeout);tick=timeout=null;const old=recorder;recorder=null;try{if(old?.state==='recording')old.stop();}catch{}stream?.getTracks().forEach(t=>t.stop());stream=null;context?.close().catch(()=>{});context=null;analyser=null;audio.pause();audio.removeAttribute('src');for(const url of urls)URL.revokeObjectURL(url);urls=[];$('#chatCallStart').disabled=false;$('#chatCallRetry').hidden=true;if(close&&$('#chatCallDialog').open){$('#chatCallDialog').close();void window.ZiweiChatExtra?.approvals().catch(()=>{});}}
 function listen(v){
  if(!active||v!==epoch)return;if(round>=20||Date.now()-started>15*60000){state('已达到本次通话时长或轮次上限。');end(false);return;}
  state('正在听你说…');$('#chatCallRetry').hidden=true;
  const mime=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t)),r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];let voiced=0,lastVoice=0,bytes=0;const began=Date.now();recorder=r;
  const valid=()=>active&&v===epoch;
  r.ondataavailable=e=>{if(valid()&&e.data.size){bytes+=e.data.size;if(bytes>20*1024*1024){state('录音超过大小上限，请重新开始。');end(false);return;}chunks.push(e.data);}};
  r.onerror=()=>{if(valid()){state('录音中断，请重新开始通话。');end(false);}};
  r.onstop=()=>{clearInterval(tick);tick=null;if(!valid())return;recorder=null;if(voiced<250){listen(v);return;}const type=r.mimeType||mime||'audio/webm',blob=new Blob(chunks,{type});void turn(blob,type,v);};
  const data=new Float32Array(analyser.fftSize);r.start(250);tick=setInterval(()=>{
   if(!valid())return;analyser.getFloatTimeDomainData(data);let power=0;for(const x of data)power+=x*x;const now=Date.now();
   if(Math.sqrt(power/data.length)>.025){voiced+=100;lastVoice=now;}
   if((voiced>=250&&now-lastVoice>1100||now-began>=30000)&&r.state==='recording')r.stop();
  },100);
 }
 async function turn(blob,type,v){
  const valid=()=>active&&v===epoch;round++;state('已听到，正在发送语音…');
  try{
   const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'weba',a=await api('/api/chat/attachments','POST',null,{headers:{'X-Filename':encodeURIComponent('call-'+crypto.randomUUID()+'.'+ext),'Content-Type':'application/octet-stream'},body:blob});if(!valid())return;
   const id=crypto.randomUUID();await api('/api/chat/send','POST',{requestId:id,message:'',attachments:[a.id]});if(!valid())return;state('等待知微回应…');void refresh().catch(()=>{});
   let done;const deadline=Date.now()+6*60000;
   while(valid()&&Date.now()<deadline){const o=await api('/api/chat/requests/'+id);if(!valid())return;if(['completed','failed','cancelled','interrupted'].includes(o.state)){done=o;break;}await new Promise(resolve=>{timeout=setTimeout(resolve,1000);});}
   if(!valid())return;if(!done||done.state!=='completed')throw Error('本轮回复未完成，原录音已保存在聊天记录中。');
   void refresh().catch(()=>{});const rows=await api('/api/chat/messages?limit=20'),message=rows.data.find(m=>m.id==='reply-'+id);if(!message)throw Error('回复尚未加载，请在聊天记录中查看。');
   let attachment=null;for(const file of message.attachments){const info=await api('/api/chat/attachments/'+file+'/metadata');if(info.mime.startsWith('audio/')){attachment=info;break;}}
   if(!attachment){state('知微已回复，正在生成回复语音…');attachment=await api('/api/chat/speech','POST',{messageId:message.id});}if(!valid())return;
   audio.src='/api/chat/attachments/'+attachment.id;state('知微正在说话…');audio.onended=()=>{if(valid())listen(v);};audio.onerror=()=>{if(valid()){state('回复语音读取失败，可点按钮重试播放。');$('#chatCallRetry').hidden=false;}};
   try{await audio.play();}catch{if(valid()){state('浏览器需要你点一下，才能播放知微的回复。');$('#chatCallRetry').hidden=false;}}
  }catch(e){if(valid()){state(e.message||'本轮通话未完成，请在聊天记录中核对。');end(false);}}
 }
 async function begin(){
  if(active||!api)return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder||!(window.AudioContext||window.webkitAudioContext)){state('当前浏览器不支持语音通话，请使用支持录音的 Safari 或 Chrome。');return;}
  stopVoice();end(false);active=true;const v=epoch;round=0;started=Date.now();$('#chatCallStart').disabled=true;state('正在连接麦克风…');
  try{
   context=new (window.AudioContext||window.webkitAudioContext)();await context.resume();if(!active||v!==epoch)return;
   const bytes=new Uint8Array(46),view=new DataView(bytes.buffer);for(const [offset,text] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);view.setUint32(4,38,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,2,true);const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));urls.push(url);audio.src=url;void audio.play().catch(()=>{});
   const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!active||v!==epoch){mic.getTracks().forEach(t=>t.stop());return;}stream=mic;analyser=context.createAnalyser();analyser.fftSize=1024;context.createMediaStreamSource(stream).connect(analyser);listen(v);
  }catch(e){if(active&&v===epoch){state(e.name==='NotAllowedError'?'未获得麦克风权限。':'无法开始通话，请检查麦克风。');end(false);}}
 }
 $('#chatCall').onclick=()=>{if(!$('#chatCallDialog').open){state('轮流语音交流；知微的文字回复会通过语音合成播放。');$('#chatCallDialog').showModal();void window.ZiweiChatExtra?.approvals().catch(()=>{});}};
 $('#chatCallStart').onclick=begin;$('#chatCallEnd').onclick=()=>end();$('#chatCallDialog').addEventListener('cancel',()=>end(false));$('#chatCallDialog').addEventListener('close',()=>{if(active)end(false);});
 $('#chatCallRetry').onclick=()=>{audio.load();void audio.play().then(()=>{$('#chatCallRetry').hidden=true;state('知微正在说话…');}).catch(()=>state('仍无法播放，可以结束通话后在聊天记录中重试。'));};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)end();});window.addEventListener('pagehide',()=>end());
 return {configure,end};
})();
