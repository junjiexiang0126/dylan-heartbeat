'use strict';
window.ZiweiVoiceUI=(()=>{
 const $=s=>document.querySelector(s),make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const menu=make('dialog','voice-menu');menu.id='voiceMenu';const heading=make('h2','','语音消息'),hint=make('p','hint'),save=make('button','secondary','保存原音频'),close=make('button','text-button','关闭');save.type=close.type='button';menu.append(heading,hint,save,close);document.body.append(menu);let selected=null;
 close.onclick=()=>menu.close();menu.onclose=()=>{selected?.release?.();selected=null;hint.textContent='';};save.onclick=()=>{const item=selected;menu.close();if(item)void window.ZiweiSave?.saveOrShare(item.url,item.name);};
 function openMenu(url,name,release){selected={url,name,release};hint.textContent=name;menu.showModal();}
 function player(url,name,pauseOthers){
  const box=make('div','voice-message'),audio=make('audio','voice-audio'),play=make('button','voice-play'),icon=make('span','voice-play-icon'),wave=make('span','voice-play-wave'),duration=make('span','voice-time','语音'),error=make('small','voice-error');
  audio.src=url;audio.preload='metadata';audio.playsInline=true;audio.hidden=true;play.type='button';play.setAttribute('aria-label','播放语音');play.setAttribute('aria-description','长按打开语音菜单，可保存原音频');icon.setAttribute('aria-hidden','true');wave.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)wave.append(make('i'));
  play.append(icon,wave,duration);box.append(audio,play,error);let hold=null,held=false;
  const paint=()=>{const seconds=Number.isFinite(audio.duration)?Math.ceil(audio.duration):0;duration.textContent=seconds?seconds+'″':'语音';box.style.setProperty('--voice-seconds',String(Math.min(60,seconds)));const playing=!audio.paused&&!audio.ended;box.classList.toggle('is-playing',playing);play.setAttribute('aria-label',playing?'暂停语音':'播放语音');play.title=(playing?'暂停':'播放')+'语音'+(seconds?'，'+seconds+'秒':'')+'；长按更多操作';};
  audio.onloadedmetadata=audio.ondurationchange=audio.ontimeupdate=audio.onpause=audio.onended=paint;
  audio.onplay=()=>{pauseOthers?.(audio);paint();};
  const fail=()=>{box.classList.remove('is-playing');play.setAttribute('aria-label','重试播放语音');error.textContent='语音读取失败，点气泡重试；长按可保存原音频。';};audio.onerror=fail;
  play.onclick=async()=>{if(held){held=false;return;}if(!audio.paused){audio.pause();return;}error.textContent='';try{if(audio.error)audio.load();await audio.play();paint();}catch{fail();}};
  const clear=()=>{clearTimeout(hold);hold=null;};box.addEventListener('pointerdown',e=>{if(e.button!==0)return;held=false;const x=e.clientX,y=e.clientY;box._press={x,y};hold=setTimeout(()=>{if(!box.isConnected||$('#app').hidden)return;held=true;openMenu(url,name,()=>held=false);},550);});box.addEventListener('pointermove',e=>{const p=box._press;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>12)clear();});for(const event of ['pointerup','pointercancel','pointerleave'])box.addEventListener(event,clear);
  box.addEventListener('contextmenu',e=>{e.preventDefault();clear();held=true;if(!menu.open)openMenu(url,name,()=>held=false);});play.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();openMenu(url,name,()=>held=false);}});
  paint();return box;
 }
 function meter(){
  const panel=$('#chatRecorder'),wave=$('#chatRecordWave'),gesture=$('#chatRecordGesture');wave.replaceChildren();const bars=Array.from({length:25},()=>{const bar=make('i');bar.style.setProperty('--voice-amplitude','0');wave.append(bar);return bar;});
  const Context=window.AudioContext||window.webkitAudioContext;let context=null,source=null,analyser=null,frame=null,done=false,last=0;const samples=new Float32Array(512),history=Array(25).fill(0);
  panel.hidden=false;panel.dataset.cancel='false';gesture.textContent='松手发送 · 上滑取消';$('#chatRecordTime').textContent='00:00';wave.dataset.level='0';
  try{if(Context){context=new Context();void context.resume().catch(()=>{});}}catch{}
  function stop(){done=true;cancelAnimationFrame(frame);source?.disconnect();analyser?.disconnect();if(context)void context.close().catch(()=>{});context=source=analyser=null;panel.hidden=true;}
  return {stop,connect(stream){if(done)return;try{if(!context)throw Error('no_audio_context');source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);function paint(at){if(done)return;if(at-last>=70){last=at;analyser.getFloatTimeDomainData(samples);let power=0;for(const x of samples)power+=x*x;const level=Math.min(1,Math.sqrt(power/samples.length)*6);history.shift();history.push(level);for(let i=0;i<bars.length;i++)bars[i].style.setProperty('--voice-amplitude',history[i].toFixed(3));wave.dataset.level=level.toFixed(3);}frame=requestAnimationFrame(paint);}frame=requestAnimationFrame(paint);}catch{gesture.textContent='松手发送 · 上滑取消（本机声波暂不可用）';}},cancel(){panel.dataset.cancel='true';gesture.textContent='松手取消，不会发送';},time(value){$('#chatRecordTime').textContent=value;}};
 }
 return {player,meter,reset(){if(menu.open)menu.close();}};
})();
