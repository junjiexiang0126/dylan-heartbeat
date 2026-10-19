/* Wren036 PhotoStack: noncommercial licensed vendor, unchanged. */
'use strict';
(() => {
 const timeline=document.getElementById('chatMessages');
 if(!timeline||!window.PhotoStack)return;
 const records=new Map();let pending=false;
 function animate(from,to,src,i){
  return new Promise(done=>{
   const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
   if(!a.width||!a.height||!b.width||!b.height){done();return}
   const img=document.createElement('img');img.src=src;img.className='chat-photostack-flight';
   Object.assign(img.style,{left:a.left+'px',top:a.top+'px',width:a.width+'px',height:a.height+'px'});
   document.body.append(img);
   const animation=img.animate([{transform:'translate(0,0) scale(1,1)'},{transform:`translate(${b.left-a.left}px,${b.top-a.top}px) scale(${b.width/a.width},${b.height/a.height})`}],{duration:280+i*45,easing:'cubic-bezier(.2,.7,.3,1)',fill:'forwards'});
   const finish=()=>{img.remove();done()};animation.onfinish=finish;animation.oncancel=finish;
  });
 }
 function teardown(bubble,record){
  record.stack.destroy();record.stage.remove();record.stream.remove();
  record.images.forEach(img=>img.classList.remove('photostack-source-hidden'));
  records.delete(bubble);
 }
 function mount(bubble,images){
  const stage=document.createElement('div');stage.className='chat-photostack';stage.tabIndex=0;stage.setAttribute('aria-label','滑动浏览照片');
  images[0].before(stage);images.forEach(img=>img.classList.add('photostack-source-hidden'));
  const stream=document.createElement('div');stream.className='chat-photostack-stream';stream.hidden=true;stage.after(stream);
  const urls=images.map(img=>img.src);let expanded=false,busy=false;
  const stack=new PhotoStack(stage,urls,{onTap:()=>expand()});
  function lines(){
   stream.replaceChildren();
   images.forEach((source,i)=>{
    const line=document.createElement('div');line.className='chat-photostack-line';
    const thumb=document.createElement('img');thumb.src=source.src;thumb.alt=source.alt||'图片';thumb.tabIndex=0;
    let timer=null,lastTouch=0;
    thumb.addEventListener('click',()=>{clearTimeout(timer);timer=setTimeout(()=>{timer=null;collapse()},280)});
    thumb.addEventListener('dblclick',event=>{event.preventDefault();clearTimeout(timer);timer=null;window.ZiweiChatExtra?.showImage(source)});
    thumb.addEventListener('touchend',event=>{const now=Date.now();if(now-lastTouch<320){event.preventDefault();clearTimeout(timer);timer=null;window.ZiweiChatExtra?.showImage(source)}lastTouch=now},{passive:false});
    thumb.addEventListener('keydown',event=>{if(event.key==='Enter')collapse()});
    line.append(thumb);stream.append(line);
   });
  }
  async function expand(){
   if(expanded||busy)return;busy=true;lines();stream.hidden=false;stage.classList.add('is-expanded');
   const thumbs=[...stream.querySelectorAll('img')];thumbs.forEach(el=>el.style.visibility='hidden');
   try{await Promise.all(thumbs.map((el,i)=>animate(stack.cards[i].querySelector('img'),el,urls[i],i)))}
   finally{thumbs.forEach(el=>el.style.visibility='');expanded=true;busy=false}
  }
  async function collapse(){
   if(!expanded||busy)return;busy=true;
   const thumbs=[...stream.querySelectorAll('img')];
   try{await Promise.all(thumbs.map((el,i)=>animate(el,stack.cards[i].querySelector('img'),urls[i],i)))}
   finally{stream.hidden=true;stage.classList.remove('is-expanded');expanded=false;busy=false}
  }
  stage.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();stack.prev()}else if(e.key==='ArrowRight'){e.preventDefault();stack.next()}else if(e.key==='Enter'){e.preventDefault();expand()}});
  records.set(bubble,{stage,stream,stack,images,urls});
 }
 function reconcile(){
  pending=false;
  for(const [bubble,record] of records){if(!bubble.isConnected){record.stack.destroy();records.delete(bubble)}}
  for(const bubble of timeline.querySelectorAll('.message-bubble')){
   const images=[...bubble.querySelectorAll('img.message-media')];
   const old=records.get(bubble);
   if(images.length<2){if(old)teardown(bubble,old);continue}
   const urls=images.map(img=>img.src);
   if(old&&old.urls.length===urls.length&&old.urls.every((u,i)=>u===urls[i]))continue;
   if(old)teardown(bubble,old);
   mount(bubble,images);
  }
 }
 function schedule(){if(pending)return;pending=true;requestAnimationFrame(reconcile)}
 new MutationObserver(schedule).observe(timeline,{childList:true,subtree:true});schedule();
})();
