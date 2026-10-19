'use strict';
/* Unified media presentation for private chat and Work. PhotoStack vendor remains unchanged. */
(()=>{
 const roots=['#chatMessages','#work .work-conversation'];
 const groups=new WeakMap();
 let scheduled=false;
 function photoClick(img,group){
  let timer=0;
  img.addEventListener('click',e=>{e.stopPropagation();clearTimeout(timer);timer=setTimeout(()=>group?.collapse?.(),270);});
  img.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();clearTimeout(timer);window.ZiweiChatExtra?.showImage(img);});
  img.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.ZiweiChatExtra?.showImage(img);}});
 }
 function mount(bubble){
  const body=bubble.parentElement;if(!body)return;
  const images=[...bubble.querySelectorAll('img.message-media')];
  let group=groups.get(bubble);
  if(group&&images.length===0)return;
  if(group&&group.images.length===images.length)return;
  if(group){group.stage?.remove();group.stream?.remove();group.images.forEach(i=>{if(i.isConnected)i.remove();});group.stack?.destroy?.();}
  if(!images.length)return;
  const stage=document.createElement('div');stage.className='zw-photo-stage';stage.setAttribute('aria-label','图片消息');
  bubble.after(stage);
  const stream=document.createElement('div');stream.className='zw-photo-stream';stream.hidden=true;stage.after(stream);
  images.forEach(img=>{img.onclick=null;img.classList.add('zw-photo-original');stage.append(img);});
  const current={images,stage,stream,stack:null,expanded:false,collapse:null};
  groups.set(bubble,current);
  const meaningful=[...bubble.children].some(n=>n.matches('.message-quote,.file-card,.file-delivery,.voice-message,.chat-process-details')||(n.matches('.message-content')&&n.textContent.trim())||(!n.matches('.message-content')&&n.textContent.trim()));
  bubble.classList.toggle('zw-photo-empty-bubble',!meaningful);
  if(images.length===1){photoClick(images[0],null);return;}
  images.forEach(img=>{img.hidden=true;});
  const stackHost=document.createElement('div');stackHost.className='zw-photo-stack';stage.append(stackHost);
  if(!window.PhotoStack)return;
  let busy=false;
  const stack=new PhotoStack(stackHost,images.map(i=>i.src),{onTap:()=>expand()});current.stack=stack;
  function expand(){
   if(busy||current.expanded)return;busy=true;
   stream.replaceChildren();
   images.forEach(img=>{img.hidden=false;stream.append(img);photoClick(img,current);});
   stream.hidden=false;stage.classList.add('zw-photo-expanded');current.expanded=true;
   requestAnimationFrame(()=>{stream.classList.add('is-visible');busy=false;});
  }
  function collapse(){
   if(busy||!current.expanded)return;busy=true;stream.classList.remove('is-visible');
   const done=()=>{images.forEach(img=>{img.hidden=true;stage.append(img);});stream.hidden=true;stage.classList.remove('zw-photo-expanded');current.expanded=false;busy=false;};
   if(matchMedia('(prefers-reduced-motion: reduce)').matches)done();else setTimeout(done,300);
  }
  current.collapse=collapse;
 }
 function reconcile(){
  scheduled=false;
  roots.forEach(sel=>{const root=document.querySelector(sel);if(!root)return;
   root.querySelectorAll('.message-bubble').forEach(mount);
  });
 }
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(reconcile);}
 const observer=new MutationObserver(schedule);
 roots.forEach(sel=>{const root=document.querySelector(sel);if(root)observer.observe(root,{childList:true,subtree:true});});
 schedule();
})();