'use strict';
// Reuses the existing call dialog and theme. Legacy chat-call.js remains the fallback.
window.ZiweiRealtimeCall=(()=>{
 let transport=null,remote=null,started=0,timer=null,onEnd=null,context=null,remoteAnalyser=null,micAnalyser=null,animation=null,answer="";
 const $=id=>document.getElementById(id);
 function analyserFor(track){if(!context||!track)return null;const analyser=context.createAnalyser();analyser.fftSize=512;context.createMediaStreamSource(new MediaStream([track])).connect(analyser);return analyser;}
 function paint(){if(!transport)return;const analyser=$('chatCallDialog').dataset.phase==='speaking'?remoteAnalyser:transport.muted?null:micAnalyser;const values=new Uint8Array(256);let level=0;if(analyser){analyser.getByteFrequencyData(values);level=values.reduce((a,b)=>a+b,0)/values.length/255;}
  $('chatCallPortrait').style.setProperty('--voice-level',String(Math.min(1,level*4)));[...$('chatCallWave').children].forEach((bar,i)=>bar.style.height=(4+(analyser?values[i*4]/255*42:0))+'px');animation=requestAnimationFrame(paint);
 }
 async function begin({request,state,ended}){
  if(transport)return;onEnd=ended;started=Date.now();answer='';context=new (window.AudioContext||window.webkitAudioContext)();void context.resume().catch(()=>{});$('chatCallMode').textContent='说完稍停即可回应；知微说话时，你可以直接开口打断。';
  const current=transport=new window.ZiweiLiveKitCallTransport({sdk:window.LivekitClient,request,
   onState:s=>{
    if(transport!==current)return;
    const labels={connected:'正在听你说话…',reconnecting:'网络中断，正在重连…',muted:'麦克风已静音',unmuted:'正在听你说话…',disconnected:'连接已断开',ended:'通话已结束'};
    state(labels[s]||s,s==='connected'?'listening':'waiting');
    if(s==='ended')end();
   },
   onRemoteAudio:({track})=>{
    if(remote){remote.pause();remote.remove();}remote=track.attach();remoteAnalyser=analyserFor(track.mediaStreamTrack);remote.hidden=true;document.body.append(remote);
    remote.play().catch(()=>{state('点击继续播放，开启知微的声音。','paused');$('chatCallRetry').hidden=false;});
   },
   onEvent:e=>{
    if(transport!==current)return;
    if(e.type==='user.transcript'){$('chatCallSpeaker').textContent='你：'+e.text;answer='';}
    if(e.type==='assistant.delta'){answer+=e.delta;$('chatCallSpeaker').textContent='知微：'+answer.slice(-240);}
    if(e.type==='assistant.speaking')state('知微正在说话…','speaking');
    if(e.type==='assistant.done'||e.type==='assistant.interrupted')state('正在听你说话…','listening');
    if(e.type==='user.speech.ready')state('知微正在思考…','waiting');
    if(e.type==='call.error'){state('本轮语音未完成，请挂断后重试。','waiting');end();}
   }
  });
  try{
   await current.connect();if(transport!==current)return;
   micAnalyser=analyserFor(current.room.localParticipant.getTrackPublication(window.LivekitClient.Track.Source.Microphone)?.track?.mediaStreamTrack);paint();
   $('chatCallStart').hidden=true;$('chatCallMute').disabled=false;$('chatCallMicStatus').textContent='麦克风已开启';
   timer=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);$('chatCallElapsed').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');if(seconds>=900)end();},500);
  }catch(e){end();throw e;}
 }
 function end(){const old=transport;transport=null;clearInterval(timer);timer=null;cancelAnimationFrame(animation);animation=null;void context?.close().catch(()=>{});context=null;micAnalyser=remoteAnalyser=null;$('chatCallPortrait').style.setProperty('--voice-level','0');[...$('chatCallWave').children].forEach(bar=>bar.style.height='4px');if(remote){remote.pause();remote.remove();remote=null;}void old?.disconnect();const callback=onEnd;onEnd=null;callback?.();}
 async function mute(value){if(!transport)return;await transport.setMuted(value);$('chatCallMicStatus').textContent=value?'麦克风已静音':'麦克风已开启';}
 async function resume(){await context?.resume();await transport?.room?.startAudio();await remote?.play();$('chatCallRetry').hidden=true;}
 return {begin,end,mute,resume,get active(){return !!transport;}};
})();
