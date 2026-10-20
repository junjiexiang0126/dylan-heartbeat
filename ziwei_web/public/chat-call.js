'use strict';
// Continuous call screen over the existing half-duplex, durable chat requests.
window.ZiweiChatCall=(()=>{
 const $=s=>document.querySelector(s),dialog=$('#chatCallDialog');
 let audio=$('#chatCallAudio'),api=null,stopVoice=null,refresh=null,sendVoice=null,ready=null;
 let opening=false;
 let epoch=0,active=false,muted=false,phase='idle',stream=null,context=null,analyser=null,outputAnalyser=null,recorder=null;
 let tick=null,timeout=null,waitResolve=null,clock=null,frame=null,urls=[],round=0,started=0,peerName='知微';
 const bars=Array.from({length:27},()=>{const bar=document.createElement('i');$('#chatCallWave').append(bar);return bar;});
 function state(text,next){$('#chatCallState').textContent=text;if(next){phase=next;dialog.dataset.phase=next;}}
 function setProfile(profile){
  peerName=profile?.nickname||'知微';$('#chatCallName').textContent=peerName;
  const avatar=$('#chatCallAvatar');avatar.replaceChildren();avatar.setAttribute('aria-label',peerName+'的头像');
  if(profile?.avatar){const img=document.createElement('img');img.src=profile.avatar;img.alt='';avatar.append(img);}else avatar.textContent=[...peerName][0]||'微';
 }
 function silence(){for(const bar of bars)bar.style.height='4px';$('#chatCallPortrait').style.setProperty('--voice-level','0');$('#chatCallWave').dataset.level='0';}
 function microphoneUI(){
  $('#chatCallMute').disabled=!active;$('#chatCallMute').setAttribute('aria-pressed',String(muted));$('#chatCallMute').setAttribute('aria-label',muted?'取消麦克风静音':'静音麦克风');$('#chatCallMuteLabel').textContent=muted?'取消静音':'静音';
  $('#chatCallMicStatus').textContent=!stream?'麦克风未开启':muted?'麦克风已静音':'麦克风已开启';
 }
 function elapsed(){const seconds=Math.max(0,Math.floor((Date.now()-started)/1000));$('#chatCallElapsed').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
 function monitor(v){
  const samples=new Float32Array(1024),frequencies=new Uint8Array(512);
  function paint(){
   if(!active||v!==epoch)return;
   const input=phase==='listening'&&!muted?analyser:phase==='speaking'&&!audio.paused&&!audio.ended?outputAnalyser:null;
   let level=0;
   if(input){
    input.getFloatTimeDomainData(samples);input.getByteFrequencyData(frequencies);let power=0;for(const x of samples)power+=x*x;const rms=Math.sqrt(power/samples.length);level=Math.min(1,rms*5);
    for(let i=0;i<bars.length;i++){const offset=Math.floor(i*160/bars.length);let energy=0;for(let j=0;j<6;j++)energy+=frequencies[offset+j];bars[i].style.height=(4+Math.min(1,energy/1530)*46*Math.min(1,rms*60)).toFixed(1)+'px';}
    $('#chatCallPortrait').style.setProperty('--voice-level',level.toFixed(3));$('#chatCallWave').dataset.level=level.toFixed(3);
   }else silence();
   $('#chatCallSpeaker').textContent=phase==='listening'?(muted?'麦克风已静音':level>.04?'你在说话':'正在听你说话'):phase==='speaking'?peerName+'的声音':phase==='waiting'?'等待知微回应，麦克风暂不录音':'声波随实际声音变化';
   frame=requestAnimationFrame(paint);
  }
  paint();
 }
 function end(close=true){
  window.ZiweiRealtimeCall?.end();
  epoch++;active=false;clearInterval(tick);clearInterval(clock);clearTimeout(timeout);cancelAnimationFrame(frame);tick=clock=timeout=frame=null;waitResolve?.();waitResolve=null;
  const old=recorder;recorder=null;if(old){old.onstop=null;try{if(old.state==='recording')old.stop();}catch{}}
  stream?.getTracks().forEach(t=>t.stop());stream=null;
  audio.onended=audio.onerror=audio.onplaying=audio.onpause=audio.onwaiting=null;audio.pause();audio.removeAttribute('src');audio.load();context?.close().catch(()=>{});context=null;analyser=outputAnalyser=null;
  for(const url of urls)URL.revokeObjectURL(url);urls=[];muted=false;phase='idle';dialog.dataset.phase=phase;silence();microphoneUI();$('#chatCallSpeaker').textContent='声波随实际声音变化';$('#chatCallStart').disabled=false;$('#chatCallStart').hidden=false;$('#chatCallRetry').hidden=true;
  if(close&&dialog.open){dialog.close();void window.ZiweiChatExtra?.approvals().catch(()=>{});}
 }
 function stopRecording(){clearInterval(tick);tick=null;const old=recorder;recorder=null;if(old){old.onstop=null;try{if(old.state==='recording')old.stop();}catch{}}}
 function listen(v){
  if(!active||v!==epoch)return;
  if(round>=20||Date.now()-started>15*60000){state('已达到本次通话时长或轮次上限。');end(false);return;}
  state(muted?'麦克风已静音，取消静音后继续说话。':'正在听你说…','listening');$('#chatCallRetry').hidden=true;
  if(muted)return;
  const mime=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t)),r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];
  let voiced=0,lastVoice=0,bytes=0;const began=Date.now();recorder=r;
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
  const valid=()=>active&&v===epoch;round++;state('已听到，正在发送语音…','waiting');
  try{
   const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'weba',a=await api('/api/chat/attachments','POST',null,{headers:{'X-Filename':encodeURIComponent('call-'+crypto.randomUUID()+'.'+ext),'Content-Type':type},body:blob});if(!valid())return;
   const id=await sendVoice(a);if(!valid())return;state('等待知微回应…');void refresh().catch(()=>{});
   let done;const deadline=Date.now()+6*60000;
   while(valid()&&Date.now()<deadline){const o=await api('/api/chat/requests/'+id);if(!valid())return;if(['completed','failed','cancelled','interrupted'].includes(o.state)){done=o;break;}await new Promise(resolve=>{waitResolve=resolve;timeout=setTimeout(()=>{waitResolve=null;resolve();},1000);});}
   if(!valid())return;if(!done||done.state!=='completed')throw Error('本轮回复未完成，原录音已保存在聊天记录中。');
   void refresh().catch(()=>{});const rows=await api('/api/chat/messages?limit=20');if(!valid())return;const message=rows.data.find(m=>m.id==='reply-'+id);if(!message)throw Error('回复尚未加载，请在聊天记录中查看。');
   let attachment=null;for(const file of message.attachments){const info=await api('/api/chat/attachments/'+file+'/metadata');if(!valid())return;if(info.mime.startsWith('audio/')){attachment=info;break;}}
   if(!attachment){state('知微已回复，正在生成回复语音…');attachment=await api('/api/chat/speech','POST',{messageId:message.id});}if(!valid())return;
   audio.onplaying=()=>{if(valid()){state(peerName+'正在说话…','speaking');$('#chatCallRetry').hidden=true;}};
   audio.onpause=()=>{if(valid()&&!audio.ended){state('回复语音已暂停，点击继续播放。','paused');$('#chatCallRetry').hidden=false;}};
   audio.onwaiting=()=>{if(valid())state('正在缓冲回复语音…','waiting');};
   audio.onended=()=>{if(valid())listen(v);};audio.onerror=()=>{if(valid()){state('回复语音读取失败，可点按钮重试播放。','paused');$('#chatCallRetry').hidden=false;}};
   audio.src='/api/chat/attachments/'+attachment.id;state('正在播放知微的回复…','waiting');
   try{await audio.play();}catch{if(valid()){state('点击下方按钮，播放知微的回复。','paused');$('#chatCallRetry').hidden=false;}}
  }catch(e){if(valid()){state(e.message||'本轮通话未完成，请在聊天记录中核对。');end(false);}}
 }
 async function beginCall(){
  if(active||!api)return;
  if(!ready?.()){state('请先返回我们的对话，并处理输入区中尚未发送或待核对的消息。');return;}
  const realtimeEpoch=epoch;
  let realtimeEnabled=false;
  try{realtimeEnabled=(await api('/api/voice/config')).enabled&&new URLSearchParams(location.search).get('voice')!=='legacy';}catch{}
  if(realtimeEpoch!==epoch||!dialog.open)return;
  if(realtimeEnabled){
   stopVoice();end(false);active=true;$('#chatCallStart').disabled=true;state('正在连接实时语音…','connecting');
   try{await window.ZiweiRealtimeCall.begin({request:api,state,ended:()=>{active=false;$('#chatCallStart').disabled=false;$('#chatCallStart').hidden=false;$('#chatCallMute').disabled=true;}});}
   catch{state('实时语音连接失败，请重试。');end(false);}return;
  }
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder||!(window.AudioContext||window.webkitAudioContext)){state('当前浏览器不支持语音通话，请使用支持录音的 Safari 或 Chrome。');return;}
  stopVoice();end(false);active=true;const v=epoch;round=0;started=Date.now();$('#chatCallStart').disabled=true;state('正在连接麦克风…','connecting');
  // A new element per context avoids reconnecting an already-used media element
  // to a second AudioContext on a later call (InvalidStateError in browsers).
  const replacement=audio.cloneNode(false);audio.replaceWith(replacement);audio=replacement;
  try{
   context=new (window.AudioContext||window.webkitAudioContext)();await context.resume();if(!active||v!==epoch)return;
   const bytes=new Uint8Array(46),view=new DataView(bytes.buffer);for(const [offset,text] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);view.setUint32(4,38,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,2,true);const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));urls.push(url);audio.src=url;void audio.play().catch(()=>{});
   const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!active||v!==epoch){mic.getTracks().forEach(t=>t.stop());return;}
   stream=mic;for(const track of stream.getAudioTracks())track.addEventListener('ended',()=>{if(active&&v===epoch){state('麦克风连接已断开，请重新开始通话。');end(false);}});analyser=context.createAnalyser();analyser.fftSize=1024;context.createMediaStreamSource(stream).connect(analyser);
   outputAnalyser=context.createAnalyser();outputAnalyser.fftSize=1024;context.createMediaElementSource(audio).connect(outputAnalyser);outputAnalyser.connect(context.destination);
   microphoneUI();started=Date.now();elapsed();clock=setInterval(()=>{elapsed();if(Date.now()-started>=15*60000){state('已达到本次通话时长上限。');end(false);}},500);$('#chatCallStart').hidden=true;listen(v);monitor(v);
  }catch(e){if(active&&v===epoch){state(e.name==='NotAllowedError'?'未获得麦克风权限。':'无法开始通话，请检查麦克风。');end(false);}}
 }
 async function begin(){if(opening)return;opening=true;try{await beginCall();}finally{opening=false;}}
 $('#chatCall').onclick=()=>{if(!dialog.open){state('准备好后，开始通话','idle');$('#chatCallElapsed').textContent='00:00';dialog.showModal();void window.ZiweiChatExtra?.approvals().catch(()=>{});}};
 $('#chatCallStart').onclick=begin;$('#chatCallEnd').onclick=()=>end();dialog.addEventListener('cancel',()=>end(false));dialog.addEventListener('close',()=>{if(active)end(false);});
 $('#chatCallMute').onclick=()=>{if(window.ZiweiRealtimeCall?.active){muted=!muted;void window.ZiweiRealtimeCall.mute(muted).catch(()=>end(false));$('#chatCallMute').setAttribute('aria-pressed',String(muted));$('#chatCallMuteLabel').textContent=muted?'取消静音':'静音';return;}if(!active||!stream)return;muted=!muted;stream.getAudioTracks().forEach(t=>{t.enabled=!muted;});microphoneUI();if(phase==='listening'){stopRecording();listen(epoch);}};
 $('#chatCallRetry').onclick=()=>{if(window.ZiweiRealtimeCall?.active){void window.ZiweiRealtimeCall.resume().catch(()=>{});return;}void context?.resume().catch(()=>{});audio.load();void audio.play().catch(()=>{state('仍无法播放，可以挂断后在聊天记录中重试。','paused');$('#chatCallRetry').hidden=false;});};

 return {configure(deps){api=deps.request;stopVoice=deps.stopVoice;refresh=deps.load;sendVoice=deps.sendVoice;ready=deps.ready;},setProfile,end};
})();
