'use strict';
window.ZiweiChatAppearance=(()=>{
 const layer=document.querySelector('#chatWallpaper'),image=document.querySelector('#chatWallpaperImage');
 const actions=document.querySelector('#chatTopActions'),message=document.querySelector('#chatBackgroundMessage');
 let visible=false,wallpaper=null,loaded=false,revision=0,loading=null,changing=false;
 function paint(){
  document.body.classList.toggle('chat-view',visible);
  document.body.classList.toggle('chat-has-wallpaper',visible&&!!wallpaper);
  actions.hidden=!visible;layer.hidden=!visible||!wallpaper;
  image.src=visible&&wallpaper?wallpaper:'';
 }
 function storage(write,value){return new Promise((resolve,reject)=>{
  const open=indexedDB.open('ziwei-chat-appearance',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('preferences');
  open.onerror=()=>reject(open.error);open.onblocked=()=>reject(Error('storage_unavailable'));
  open.onsuccess=()=>{
   const db=open.result,tx=db.transaction('preferences',write?'readwrite':'readonly'),store=tx.objectStore('preferences');
   const request=write?(value?store.put(value,'wallpaper'):store.delete('wallpaper')):store.get('wallpaper');
   tx.oncomplete=()=>{db.close();resolve(request.result);};
   tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('storage_unavailable'));};
  };
 });}
 function setVisible(value){
  visible=!!value;paint();
  if(!visible||loaded||loading)return;
  const epoch=revision;
  loading=storage(false).then(value=>{
   if(epoch===revision){wallpaper=typeof value==='string'&&value.startsWith('data:image/jpeg;base64,')?value:null;loaded=true;paint();}
  }).catch(()=>{loaded=true;}).finally(()=>{loading=null;});
 }
 async function prepare(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024)throw Error('请选择 12 MB 以内的 JPEG、PNG 或 WebP 图片。');
  const url=URL.createObjectURL(file),img=new Image();
  try{
   img.src=url;try{await img.decode();}catch{throw Error('invalid_image');}if(!img.naturalWidth||!img.naturalHeight)throw Error('invalid_image');
   const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
   return canvas.toDataURL('image/jpeg',.85);
  }finally{URL.revokeObjectURL(url);}
 }
 function controls(value){changing=value;document.querySelector('#chooseChatBackground').disabled=value;document.querySelector('#resetChatBackground').disabled=value;}
 document.querySelector('#chooseChatBackground').onclick=()=>document.querySelector('#chatBackgroundFile').click();
 document.querySelector('#chatBackgroundFile').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||changing)return;controls(true);const epoch=++revision;
  try{
   const value=await prepare(file);if(epoch!==revision)return;wallpaper=value;loaded=true;paint();
   try{await storage(true,value);message.textContent='聊天背景已保存到当前设备。';}catch{message.textContent='背景已应用，但此设备暂时无法保存。';}
  }catch(e){message.textContent=e.message==='invalid_image'?'图片无法读取，请选择其他图片。':e.message;}
  finally{controls(false);}
 };
 document.querySelector('#resetChatBackground').onclick=async()=>{
  if(changing)return;controls(true);revision++;wallpaper=null;loaded=true;paint();
  try{await storage(true,null);message.textContent='聊天背景已恢复跟随整体主题。';}
  catch{message.textContent='已恢复主题背景，但此设备暂时无法保存。';}
  finally{controls(false);}
 };
 return {setVisible};
})();

'use strict';
window.ZiweiChat=(()=>{
 const $=s=>document.querySelector(s);let token=null,version=0,loadVersion=0,events=null,attachments=[],quote=null,pending=null,before=null,favorite=false,trash=false,busy=false,uploading=0,queuedSend=false,uploadFailed=false,source='live',buffers=new Map(),active=new Map(),reloadTimer=null,startPromise=null,loadError='',lastRequest=null;
 const states={queued:'等待发送',dispatching:'正在送出',running:'知微正在回应',recovering:'恢复连接中',uncertain:'等待核对，请勿重复发送',completed:'已回复',failed:'处理失败',cancelled:'已结束',interrupted:'处理被中断',archived:'历史档案'};
 const errors={hermes_not_configured:'聊天尚未配置连接。',request_conflict:'此发送编号的内容不一致，已阻止重复执行。',queue_full:'待处理消息较多，请稍后再发送。',attachment_too_large:'附件超过 20 MB。',attachment_quota:'附件空间已满，请联系维护者。',active_file_rejected:'此文件类型暂不接受，请选择图片、视频或普通文档。'};
 async function request(url,method='GET',data,extra={}){
  const epoch=version,r=await fetch(url,{method,cache:'no-store',headers:{'X-Ziwei-CSRF':token,...(data?{'Content-Type':'application/json'}:{}),...extra.headers},body:data?JSON.stringify(data):extra.body});
  if(epoch!==version)throw Error('页面已锁定');
  if(r.status===401){stop();document.dispatchEvent(new Event('ziwei-session-expired'));throw Error('请重新登录。');}
  let o;try{o=await r.json();}catch{throw Error('服务响应异常，请稍后重试。');}if(!r.ok){const e=Error(errors[o.error]||'操作未完成，请稍后重试。');e.status=r.status;e.code=o.error;throw e;}return o;
 }
 function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
 function button(label,fn){const b=element('button','text-button',label);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(e=>$('#chatError').textContent=e.message);return b;}
 function timestamp(at){try{return new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short'}).format(new Date(at));}catch{return '时间未知';}}
 async function copy(text){
  try{await navigator.clipboard.writeText(text);return;}catch{}
  // Some Safari/embedded/headless contexts deny the asynchronous API despite a click.
  const old=document.activeElement,field=element('textarea','sr-only');field.value=text;field.setAttribute('aria-hidden','true');document.body.append(field);field.select();
  let copied=false;try{copied=document.execCommand('copy');}finally{field.remove();old?.focus();}
  if(!copied)throw Error('复制暂不可用，请长按文字复制。');
 }
 async function media(container,id){
  try{const epoch=version,a=await request('/api/chat/attachments/'+id+'/metadata');if(epoch!==version)return;const url='/api/chat/attachments/'+id;
   if(a.mime.startsWith('image/')){const img=element('img','message-media');img.src=url;img.alt=a.name;img.loading='lazy';container.append(img);}
   if(a.mime.startsWith('video/')){const video=element('video','message-media');video.src=url;video.controls=true;video.preload='metadata';video.playsInline=true;container.append(video);}
   const link=element('a','file-link',a.name+' · '+Math.ceil(a.size/1024)+' KB');link.href=url;link.download=a.name;container.append(link);
  }catch{}
 }
 function renderMessage(m){
  const card=element('article','message '+m.role+(m.source==='archive'?' archive':''));card.dataset.id=m.id;
  card.append(element('p','message-label',(m.source==='archive'?m.role==='user'?'历史用户':m.role==='assistant'?'历史助手':'原始档案':m.role==='user'?'你':'知微')+' · '+timestamp(m.created_at)+' · '+(states[m.status]||m.status)+(m.kind==='commentary'?' · 过程消息':'')+(m.favorite?' · ★':'')));
  if(m.source_ref)card.append(element('p','message-label','来源：'+m.source_ref));
  const bubble=element('div','message-bubble glass');if(m.quote)bubble.append(element('blockquote','message-quote',m.quote.content));const content=element('p','message-content',m.content.slice(0,5000));bubble.append(content);if(m.content.length>5000)bubble.append(button('展开完整记录',()=>{content.textContent=m.content;}));card.append(bubble);
  for(const id of m.attachments)void media(bubble,id);
  const actions=element('div','message-actions');
  if(m.source==='live'&&!m.deleted)actions.append(button('引用',()=>{quote=m;$('#chatQuote').hidden=false;$('#chatQuoteText').textContent=m.content.slice(0,120)||'附件消息';$('#chatInput').focus();}));
  actions.append(button('复制',async()=>{await copy(m.content);$('#chatError').textContent='已复制。';}),button(m.favorite?'取消收藏':'收藏',async()=>{await request('/api/chat/action','POST',{id:m.id,action:m.favorite?'unfavorite':'favorite'});await load();}));
  if(m.source==='live')actions.append(button(m.deleted?'恢复':'删除',async()=>{if(!m.deleted&&!confirm('将这条消息移入回收站？原始记录与知微已有上下文会保留。'))return;await request('/api/chat/action','POST',{id:m.id,action:m.deleted?'restore':'delete'});await load();}));
  card.append(actions);return card;
 }
 async function load(older=false){
  const epoch=version,loadEpoch=++loadVersion,params=new URLSearchParams({q:$('#chatSearch').value,source,favorite:String(favorite),trash:String(trash),limit:'50'});if(older&&before)params.set('before',before);
  const timeline=$('#chatTimeline'),list=$('#chatMessages'),height=timeline.scrollHeight,top=timeline.scrollTop,follow=!list.children.length||height-top-timeline.clientHeight<80;
  timeline.setAttribute('aria-busy','true');
  if(!list.children.length){$('#chatEmpty').hidden=false;$('#chatEmpty').textContent='正在加载聊天记录…';}
  try{
   const o=await request('/api/chat/messages?'+params);if(epoch!==version||loadEpoch!==loadVersion)return;
   if(!Array.isArray(o.data))throw Error('聊天记录格式异常，请重新加载。');
   const fragment=document.createDocumentFragment();o.data.forEach(m=>fragment.append(renderMessage(m)));
   if(older)list.prepend(fragment);else list.replaceChildren(fragment);
   before=o.before;$('#chatOlder').hidden=!o.hasMore;$('#chatEmpty').hidden=!!list.children.length;
   $('#chatEmpty').textContent=$('#chatSearch').value||favorite||trash?'没有符合条件的聊天记录。':source==='archive'?'还没有导入的历史档案。':'这里，留给我们慢慢说。';
   $('#chatRetry').hidden=true;if($('#chatError').textContent===loadError)$('#chatError').textContent='';loadError='';
   if(older)timeline.scrollTop=top+timeline.scrollHeight-height;else if(follow)timeline.scrollTop=timeline.scrollHeight;else timeline.scrollTop=top;
  }catch(e){
   if(epoch===version&&loadEpoch===loadVersion){loadError=e.message;$('#chatError').textContent=loadError;$('#chatRetry').hidden=false;$('#chatEmpty').hidden=!!list.children.length;$('#chatEmpty').textContent='聊天记录加载失败，请重新加载。';}
   throw e;
  }finally{if(epoch===version&&loadEpoch===loadVersion)timeline.setAttribute('aria-busy','false');}
 }
 function scheduleLoad(){clearTimeout(reloadTimer);const epoch=version;reloadTimer=setTimeout(()=>{if(epoch===version&&token)load().catch(()=>{});},150);}
 function progress(){const id=active.keys().next().value;$('#chatProgress').hidden=!pending&&!id;$('#chatProgressLabel').textContent=pending?'正在发送消息':'知微正在回应';$('#chatWork').textContent=pending?(busy?'正在发送…':'发送状态待确认，请勿重复发送'):states[active.get(id)]||'';$('#chatStreaming').textContent=id?buffers.get(id)||'':'';}
 function syncPeer(){const n=document.querySelector('#ziweiName');const t=document.querySelector('#chatPeer');if(n&&t&&n.textContent.trim())t.textContent=n.textContent.trim();}
 function chips(){
  $('#chatAttachments').replaceChildren();for(const a of attachments){const chip=element('span','attachment-chip',a.name+' ');chip.append(button('×',()=>{attachments=attachments.filter(x=>x.id!==a.id);chips();}));$('#chatAttachments').append(chip);}
 }
 function controls(){if(pending)$('#chatSendStatus').textContent=busy?'正在发送…':'发送状态待确认';syncPeer();const archive=source==='archive';$('#chatForm').hidden=archive;$('#archiveNotice').hidden=!archive;$('#chatSend').disabled=busy||!!pending;$('#chatSend').textContent=busy?'发送中…':pending?'待确认':'发送 ↑';$('#chatInput').disabled=busy||!!pending;$('#chatFiles').disabled=busy||uploading>0||!!pending;$('#chatRecover').hidden=!pending||busy;$('#chatRecover').disabled=busy;progress();}
 async function connection(){const s=await request('/api/chat/status');$('#chatConnection').textContent=!navigator.onLine?'已离线':!s.configured?'待接通':s.connected?'Hermes 已连接':'等待连接验证';}
 function subscribe(){
  if(events)events.close();events=new EventSource('/api/chat/events');const epoch=version,guard=fn=>e=>{if(token&&epoch===version)fn(e);};
  let opened=false;events.onopen=guard(()=>{if(opened){void load().catch(()=>{});void connection().catch(()=>{});}opened=true;});
  events.addEventListener('message.delta',guard(e=>{const o=JSON.parse(e.data);if(active.has(o.requestId)){buffers.set(o.requestId,(buffers.get(o.requestId)||'')+o.delta);progress();}}));
  events.addEventListener('message.saved',guard(()=>scheduleLoad()));events.addEventListener('timeline.changed',guard(()=>scheduleLoad()));
  events.addEventListener('request.state',guard(e=>{const o=JSON.parse(e.data);track(o.requestId,o.state);progress();scheduleLoad();}));
  events.addEventListener('request.notice',guard(e=>{$('#chatWork').textContent=JSON.parse(e.data).text;}));
  events.onerror=guard(()=>{$('#chatConnection').textContent=navigator.onLine?'正在恢复连接':'已离线';});
 }
 function track(id,state){if(id===lastRequest&&!pending)$('#chatSendStatus').textContent=state==='queued'?'已送达，等待知微回应':states[state]||state;if(['queued','dispatching','running','recovering','uncertain'].includes(state))active.set(id,state);else{active.delete(id);buffers.delete(id);}}
 async function deliver(){
  if(!pending||busy||!token)return;const epoch=version;busy=true;controls();$('#chatError').textContent='';
  try{const o=await request('/api/chat/send','POST',pending);if(epoch!==version)return;const id=pending.requestId;pending=null;track(id,o.state);attachments=[];quote=null;$('#chatQuote').hidden=true;$('#chatInput').value='';chips();progress();await load();$('#chatTimeline').scrollTop=$('#chatTimeline').scrollHeight;}
  catch(e){if(epoch!==version)return;if(!pending){$('#chatError').textContent='消息已被接收，但聊天记录未能刷新。请重新加载记录。';}else if([400,403,404,413].includes(e.status)||['queue_full','hermes_not_configured'].includes(e.code)){pending=null;$('#chatSendStatus').textContent='发送失败';$('#chatError').textContent=e.message;}else $('#chatError').textContent=e.message+' 发送状态尚未确认，请用同一编号核对；确认前请保持页面打开。';}
  finally{if(epoch===version){busy=false;controls();}}
 }
 function submitMessage(){if(!token||pending)return;if(uploading){queuedSend=true;$('#chatError').textContent='附件还在上传，完成后会自动发送。';return;}if(busy)return;const message=$('#chatInput').value;if(!message.trim()&&!attachments.length)return;pending={requestId:crypto.randomUUID(),message,attachments:attachments.map(a=>a.id),...(quote?{replyTo:quote.id}:{})};lastRequest=pending.requestId;void deliver();}
 $('#chatForm').onsubmit=e=>{e.preventDefault();submitMessage();};
 // 移动端 WebKit 在输入区被重排时可能不派发 form submit；直接绑定发送控件作为第二条路径，重复提交由 pending 兜底。
 $('#chatSend').onclick=e=>{e.preventDefault();submitMessage();};
 $('#chatRecover').onclick=()=>deliver();
 $('#chatRetry').onclick=()=>{if(token)void start(token);};
 $('#chatFiles').onchange=async e=>{
  const epoch=version,selected=[...e.target.files];e.target.value='';if(selected.length+attachments.length>6){$('#chatError').textContent='每条消息最多 6 个附件。';return;}
  uploading++;uploadFailed=false;controls();$('#chatError').textContent='';
  try{for(const file of selected){if(file.size>20*1024*1024)throw Error('附件超过 20 MB。');const a=await request('/api/chat/attachments','POST',null,{headers:{'X-Filename':encodeURIComponent(file.name),'Content-Type':'application/octet-stream'},body:file});if(epoch!==version)return;attachments.push(a);chips();}}
  catch(e){uploadFailed=true;if(epoch===version)$('#chatError').textContent=e.message;}finally{uploading=Math.max(0,uploading-1);const queued=queuedSend;queuedSend=false;if(epoch===version){controls();if(!uploading&&queued){if(uploadFailed)$('#chatError').textContent=($('#chatError').textContent||'附件上传失败。')+' 已取消自动发送，请检查附件后再发送。';else submitMessage();}}}
 };
 const st=$('#chatSearchToggle');if(st)st.onclick=()=>{const t=document.querySelector('#chatToolbar');if(!t)return;t.hidden=!t.hidden;st.setAttribute('aria-expanded',String(!t.hidden));if(t.hidden){$('#chatSearch').value='';scheduleLoad();}else $('#chatSearch').focus();};
 const cc=$('#chatCall');if(cc)cc.onclick=()=>window.alert('语音通话正在开发中，尚未接入实时语音服务。');
 $('#clearChatQuote').onclick=()=>{quote=null;$('#chatQuote').hidden=true;};
 $('#chatSource').onchange=()=>{source=$('#chatSource').value;before=null;trash=false;$('#chatTrash').setAttribute('aria-pressed','false');controls();load().catch(e=>$('#chatError').textContent=e.message);};
 $('#chatTrash').onclick=()=>{trash=!trash;favorite=false;source='live';$('#chatSource').value=source;$('#chatFavorites').setAttribute('aria-pressed','false');$('#chatTrash').setAttribute('aria-pressed',String(trash));controls();load().catch(()=>{});};
 $('#chatFavorites').onclick=()=>{favorite=!favorite;$('#chatFavorites').setAttribute('aria-pressed',String(favorite));load().catch(()=>{});};
 $('#chatSearch').oninput=()=>scheduleLoad();$('#chatOlder').onclick=()=>load(true).catch(()=>{});
 window.addEventListener('online',()=>{if(token){void start(token);if(pending)void deliver();}});window.addEventListener('offline',()=>{$('#chatConnection').textContent='已离线';});
 function stop(){window.ZiweiChatAppearance?.setVisible(false);version++;loadVersion++;token=null;startPromise=null;loadError='';lastRequest=null;$('#chatSendStatus').textContent='';events?.close();events=null;clearTimeout(reloadTimer);attachments=[];quote=null;pending=null;before=null;favorite=false;trash=false;source='live';busy=false;uploading=0;queuedSend=false;uploadFailed=false;active.clear();buffers.clear();$('#chatMessages').replaceChildren();$('#chatInput').value='';$('#chatSearch').value='';$('#chatSource').value='live';$('#chatFavorites').setAttribute('aria-pressed','false');$('#chatTrash').setAttribute('aria-pressed','false');$('#chatQuote').hidden=true;$('#chatError').textContent='';$('#chatStreaming').textContent='';$('#chatProgress').hidden=true;$('#chatEmpty').hidden=false;$('#chatEmpty').textContent='这里，留给我们慢慢说。';$('#chatRetry').hidden=true;$('#chatOlder').hidden=true;$('#chatTimeline').setAttribute('aria-busy','false');chips();controls();}
 async function start(csrf){
  if(!csrf)return;if(token!==csrf){stop();token=csrf;}window.ZiweiChatAppearance?.setVisible(true);syncPeer();if(startPromise)return startPromise;
  const epoch=version;
  // History must remain usable even when status checking or SSE is unavailable.
  const job=(async()=>{
   try{if(!events)subscribe();}catch{if(epoch===version)$('#chatConnection').textContent='实时连接暂不可用';}
   void connection().catch(()=>{if(epoch===version)$('#chatConnection').textContent='连接状态暂不可用';});
   void request('/api/chat/requests').then(r=>{if(epoch===version){r.data.forEach(x=>{lastRequest=x.id;track(x.id,x.state);});progress();}}).catch(()=>{});
   await load().catch(()=>{});
  })();
  startPromise=job;try{await job;}finally{if(epoch===version)startPromise=null;}
 }
 return {start,stop};
})();
