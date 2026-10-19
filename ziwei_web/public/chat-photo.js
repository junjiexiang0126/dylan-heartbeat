'use strict';
/* Shared photo UI: original message images remain the source of truth. */
(()=>{
 const selectors=['#chatMessages','#work .work-conversation'];
 const groups=new WeakMap(), bound=new WeakSet(), imageGroups=new WeakMap();
 let scheduled=false;
 function bindImage(img,group){
  imageGroups.set(img,group);
  if(bound.has(img))return;
  bound.add(img);
  let timer=null;
  img.addEventListener('click',e=>{
   e.stopPropagation();clearTimeout(timer);
   timer=setTimeout(()=>{timer=null;const current=imageGroups.get(img);if(current?.expanded)current.collapse();},270);
  });
  img.addEventListener('dblclick',e=>{
   e.preventDefault();e.stopPropagation();clearTimeout(timer);timer=null;
   window.ZiweiChatExtra?.showImage(img);
  });
  img.addEventListener('keydown',e=>{
   if(e.key==='Enter'||e.key===' '){e.preventDefault();window.ZiweiChatExtra?.showImage(img);}
  });
 }
 function mount(bubble){
  const body=bubble.parentElement;if(!body)return;
  let group=groups.get(bubble);
  const incoming=[...bubble.querySelectorAll('img.message-media')];
  if(group&&!incoming.length)return;
  if(group){
   const existing=group.images.filter(img=>img.isConnected);
   const next=[...existing,...incoming];
   if(next.length===existing.length)return;
   group.dispose();
   // Restore previous images before rebuilding the complete collection.
   existing.forEach(img=>{img.hidden=false;bubble.append(img);});
  }
  const images=[...bubble.querySelectorAll('img.message-media')];
  if(!images.length)return;
  const stage=document.createElement('div');stage.className='zw-photo-stage';stage.setAttribute('aria-label','图片消息');
  bubble.after(stage);
  const stream=document.createElement('div');stream.className='zw-photo-stream';stream.hidden=true;stage.after(stream);
  const current={images,stage,stream,stack:null,expanded:false,collapse:()=>{},dispose:()=>{}};
  groups.set(bubble,current);
  const meaningful=[...bubble.children].some(n=>n.matches('.message-quote,.file-card,.file-delivery,.voice-message,.chat-process-details')||(n.matches('.message-content')&&n.textContent.trim())||(!n.matches('.message-content')&&n.textContent.trim()));
  bubble.classList.toggle('zw-photo-empty-bubble',!meaningful);
  images.forEach(img=>{img.onclick=null;img.onkeydown=null;stage.append(img);bindImage(img,current);});
  if(images.length===1){current.dispose=()=>{stage.remove();stream.remove();};return;}
  images.forEach(img=>img.hidden=true);
  const host=document.createElement('div');host.className='zw-photo-stack';stage.append(host);
  if(!window.PhotoStack){images.forEach(img=>img.hidden=false);return;}
  let busy=false,closing=null;
  const expand=()=>{
   if(busy||current.expanded)return;
   busy=true;stream.replaceChildren();
   images.forEach(img=>{img.hidden=false;stream.append(img);});
   stream.hidden=false;stage.classList.add('zw-photo-expanded');current.expanded=true;
   requestAnimationFrame(()=>{if(!stage.isConnected)return;stream.classList.add('is-visible');busy=false;});
  };
  current.collapse=()=>{
   if(busy||!current.expanded)return;
   busy=true;stream.classList.remove('is-visible');
   const done=()=>{closing=null;if(!stage.isConnected)return;images.forEach(img=>{img.hidden=true;stage.append(img);});stream.hidden=true;stage.classList.remove('zw-photo-expanded');current.expanded=false;busy=false;};
   if(matchMedia('(prefers-reduced-motion: reduce)').matches)done();else closing=setTimeout(done,300);
  };
  current.stack=new PhotoStack(host,images.map(img=>img.src),{width:185,height:247,onTap:expand});
  current.dispose=()=>{if(closing)clearTimeout(closing);current.stack?.destroy?.();stage.remove();stream.remove();};
 }
 function reconcile(){
  scheduled=false;
  for(const selector of selectors){
   const root=document.querySelector(selector);if(!root)continue;
   root.querySelectorAll('.message-bubble').forEach(mount);
  }
 }
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(reconcile);}
 const observer=new MutationObserver(schedule);
 for(const selector of selectors){const root=document.querySelector(selector);if(root)observer.observe(root,{childList:true,subtree:true});}
 schedule();
})();