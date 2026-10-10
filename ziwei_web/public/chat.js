'use strict';
window.ZiweiChat=(()=>{
 const $=s=>document.querySelector(s);let token=null,version=0,loadVersion=0,events=null,attachments=[],quote=null,pending=null,before=null,favorite=false,trash=false,busy=false,source='live',buffers=new Map(),active=new Set(),reloadTimer=null;
 const states={queued:'等待发送',dispatching:'正在送出',running:'知微正在回应',recovering:'恢复连接中',uncertain:'等待核对，请勿重复发送',completed:'已回复',failed:'处理失败',cancelled:'已结束',interrupted:'处理被中断',archived:'历史档案'};
 const errors={hermes_not_configured:'聊天尚未配置连接。',request_conflict:'此发送编号的内容不一致，已阻止重复执行。',queue_full:'待处理消息较多，请稍后再发送。',attachment_too_large:'附件超过 20 MB。',attachment_quota:'附件空间已满，请联系维护者。',active_file_rejected:'此文件类型暂不接受，请选择图片、视频或普通文档。'};
 async function request(url,method='GET',data,extra={}){
  const epoch=version,r=await fetch(url,{method,cache:'no-store',headers:{'X-Ziwei-CSRF':token,...(data?{'Content-Type':'application/json'}:{}),...extra.headers},body:data?JSON.stringify(data):extra.body});
  if(epoch!==version)throw Error('页面已锁定');
  if(r.status===401){stop();document.dispatchEvent(new Event('ziwei-session-expired'));throw Error('请重新登录。');}
  const o=await r.json();if(!r.ok){const e=Error(errors[o.error]||'操作未完成，请稍后重试。');e.status=r.status;e.code=o.error;throw e;}return o;
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
  const o=await request('/api/chat/messages?'+params);if(epoch!==version||loadEpoch!==loadVersion)return;
  if(!older)$('#chatMessages').replaceChildren();
  const fragment=document.createDocumentFragment();o.data.forEach(m=>fragment.append(renderMessage(m)));if(older)$('#chatMessages').prepend(fragment);else $('#chatMessages').append(fragment);
  before=o.before;$('#chatOlder').hidden=!o.hasMore;$('#chatEmpty').hidden=!!$('#chatMessages').children.length;$('#chatEmpty').textContent=source==='archive'?'还没有导入的历史档案。':'这里，留给我们慢慢说。';
 }
 function scheduleLoad(){clearTimeout(reloadTimer);const epoch=version;reloadTimer=setTimeout(()=>{if(epoch===version&&token)load().catch(()=>{});},150);}
 function progress(){const id=[...active][0];$('#chatProgress').hidden=!id;$('#chatStreaming').textContent=id?buffers.get(id)||'':'';}
 function chips(){
  $('#chatAttachments').replaceChildren();for(const a of attachments){const chip=element('span','attachment-chip',a.name+' ');chip.append(button('×',()=>{attachments=attachments.filter(x=>x.id!==a.id);chips();}));$('#chatAttachments').append(chip);}
 }
 function controls(){const archive=source==='archive';$('#chatForm').hidden=archive;$('#archiveNotice').hidden=!archive;$('#chatSend').disabled=busy||!!pending;$('#chatInput').disabled=busy||!!pending;$('#chatFiles').disabled=busy||!!pending;$('#chatRecover').hidden=!pending;}
 async function connection(){const s=await request('/api/chat/status');$('#chatConnection').textContent=!navigator.onLine?'已离线':!s.configured?'待接通':s.connected?'Hermes 已连接':'等待连接验证';}
 function subscribe(){
  if(events)events.close();events=new EventSource('/api/chat/events');const epoch=version,guard=fn=>e=>{if(token&&epoch===version)fn(e);};
  events.addEventListener('message.delta',guard(e=>{const o=JSON.parse(e.data);if(active.has(o.requestId)){buffers.set(o.requestId,(buffers.get(o.requestId)||'')+o.delta);progress();}}));
  events.addEventListener('message.saved',guard(()=>scheduleLoad()));events.addEventListener('timeline.changed',guard(()=>scheduleLoad()));
  events.addEventListener('request.state',guard(e=>{const o=JSON.parse(e.data);if(['queued','dispatching','running','recovering','uncertain'].includes(o.state)){active.add(o.requestId);$('#chatWork').textContent=states[o.state];}else{active.delete(o.requestId);buffers.delete(o.requestId);void connection().catch(()=>{});}progress();scheduleLoad();}));
  events.addEventListener('request.notice',guard(e=>{$('#chatWork').textContent=JSON.parse(e.data).text;}));
  events.onerror=guard(()=>{$('#chatConnection').textContent=navigator.onLine?'正在恢复连接':'已离线';});
 }
 async function deliver(){
  if(!pending)return;busy=true;controls();$('#chatError').textContent='';
  try{await request('/api/chat/send','POST',pending);pending=null;attachments=[];quote=null;$('#chatQuote').hidden=true;$('#chatInput').value='';chips();await load();}
  catch(e){if([400,403,404,413].includes(e.status)||['queue_full','hermes_not_configured'].includes(e.code)){pending=null;$('#chatError').textContent=e.message;}else $('#chatError').textContent=e.message+' 发送状态尚未确认，请用同一编号核对；确认前请保持页面打开。';}
  finally{busy=false;controls();}
 }
 function submitMessage(){if(busy||pending)return;const message=$('#chatInput').value;if(!message.trim()&&!attachments.length)return;pending={requestId:crypto.randomUUID(),message,attachments:attachments.map(a=>a.id),...(quote?{replyTo:quote.id}:{})};void deliver();}
 $('#chatForm').onsubmit=e=>{e.preventDefault();submitMessage();};
 // Handle the send control directly as well: mobile WebKit may not dispatch a
 // form submit when the compact composer is rearranged during keyboard focus.
 $('#chatSend').onclick=e=>{e.preventDefault();submitMessage();};
 $('#chatRecover').onclick=()=>deliver();
 $('#chatFiles').onchange=async e=>{
  const epoch=version,selected=[...e.target.files];e.target.value='';if(selected.length+attachments.length>6){$('#chatError').textContent='每条消息最多 6 个附件。';return;}
  busy=true;controls();$('#chatError').textContent='';
  try{for(const file of selected){if(file.size>20*1024*1024)throw Error('附件超过 20 MB。');const a=await request('/api/chat/attachments','POST',null,{headers:{'X-Filename':encodeURIComponent(file.name),'Content-Type':'application/octet-stream'},body:file});if(epoch!==version)return;attachments.push(a);chips();}}
  catch(e){if(epoch===version)$('#chatError').textContent=e.message;}finally{if(epoch===version){busy=false;controls();}}
 };
 $('#clearChatQuote').onclick=()=>{quote=null;$('#chatQuote').hidden=true;};
 $('#chatSource').onchange=()=>{source=$('#chatSource').value;before=null;trash=false;$('#chatTrash').setAttribute('aria-pressed','false');controls();load().catch(e=>$('#chatError').textContent=e.message);};
 $('#chatTrash').onclick=()=>{trash=!trash;favorite=false;source='live';$('#chatSource').value=source;$('#chatFavorites').setAttribute('aria-pressed','false');$('#chatTrash').setAttribute('aria-pressed',String(trash));controls();load().catch(()=>{});};
 $('#chatFavorites').onclick=()=>{favorite=!favorite;$('#chatFavorites').setAttribute('aria-pressed',String(favorite));load().catch(()=>{});};
 const searchPanel=$('#chatToolbar');
 function toggleSearch(force){
  const open=typeof force==='boolean'?force:searchPanel.hidden;
  searchPanel.hidden=!open;
  $('#chatSearchToggle').setAttribute('aria-expanded',String(open));
  $('#chatMore').setAttribute('aria-expanded',String(open));
  if(open)$('#chatSearch').focus();
 }
 $('#chatSearchToggle').onclick=()=>toggleSearch();
 $('#chatMore').onclick=()=>toggleSearch();
 $('#chatCall').onclick=()=>window.alert('语音通话正在开发中，尚未接入实时语音服务。');
 $('#chatInput').addEventListener('input',()=>{
  const el=$('#chatInput');el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';
 });
 $('#chatSearch').oninput=()=>scheduleLoad();$('#chatOlder').onclick=()=>load(true).catch(()=>{});
 window.addEventListener('online',()=>{if(token){void connection().catch(()=>{});if(pending)void deliver();}});window.addEventListener('offline',()=>{$('#chatConnection').textContent='已离线';});
 function stop(){version++;token=null;events?.close();events=null;clearTimeout(reloadTimer);attachments=[];quote=null;pending=null;busy=false;active.clear();buffers.clear();$('#chatMessages').replaceChildren();$('#chatInput').value='';$('#chatSearch').value='';$('#chatQuote').hidden=true;$('#chatError').textContent='';$('#chatStreaming').textContent='';$('#chatProgress').hidden=true;chips();controls();}
 async function start(csrf){if(token===csrf)return;stop();token=csrf;const epoch=version;try{await load();const r=await request('/api/chat/requests');if(epoch!==version)return;r.data.forEach(x=>active.add(x.id));progress();await connection();if(epoch===version)subscribe();}catch(e){if(epoch===version)$('#chatError').textContent=e.message;}}
 return {start,stop};
})();
