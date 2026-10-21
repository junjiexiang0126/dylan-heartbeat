'use strict';
// Presentation only: no API requests, record writes, or wallpaper storage.
(()=>{
 const root=document.documentElement,logs=document.getElementById('logs'),memory=document.getElementById('memory');
 if(!logs||!memory)return;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),motionInput=document.getElementById('experienceMotion'),soundInput=document.getElementById('experienceSound');
 const read=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
 const save=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};
 let enabled=read('zw_experience_motion','true')==='true',sound=read('zw_experience_sound','false')==='true',audio=null,mode='',timer=null,scene=null,sceneTimer=null,exitTimer=null,writingTimer=null,penTimer=null,pen=null,controls=null,animations=[],wrappers=[],opened=false,navigation=0;
 const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'grapheme'}):null;
 const active=()=>enabled&&!reduce.matches&&!document.hidden&&!document.getElementById('app').hidden&&root.dataset.experience!=='off';
 function soundPage(){
  // A user gesture unlocks AudioContext; preferences alone never autoplay audio.
  if(!sound||!active()||!audio||audio.state!=='running')return;
  try{const duration=.26,buffer=audio.createBuffer(1,Math.ceil(audio.sampleRate*duration),audio.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.25;
   const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();source.buffer=buffer;filter.type='bandpass';filter.frequency.value=1600;filter.Q.value=.45;gain.gain.setValueAtTime(.0001,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.045,audio.currentTime+.05);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+duration);source.connect(filter).connect(gain).connect(audio.destination);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};source.start();source.stop(audio.currentTime+duration);
  }catch{}
 }
 function unlock(){if(!sound||!active())return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();void audio.resume().catch(()=>{});}catch{}}
 document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock);
 function finish(){clearTimeout(writingTimer);clearInterval(penTimer);pen?.remove();pen=null;for(const a of animations)a.cancel();animations=[];for(const wrap of wrappers){if(wrap.isConnected)wrap.replaceWith(document.createTextNode(wrap.dataset.text));}wrappers=[];controls?.remove();controls=null;}
 function clearScene(){clearTimeout(sceneTimer);clearTimeout(exitTimer);scene?.remove();scene=null;}
 function book(){
  finish();clearScene();if(!active())return;opened=true;
  scene=document.createElement('div');scene.className='zw-book-scene';scene.setAttribute('aria-label','手记翻开动画');
  scene.innerHTML='<div class="zw-book" aria-hidden="true"><div class="zw-book-pages"></div><div class="zw-book-page"><small>A PAGE FOR YOU</small><p>把日子，<br>一页一页<br>留在这里。</p><i></i><i></i></div><div class="zw-book-leaf"></div><div class="zw-book-leaf"></div><div class="zw-book-cover"><strong>知微的手记</strong><small>DAYS & FOOTPRINTS</small></div></div>';
  scene.querySelectorAll('.zw-book-leaf').forEach((leaf,i)=>leaf.style.setProperty('--leaf-delay',(.8-i*.2)+'s'));
  const skip=document.createElement('button');skip.type='button';skip.className='zw-skip-book';skip.textContent='跳过开书';skip.onclick=clearScene;scene.append(skip);document.body.append(scene);soundPage();
  sceneTimer=setTimeout(()=>{scene?.classList.add('zw-leaving');exitTimer=setTimeout(clearScene,300);},1900);
 }
 function state(){
  if(document.getElementById('app').hidden)return {key:'locked'};
  if(!logs.hidden){if(!logs.classList.contains('record-open'))return {key:'home'};if(logs.classList.contains('diary-reading')){const body=logs.querySelector('.diary-card .record-reading');if(body)return {key:'read:'+logs.querySelector('.diary-card')?.dataset.id,body};}}
  if(!memory.hidden)return {key:document.getElementById('memoryDetail').hidden?'memory-home':'memory-read:'+document.getElementById('memoryDetailTitle').textContent};
  return {key:'other'};
 }
 async function openDiary(){
  // Cancel when the user navigates away during the lazy diary fetch.
  logs.querySelector('[data-log-kind=diary]')?.click();const epoch=++navigation;
  for(let i=0;i<100;i++){if(epoch!==navigation||logs.hidden||logs.querySelector('[data-log-kind=diary]')?.getAttribute('aria-selected')!=='true')return;const button=logs.querySelector('.diary-open');if(button){button.click();return;}await new Promise(r=>setTimeout(r,30));}
 }
 function decorate(){
  if(!logs.querySelector('.zw-journal-hero')){
   const hero=document.createElement('section');hero.className='zw-journal-hero';hero.setAttribute('aria-label','知微的手记');hero.innerHTML='<div class="zw-hero-copy"><div class="zw-kicker">OUR LITTLE DAYS</div><h2>把日子留在这里</h2><p>翻过一页，<br>再读一段知微留下的话。</p><button type="button" class="zw-hero-open">翻开手记 ↗</button><button type="button" class="zw-hero-open zw-replay-book">重播开书动画</button></div><button class="zw-hero-book" type="button" aria-label="翻开知微的手记"><span class="zw-book-ribbon" aria-hidden="true"></span><span class="zw-hero-cover"><strong>知微的手记</strong><small>OUR LITTLE DAYS</small></span></button>';
   hero.querySelector('.zw-hero-book').onclick=openDiary;hero.querySelector('.zw-hero-open').onclick=openDiary;hero.querySelector('.zw-replay-book').onclick=book;logs.querySelector('.records-heading')?.after(hero);
   const label=document.createElement('div');label.className='zw-library-label';label.textContent='把日子，慢慢收藏';logs.querySelector('.log-entry-grid')?.before(label);
  }
  if(!memory.querySelector('.zw-memory-prologue')){
   const note=document.createElement('p');note.className='zw-memory-prologue';note.textContent='他记得的，慢慢收在这里。';memory.querySelector('.record-heading-group')?.append(note);
   const clip=document.createElement('i');clip.className='zw-memory-clip';clip.setAttribute('aria-hidden','true');memory.querySelector('.memory-main-group')?.append(clip);
   const label=document.createElement('div');label.className='zw-memory-divider';label.textContent='几页小小的收藏';memory.querySelector('[data-memory-category=user]')?.before(label);
   for(const [category,index,text] of [['user','01','关于你的点滴与偏好'],['work','02','做过的事，值得留个位置'],['self','03','知微自己的模样与来路']]){const card=memory.querySelector('[data-memory-category='+category+']');if(!card)continue;const tab=document.createElement('span');tab.className='zw-memory-tab';tab.setAttribute('aria-hidden','true');tab.textContent=index;const hint=document.createElement('span');hint.className='zw-memory-note';hint.textContent=text;card.append(tab,hint);}
  }
  const reading=!logs.hidden&&logs.classList.contains('diary-reading');
  for(const card of logs.querySelectorAll('.diary-card')){if(!reading||card.querySelector('.zw-page-flourish'))continue;const flourish=document.createElement('span');flourish.className='zw-page-flourish';flourish.setAttribute('aria-hidden','true');const folio=document.createElement('div');folio.className='zw-page-folio';folio.textContent='知微的手记 · 留给你的一页';card.prepend(flourish);card.append(folio);}
  let tools=logs.querySelector('.zw-reading-tools');if(reading&&!tools){tools=document.createElement('div');tools.className='zw-reading-tools';const label=document.createElement('span');label.textContent='一页纸，一段日常';const button=document.createElement('button');button.type='button';button.textContent='重现字迹 ↻';button.onclick=()=>{const s=state();if(s.body)reveal(s.body);};tools.append(label,button);logs.querySelector('#logRecords')?.before(tools);}if(tools)tools.hidden=!reading;
 }
 function reveal(body){
  finish();clearScene();if(!active())return;
  const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT),nodes=[];let node,count=0;
  while(node=walker.nextNode()){if(node.data.trim()&&!node.parentElement.closest('pre,code,summary,table,a'))nodes.push(node);}
  const spans=[];
  for(const node of nodes){const letters=segmenter?[...segmenter.segment(node.data)].map(s=>s.segment):Array.from(node.data);if(count+letters.length>900)break;count+=letters.length;const wrap=document.createElement('span'),visual=document.createElement('span'),sr=document.createElement('span');wrap.dataset.text=node.data;visual.className='zw-visual';visual.setAttribute('aria-hidden','true');sr.className='zw-sr-only';sr.textContent=node.data;for(const letter of letters){const s=document.createElement('span');s.className='zw-letter';s.textContent=letter;visual.append(s);spans.push(s);}wrap.append(visual,sr);node.replaceWith(wrap);wrappers.push(wrap);}
  if(!spans.length)return;
  const step=Math.min(28,5200/spans.length);spans.forEach((s,i)=>animations.push(s.animate([{opacity:0,transform:'translateY(3px)',filter:'blur(1px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{duration:300,delay:150+i*step,easing:'ease-out',fill:'both'})));
  controls=document.createElement('div');controls.className='zw-writing-controls';const label=document.createElement('span');label.textContent='让这一页，慢慢浮现';const skip=document.createElement('button');skip.type='button';skip.textContent='立即读完';skip.onclick=finish;controls.append(label,skip);body.before(controls);
  pen=document.createElement('div');pen.className='zw-pen-tip';pen.setAttribute('aria-hidden','true');document.body.append(pen);const began=performance.now();penTimer=setInterval(()=>{if(!pen)return;const i=Math.max(0,Math.min(spans.length-1,Math.floor((performance.now()-began-150)/step))),r=spans[i].getBoundingClientRect();pen.style.visibility=r.top>50&&r.bottom<innerHeight-15?'visible':'hidden';pen.style.left=Math.min(innerWidth-46,r.right-2)+'px';pen.style.top=(r.bottom-61)+'px';},50);soundPage();writingTimer=setTimeout(finish,500+spans.length*step);
 }
 function check(){
  // Restore original DOM before comparing text; visual glyphs never become data.
  const before=state(),key=before.key;
  if(key===mode)return;finish();clearScene();mode=key;decorate();
  if(before.key==='locked'){opened=false;navigation++;return;}
  if(!active())return;
  if(key==='home'&&!opened)book();
  else if(key.startsWith('read:')){const body=logs.querySelector('.diary-card .record-reading');if(body)reveal(body);}
  else if(key.startsWith('memory-')){const cards=key==='memory-home'?[memory.querySelector('.memory-main-group'),...memory.querySelectorAll('.memory-entry:not(.memory-primary)')]:[...memory.querySelectorAll('.memory-card')].slice(0,4);cards.forEach((card,i)=>{if(card)animations.push(card.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,delay:i*45,easing:'ease-out'}));});soundPage();}
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(check,80);}
 const observer=new MutationObserver(schedule);for(const el of [logs,memory,document.getElementById('app')])observer.observe(el,{subtree:el!==document.getElementById('app'),childList:true,attributes:true,attributeFilter:['hidden','class']});
 function apply(){root.dataset.zwMotion=enabled&&!reduce.matches?'on':'off';motionInput.checked=enabled;soundInput.checked=sound;if(!active()){finish();clearScene();}schedule();}
 motionInput.onchange=()=>{enabled=motionInput.checked;save('zw_experience_motion',enabled);apply();};soundInput.onchange=()=>{sound=soundInput.checked;save('zw_experience_sound',sound);if(sound)unlock();};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){finish();clearScene();}else schedule();});reduce.addEventListener('change',apply);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){finish();clearScene();}});
 document.addEventListener('click',event=>{if(event.target.closest('[data-tab],.log-entry,.record-back'))navigation++;});
 document.addEventListener('pointerdown',event=>{if(!active()||!event.target.closest('button:not(:disabled),.paper-note'))return;const wave=document.createElement('span');wave.className='zw-tap-wave';wave.setAttribute('aria-hidden','true');wave.style.cssText='left:'+(event.clientX-26)+'px;top:'+(event.clientY-26)+'px';document.body.append(wave);wave.animate([{opacity:.4,transform:'scale(.2)'},{opacity:0,transform:'scale(1.8)'}],{duration:420,easing:'ease-out'}).onfinish=()=>wave.remove();},{passive:true});
 new MutationObserver(()=>{if(root.dataset.experience==='off'){finish();clearScene();}else schedule();}).observe(root,{attributes:true,attributeFilter:['data-experience']});
 // Local preview uses the same controls without persisting its comparison toggles.
 window.ZiweiMotion={setEnabled(value){enabled=!!value;apply();},setSound(value){sound=!!value;apply();},replay(){const s=state();if(s.key==='home')book();else if(s.body)reveal(s.body);},finish};
 decorate();apply();schedule();
})();
