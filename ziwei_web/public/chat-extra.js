'use strict';
window.ZiweiChatExtra=(()=>{
 const $=s=>document.querySelector(s);let api=null,epoch=0,timer=null,viewer=[],index=0,scale=1,touch=null;
 const words={once:'允许本次',deny:'拒绝'};
 function presence(value){
  const valid=value?.source==='ziwei'&&['在工作','在休息','在思考','在想你'].includes(value.state)&&Number.isFinite(Date.parse(value.updatedAt));
  const fresh=valid&&!value.stale&&Date.now()-Date.parse(value.updatedAt)<1800000;
  const short=valid?new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Bangkok'}).format(new Date(value.updatedAt)):null;
  const full=valid?new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short',hour12:false,timeZone:'Asia/Bangkok'}).format(new Date(value.updatedAt)):null;
  $('#chatPresence').textContent=fresh?value.state:valid?'最后更新于 '+short:'尚无状态记录';$('#chatPresence').title=valid?'知微最后发布：'+value.state+' · '+full:'';
  $('#todayStatus').textContent=fresh?value.state:valid?'最近状态：'+value.state:'等待知微同步今日状态';$('#todayStatusTime').textContent=valid?'知微更新于 '+full:'更新时间：暂无';
  document.querySelector('.today .status-tag').textContent=fresh?'本人更新':valid?'最后更新于 '+short:'暂无记录';

 }
 async function approvals(){
  if(!api)return;const v=epoch,o=await api('/api/chat/approvals');if(v!==epoch)return;
  const inCall=$('#chatCallDialog').open,list=$(inCall?'#chatCallApprovals':'#chatApprovals'),keep=new Set();$(inCall?'#chatApprovals':'#chatCallApprovals').replaceChildren();
  for(const a of o.data){const key=a.requestId+':'+a.approvalId;keep.add(key);if([...list.children].some(c=>c.dataset.key===key))continue;
   const card=document.createElement('section');card.className='chat-approval glass';card.dataset.key=key;
   const title=document.createElement('strong');title.textContent='知微需要你的批准';const pre=document.createElement('pre');pre.textContent=a.command;
   const choices=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
   for(const choice of a.choices.filter(c=>Object.hasOwn(words,c))){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=words[choice];b.onclick=async()=>{choices.querySelectorAll('button').forEach(x=>x.disabled=true);status.textContent='正在提交你的选择…';try{await api('/api/chat/approval','POST',{requestId:a.requestId,approvalId:a.approvalId,choice});if(v===epoch)card.remove();}catch(e){if(v!==epoch)return;status.textContent=e.status===409?'此批准请求已过期，请等待新的请求。':'选择未确认，请重新核对。';if(e.status!==409)choices.querySelectorAll('button').forEach(x=>x.disabled=false);}};choices.append(b);}
   if(!choices.children.length)status.textContent='当前请求没有可安全提交的选项，请在原入口处理。';
   card.append(title,pre,choices,status);list.append(card);
  }
  for(const card of list.children)if(!keep.has(card.dataset.key))card.remove();
 }
 async function history(){if(!api)return;const v=epoch,o=await api('/api/chat/history');if(v!==epoch)return;$('#chatHistoryStatus').textContent=(['running','pending'].includes(o.state)?'正在后台增量同步':o.state==='completed'?'同步完成':o.state==='failed'?'同步未完成':'尚未同步')+' · '+o.sessions+' 个会话 / '+o.messages+' 条记录'+(o.error?' · '+o.error:'')+(o.failedAt?' · 断点：'+(o.failedAt.session||'会话列表')+' / '+o.failedAt.offset:'')+'。'+(o.scope||'');}
 $('#chatImageFull').onerror=()=>{$('#chatImageRetry').hidden=false;};$('#chatImageFull').onload=()=>{$('#chatImageRetry').hidden=true;};$('#chatImageRetry').onclick=()=>{if(viewer[index]){const url=new URL(viewer[index].src,location.href);url.searchParams.set('retry',String(Date.now()));$('#chatImageFull').src=url.href;}};
 function paintImage(){const image=viewer[index];if(!image)return;scale=1;$('#chatImageFull').style.width='100%';$('#chatImageFull').dataset.zoomed='false';$('#chatImageCanvas').scrollTo(0,0);$('#chatImageFull').src=image.src;$('#chatImageFull').alt=image.alt;$('#chatImageName').textContent=(index+1)+' / '+viewer.length+' · '+image.alt;$('#chatImageSave').href=image.src;$('#chatImageSave').download=image.alt;$('#chatImagePrevious').disabled=index===0;$('#chatImageNext').disabled=index===viewer.length-1;}
 function zoom(value){scale=Math.min(4,Math.max(1,value));$('#chatImageFull').style.width=scale*100+'%';$('#chatImageFull').dataset.zoomed=String(scale>1);}
 function showImage(img){const source=img.closest('#work')?'#work img.message-media':'#chatMessages img.message-media';viewer=[...document.querySelectorAll(source)].map(i=>({src:i.src,alt:i.alt}));index=viewer.findIndex(i=>i===img);if(index<0)index=0;paintImage();if(!$('#chatImageViewer').open)$('#chatImageViewer').showModal();}
 $('#chatImageClose').onclick=()=>$('#chatImageViewer').close();$('#chatImageViewer').addEventListener('close',()=>{$('#chatImageFull').removeAttribute('src');$('#chatImageSave').removeAttribute('href');$('#chatImageName').textContent='';viewer=[];});
// 「保存原图」也不再同页跳转；点浮层空白处可以关掉（原来只有 × 一个出口）
$('#chatImageSave').onclick=e=>{e.preventDefault();const art=viewer[index]||{src:$('#chatImageFull').src,alt:'image.png'};window.ZiweiSave&&window.ZiweiSave.saveOrShare(art.src,art.alt);};
$('#chatImageViewer').addEventListener('click',e=>{if(e.target===$('#chatImageViewer'))$('#chatImageViewer').close();});
 $('#chatImagePrevious').onclick=()=>{if(index>0){index--;paintImage();}};$('#chatImageNext').onclick=()=>{if(index<viewer.length-1){index++;paintImage();}};
 $('#chatImageZoomIn').onclick=()=>zoom(scale+.5);$('#chatImageZoomOut').onclick=()=>zoom(scale-.5);
 const canvas=$('#chatImageCanvas'),distance=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
 canvas.addEventListener('touchstart',e=>{touch=e.touches.length===2?{distance:distance(e),scale}:e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true});
 canvas.addEventListener('touchmove',e=>{if(touch?.distance&&e.touches.length===2){e.preventDefault();zoom(touch.scale*distance(e)/touch.distance);}},{passive:false});
 canvas.addEventListener('touchend',e=>{if(touch?.x!==undefined&&scale===1&&e.changedTouches.length===1){const dx=e.changedTouches[0].clientX-touch.x,dy=e.changedTouches[0].clientY-touch.y;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5){if(dx<0)$('#chatImageNext').click();else $('#chatImagePrevious').click();}}touch=null;});
 $('#chatHistorySync').onclick=async()=>{if(!api)return;const b=$('#chatHistorySync');b.disabled=true;try{await api('/api/chat/history/sync','POST',{});await history();}catch{$('#chatHistoryStatus').textContent='无法同步历史，请稍后重试。';}finally{b.disabled=false;}};
 $('#chatMediaSync').onclick=async()=>{if(!api)return;const v=epoch;$('#chatMediaSync').disabled=true;try{const o=await api('/api/chat/media/sync','POST',{});if(v===epoch)$('#chatHistoryStatus').textContent=o.ok?'已核对最近回复的可用附件。':'部分附件尚未收到，请查看对应消息的提示并重试。';}catch{if(v===epoch)$('#chatHistoryStatus').textContent='附件同步未完成，请重试。';}finally{if(v===epoch)$('#chatMediaSync').disabled=false;}};
 function stop(){epoch++;api=null;clearInterval(timer);timer=null;$('#chatApprovals').replaceChildren();$('#chatCallApprovals').replaceChildren();$('#chatHistoryStatus').textContent='';if($('#chatImageViewer').open)$('#chatImageViewer').close();}
 function start(request){if(api)return;api=request;void approvals().catch(()=>{});void history().catch(()=>{});timer=setInterval(()=>{if(api&&!document.hidden&&!$('#chat').hidden){void approvals().catch(()=>{});void history().catch(()=>{});}},5000);}
 return {start,stop,presence,approvals,showImage};
})();
