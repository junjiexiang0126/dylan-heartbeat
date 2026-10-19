'use strict';
window.ZiweiChatAppearance=(()=>{
 const layer=document.querySelector('#chatWallpaper'),image=document.querySelector('#chatWallpaperImage');
 const actions=document.querySelector('#chatTopActions'),message=document.querySelector('#chatBackgroundMessage');
 let visible=false,wallpaper=null,loaded=false,revision=0,loading=null,changing=false;
 function paint(){
  document.body.classList.toggle('chat-view',visible);
  document.body.classList.toggle('chat-has-wallpaper',visible&&!!wallpaper);
  actions.hidden=!visible;document.querySelector('#chatAvatar').hidden=!visible;document.querySelector('#chatHeaderTitle').hidden=!visible;document.querySelector('.brand').hidden=visible;layer.hidden=!visible||!wallpaper;
  image.src=visible&&wallpaper?wallpaper:'';
 }
 function storage(write,value,key='wallpaper'){return new Promise((resolve,reject)=>{
  const open=indexedDB.open('ziwei-chat-appearance',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('preferences');
  open.onerror=()=>reject(open.error);open.onblocked=()=>reject(Error('storage_unavailable'));
  open.onsuccess=()=>{
   const db=open.result,tx=db.transaction('preferences',write?'readwrite':'readonly'),store=tx.objectStore('preferences');
   const request=write?(value?store.put(value,key):store.delete(key)):store.get(key);
   tx.oncomplete=()=>{db.close();resolve(request.result);};
   tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('storage_unavailable'));};
  };
 });}
 const fontInput=document.querySelector('#chatFontSize'),fontOutput=document.querySelector('#chatFontValue'),fontMessage=document.querySelector('#chatFontMessage');
 let fontRevision=0,fontSave=Promise.resolve();
 function applyFont(value){const size=Number(value);if(!Number.isInteger(size)||size<12||size>20)return;for(const id of ['chat','work'])document.getElementById(id)?.style.setProperty('--chat-font-size',size+'px');fontInput.value=String(size);fontInput.defaultValue=String(size);fontOutput.value=size+' px';fontOutput.defaultValue=size+' px';document.querySelector('#chatFontPreview').style.fontSize=size+'px';}
 function saveFont(){const size=Number(fontInput.value),epoch=fontRevision;fontMessage.textContent='正在保存字号…';fontSave=fontSave.catch(()=>{}).then(()=>storage(true,size,'fontSize')).then(()=>{if(epoch===fontRevision)fontMessage.textContent='字号已保存到当前设备。';}).catch(()=>{if(epoch===fontRevision)fontMessage.textContent='字号已应用，但此设备暂时无法保存。';});}
 fontInput.oninput=()=>{fontRevision++;applyFont(fontInput.value);fontMessage.textContent='字号已应用。';};fontInput.onchange=saveFont;
 document.querySelector('#resetChatFont').onclick=()=>{fontRevision++;applyFont(14);saveFont();};
 const fontEpoch=fontRevision;applyFont(14);storage(false,null,'fontSize').then(value=>{if(fontEpoch===fontRevision&&value!==undefined)applyFont(value);}).catch(()=>{});
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
 const $=s=>document.querySelector(s);let token=null,version=0,loadVersion=0,events=null,attachments=[],quote=null,pending=null,before=null,favorite=false,trash=false,busy=false,uploading=0,queuedSend=false,uploadFailed=false,source='live',buffers=new Map(),active=new Map(),reloadTimer=null,startPromise=null,loadError='',lastRequest=null,recorder=null,recordStream=null,listening=false,voiceTimer=null,layoutFrame=null,voiceEpoch=0,voiceDraft=null,voiceUploading=false,profileData={user:{nickname:'你',avatar:null},ziwei:{nickname:'知微',avatar:null}},connectionTimer=null,voiceMeter=null,voicePress=null;
 const renderedMessages=new WeakMap(),messageActionRows=new WeakMap();let viewKey=null,readingPosition=null,lastEventCursor=null;
 const states={queued:'等待发送',dispatching:'正在送出',running:'知微正在回应',recovering:'恢复连接中',uncertain:'等待核对，请勿重复发送',completed:'已回复',failed:'处理失败',cancelled:'已结束',interrupted:'处理被中断',archived:'历史档案'};
 const errors={speech_not_allowed:'这条消息没有可朗读的文字。',speech_unavailable:'暂时无法生成语音，请稍后重试。',speech_busy:'正在生成其他语音，请稍后重试。',speech_text_limit:'这条回复超过语音长度上限。',approval_expired:'批准请求已过期。',hermes_not_configured:'聊天尚未配置连接。',request_conflict:'此发送编号的内容不一致，已阻止重复执行。',queue_full:'待处理消息较多，请稍后再发送。',attachment_too_large:'附件超过 20 MB。',attachment_quota:'附件空间已满，请联系维护者。',active_file_rejected:'此文件类型暂不接受，请选择图片、视频或普通文档。'};
 async function request(url,method='GET',data,extra={}){
  const epoch=version,r=await fetch(url,{method,cache:'no-store',headers:{'X-Ziwei-CSRF':token,...(data?{'Content-Type':'application/json'}:{}),...extra.headers},body:data?JSON.stringify(data):extra.body});
  if(epoch!==version)throw Error('页面已锁定');
  if(r.status===401){stop();document.dispatchEvent(new Event('ziwei-session-expired'));throw Error('请重新登录。');}
  let o;try{o=await r.json();}catch{throw Error('服务响应异常，请稍后重试。');}if(!r.ok){const e=Error(errors[o.error]||'操作未完成，请稍后重试。');e.status=r.status;e.code=o.error;throw e;}return o;
 }
 function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
 function button(label,fn){const b=element('button','text-button',label);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(e=>$('#chatError').textContent=e.message);return b;}
 function timestamp(at){try{return new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'medium',hour12:false,timeZone:'Asia/Bangkok'}).format(new Date(at));}catch{return '时间未知';}}
 async function copy(text){
  try{await navigator.clipboard.writeText(text);return;}catch{}
  // Some Safari/embedded/headless contexts deny the asynchronous API despite a click.
  const old=document.activeElement,field=element('textarea','sr-only');field.value=text;field.setAttribute('aria-hidden','true');document.body.append(field);field.select();
  let copied=false;try{copied=document.execCommand('copy');}finally{field.remove();old?.focus();}
  if(!copied)throw Error('复制暂不可用，请长按文字复制。');
 }
 async function media(container,id){
  try{const epoch=version,a=await request('/api/chat/attachments/'+id+'/metadata');if(epoch!==version)return;const url='/api/chat/attachments/'+id;
   if(a.mime.startsWith('image/')){const img=element('img','message-media');img.src=url;img.alt=a.name;img.loading='lazy';img.tabIndex=0;img.setAttribute('role','button');img.onclick=()=>window.ZiweiChatExtra?.showImage(img);img.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();img.click();}};img.onerror=()=>{if(!img.nextElementSibling?.classList.contains('media-retry')){const retry=button('图片读取失败，点此重试',()=>{img.src=url+'?retry='+Date.now();retry.remove();});retry.classList.add('media-retry');container.insertBefore(retry,img.nextSibling);}};container.append(img);}
   if(a.mime.startsWith('video/')){const video=element('video','message-media');video.src=url;video.controls=true;video.preload='metadata';video.playsInline=true;container.append(video);}
   if(a.mime.startsWith('audio/')){container.append(window.ZiweiVoiceUI.player(url,a.name,stopAudio));return;}
   const link=element('a','file-link file-card');link.href=url;link.download=a.name;link.setAttribute('aria-label','下载文件：'+a.name);
   // 关键修复：文件卡片以前是「同页跳转下载」——iOS PWA 跳出去就回不来（她只能杀 App）。
   // 现在统一走 save-file.js：优先系统分享面板，其次新标签页，主页面永不离开。
   link.onclick=e=>{e.preventDefault();window.ZiweiFiles.open(url,a.name,a.mime);};
   const icon=element('span','file-card-icon','▤'),details=element('span','file-card-details');icon.setAttribute('aria-hidden','true');details.append(element('strong','file-card-name',a.name),element('small','file-card-size',a.size<1024?a.size+' B':Math.ceil(a.size/1024)+' KB'));link.append(icon,details,element('span','file-card-download','查看 / 保存'));if(!/^(image|video)\//.test(a.mime))container.append(link);
  }catch{if(container.isConnected){const retry=button('附件读取失败，点此重试',()=>{retry.remove();return media(container,id);});retry.classList.add('media-retry');container.append(retry);}}
 }
 function messageLabel(m){return (m.source==='archive'?m.role==='user'?'历史用户':m.role==='assistant'?'历史助手':'原始档案':m.role==='user'?'你':'知微')+' · '+timestamp(m.created_at)+(m.role==='assistant'&&m.status==='completed'?'':' · '+(states[m.status]||m.status))+(m.kind==='commentary'?' · 执行进度':m.kind==='summary'?' · 回复摘要':'')+(m.favorite?' · ★':'');}
 function rememberMessage(card,m){renderedMessages.set(card,{full:JSON.stringify(m),group:!m.deleted&&['user','assistant'].includes(m.role)&&!['poke','summary','commentary'].includes(m.kind)&&['completed','archived'].includes(m.status)?JSON.stringify([m.role,m.source,m.source_ref||'']):null,withoutStatus:JSON.stringify({...m,status:null,toolActions:undefined})});}
 function renderToolActions(card,rows=[]){let box=card.querySelector('.tool-action-log');if(!rows.length){box?.remove();return;}const open=box?.open||false;box?.remove();box=element('details','tool-action-log');box.open=open;const elapsed=rows.reduce((sum,r)=>sum+(r.elapsedMs||0),0),unfinished=rows.filter(r=>r.state!=='completed').length;box.append(element('summary','', '做了 '+rows.length+' 个动作 · 共 '+(elapsed/1000).toFixed(1)+'s'+(unfinished?' · '+unfinished+' 项未完成':'')));const list=element('ol','tool-action-list');for(const r of rows){const item=element('li','');item.append(element('strong','',r.label||r.tool),element('span','',r.preview||'未提供预览'),element('span','',r.state==='completed'?'✓':r.state==='failed'?'失败 · 未完成':'未完成'),element('time','',r.elapsedMs===null||r.elapsedMs===undefined?'耗时待确认':(r.elapsedMs/1000).toFixed(1)+'s'));list.append(item);}box.append(list);const host=card.querySelector('.message-body')||card,bubble=host.querySelector('.message-bubble');if(bubble)host.insertBefore(box,bubble);else host.prepend(box);}
 function paintMessageAvatar(el,role){const profile=role==='user'?profileData.user:role==='assistant'?profileData.ziwei:{nickname:'原始档案',avatar:null};el.replaceChildren();el.removeAttribute('role');el.removeAttribute('aria-label');if(profile.avatar){const img=element('img');img.src=profile.avatar;img.alt=profile.nickname+'的头像';el.append(img);}else{el.textContent=[...profile.nickname][0]||'微';el.setAttribute('role','img');el.setAttribute('aria-label',profile.nickname+'的头像');}}
 function setProfiles(profiles){for(const who of ['user','ziwei'])if(profiles?.[who])profileData[who]={nickname:profiles[who].nickname||(who==='user'?'你':'知微'),avatar:profiles[who].avatar||null};document.querySelectorAll('#chatMessages .message-avatar').forEach(el=>paintMessageAvatar(el,el.dataset.role));window.ZiweiChatCall?.setProfile(profileData.ziwei);}
 function renderMessage(m){
  if(m.kind==='poke'){const card=element('article','chat-poke-event');card.dataset.id=m.id;card.append(element('p','message-label',timestamp(m.created_at)),element('p','',m.content));rememberMessage(card,m);return card;}
  const card=element('article','message '+m.role+(m.source==='archive'?' archive':''));card.dataset.id=m.id;card.dataset.kind=m.kind||'final';
  const avatar=element('div','message-avatar'),body=element('div','message-body');avatar.dataset.role=m.role;paintMessageAvatar(avatar,m.role);card.append(avatar,body);
  body.append(element('p','message-label message-sender-label',messageLabel(m)));
  if(m.source_ref)body.append(element('p','message-label','来源：'+m.source_ref));
  const missingMedia=m.role==='assistant'&&(/MEDIA:|\/workspace\/outbox\//.test(m.content))&&m.mediaDelivery?.state!=='complete';
  const display=m.role==='assistant'?m.content.replace(/\[\[audio_as_voice\]\]/g,'').replace(/^\s*MEDIA:.*$/gm,'').trim():m.content;
  const bubble=element('div','message-bubble glass');if(m.kind==='summary'||m.kind==='commentary'){const detail=element('details','chat-process-details');const heading=element('summary','',m.kind==='summary'?'知微的回复摘要':'知微的执行进度');const bodyText=element('div','message-content');window.ZiweiChatRender.text(bodyText,m.content);detail.append(heading,bodyText);bubble.append(detail);body.append(bubble);rememberMessage(card,m);return card;}if(m.quote)bubble.append(element('blockquote','message-quote',m.quote.content));const content=element('div','message-content');window.ZiweiChatRender.text(content,display.slice(0,5000));bubble.append(content);if(display.length>5000)bubble.append(button('展开完整记录',()=>{window.ZiweiChatRender.text(content,display);}));body.append(bubble);
  for(const id of m.attachments)void media(bubble,id);
  if(m.role==='assistant'&&m.source==='live'&&(missingMedia||['failed','partial'].includes(m.mediaDelivery?.state))){
   const box=element('div','file-delivery'),status=element('p','file-delivery-status');status.setAttribute('role','status');
   const reasons={media_protocol_incompatible:'原生接口尚未识别这条分段回复内的附件标记，重复重试不会生成文件；需要知微将 MEDIA:绝对路径单独成行重新发送',media_file_missing:'原文件暂时找不到',media_path_not_allowed:'文件位置或大小不符合回传要求',media_file_unreadable:'原文件无法读取',media_type_not_supported:'暂不支持此文件类型',media_integrity:'文件校验失败',media_not_registered:'回复中的文件尚未登记为附件',attachment_quota:'附件存储空间已满'};
   status.textContent=(m.mediaDelivery?.state==='partial'?'部分附件尚未收到：':'附件尚未收到：')+(reasons[m.mediaDelivery?.error]||'文件回传未完成')+'。';
   const retry=button('重试接收附件',async()=>{const epoch=version;retry.disabled=true;status.textContent='正在接收附件…';try{const o=await request('/api/chat/media/sync','POST',{messageId:m.id});if(epoch!==version)return;await load();if(!o.ok&&box.isConnected)status.textContent='附件尚未收到：'+(reasons[o.data?.[0]?.error||m.mediaDelivery?.error]||'文件回传未完成')+'。';}catch(e){if(epoch===version&&box.isConnected)status.textContent='附件接收失败，请稍后重试。';}finally{if(epoch===version)retry.disabled=false;}});box.append(status,retry);bubble.append(box);
  }
  const actions=element('div','message-actions');
  if(m.source==='live'&&m.role==='assistant')actions.append(button('拍一拍',()=>window.ZiweiPoke?.send('ziwei')));
  if(m.source==='live'&&!m.deleted)actions.append(button('引用',()=>{quote=m;$('#chatQuote').hidden=false;$('#chatQuoteText').textContent=m.content.slice(0,120)||'附件消息';$('#chatInput').focus();}));
  actions.append(button('复制',async()=>{await copy(m.content);$('#chatError').textContent='已复制。';}),button(m.favorite?'取消收藏':'收藏',async()=>{await request('/api/chat/action','POST',{id:m.id,action:m.favorite?'unfavorite':'favorite'});await load();}));
  if(m.source==='live')actions.append(button(m.deleted?'恢复':'删除',async()=>{if(!m.deleted&&!confirm('将这条消息移入回收站？原始记录与知微已有上下文会保留。'))return;await request('/api/chat/action','POST',{id:m.id,action:m.deleted?'restore':'delete'});await load();}));
  if(m.role==='assistant'&&m.status==='completed'&&m.content.trim()&&!['commentary','summary'].includes(m.kind))actions.append(button('朗读回复',async()=>{const epoch=version,a=await request('/api/chat/speech','POST',{messageId:m.id});if(epoch===version&&!bubble.querySelector('[data-reading]')){const box=element('div');box.dataset.reading='true';bubble.append(box);await media(box,a.id);}}));
  if(m.role==='user'&&m.status==='failed'&&m.source==='live')actions.append(button('重新发送',async()=>{if(pending||busy)throw Error('请先确认当前发送状态。');attachments=[];for(const id of m.attachments)attachments.push(await request('/api/chat/attachments/'+id+'/metadata'));$('#chatInput').value=m.content;chips();$('#chatError').textContent='内容与原录音已准备好，核对后点纸飞机重新发送。';compose();}));
  window.ZiweiChatRender.actions(actions);messageActionRows.set(card,actions);body.append(actions);renderToolActions(card,m.toolActions);rememberMessage(card,m);return card;
 }
 function groupMessages(list){
  const cards=[...list.children],same=(a,b)=>{const key=a&&renderedMessages.get(a)?.group;return !!key&&key===renderedMessages.get(b)?.group;};
  cards.forEach((card,i)=>{const next=same(card,cards[i+1]);card.classList.toggle('same-sender',same(card,cards[i-1]));card.classList.toggle('has-next-sender',next);const row=messageActionRows.get(card);if(!row)return;if(next)row.remove();else if(!row.isConnected)card.querySelector('.message-body').append(row);});
 }
 async function load(older=false,retain=false){
  const epoch=version,loadEpoch=++loadVersion,params=new URLSearchParams({q:$('#chatSearch').value,source,favorite:String(favorite),trash:String(trash),limit:'100'});if(older&&before)params.set('before',before);
  const timeline=$('#chatTimeline'),list=$('#chatMessages'),height=timeline.scrollHeight,key=JSON.stringify([source,$('#chatSearch').value,favorite,trash]),same=key===viewKey,top=retain&&same&&readingPosition?readingPosition.top:timeline.scrollTop,follow=!list.children.length||(!same&&!older)||(retain&&same&&readingPosition?readingPosition.follow:height-top-timeline.clientHeight<80);const wasMore=!$('#chatOlder').hidden;
  timeline.setAttribute('aria-busy','true');
  if(!list.children.length){$('#chatEmpty').hidden=false;$('#chatEmpty').textContent='正在加载聊天记录…';}
  try{
   const o=await request('/api/chat/messages?'+params);if(epoch!==version||loadEpoch!==loadVersion)return;
   if(!Array.isArray(o.data))throw Error('聊天记录格式异常，请重新加载。');if(Number.isSafeInteger(o.eventCursor))lastEventCursor=o.eventCursor;if(Array.isArray(o.requests)){active.clear();for(const r of o.requests){if(!lastRequest)lastRequest=r.id;track(r.id,r.state);}for(const m of o.data)if(m.request_id&&['completed','failed','cancelled','interrupted'].includes(m.status))track(m.request_id,m.status);progress();}
   // Reconnects and status events must not recreate an unchanged media player.
   const existing=new Map([...list.children].map(card=>[card.dataset.id,card]));
   let arrival=0;let cards=o.data.map(m=>{const card=existing.get(m.id),previous=card&&renderedMessages.get(card);if(previous?.full===JSON.stringify(m))return card;if(previous?.withoutStatus===JSON.stringify({...m,status:null,toolActions:undefined})){card.querySelector('.message-label').textContent=m.kind==='poke'?timestamp(m.created_at):messageLabel(m);renderToolActions(card,m.toolActions);rememberMessage(card,m);return card;}const next=renderMessage(m);if(!older&&same&&existing.size&&m.role==='assistant'&&m.kind==='final'){next.classList.add('message-arrival');next.style.setProperty('--bubble-arrival-index',String(arrival++));}return next;});
   let keptOlder=false;if(retain&&same&&o.data.length){const first=o.data[0],cut=Date.parse(first.created_at);const keep=[...list.children].filter(card=>{const m=JSON.parse(renderedMessages.get(card)?.full||'{}');return Number.isFinite(m.seq)&&(Date.parse(m.created_at)<cut||Date.parse(m.created_at)===cut&&m.seq<first.seq);});keptOlder=keep.length>0;cards=[...keep,...cards];}
   if(older){const fragment=document.createDocumentFragment();for(const card of cards)if(!existing.has(card.dataset.id))fragment.append(card);list.prepend(fragment);}
   else{let cursor=list.firstElementChild;for(const card of cards){if(card===cursor)cursor=cursor.nextElementSibling;else list.insertBefore(card,cursor);}while(cursor){const next=cursor.nextElementSibling;cursor.querySelectorAll('audio').forEach(a=>a.pause());cursor.remove();cursor=next;}}

   groupMessages(list);
   if(!older&&source==='live'&&!$('#chatSearch').value&&!favorite&&!trash)responseNotice(o.data);
   if(!keptOlder)before=o.before;$('#chatOlder').hidden=keptOlder?!wasMore:!o.hasMore;viewKey=key;$('#chatEmpty').hidden=!!list.children.length;
   $('#chatEmpty').textContent=$('#chatSearch').value||favorite||trash?'没有符合条件的聊天记录。':source==='archive'?'还没有导入的历史档案。':'这里，留给我们慢慢说。';
   $('#chatRetry').hidden=true;if($('#chatError').textContent===loadError)$('#chatError').textContent='';loadError='';
   if(older)timeline.scrollTop=top+timeline.scrollHeight-height;else if(follow)timeline.scrollTop=timeline.scrollHeight;else timeline.scrollTop=top;readingPosition=null;
  }catch(e){
   if(epoch===version&&loadEpoch===loadVersion){loadError=e.message;$('#chatError').textContent=loadError;$('#chatRetry').hidden=false;$('#chatEmpty').hidden=!!list.children.length;$('#chatEmpty').textContent='聊天记录加载失败，请重新加载。';}
   throw e;
  }finally{if(epoch===version&&loadEpoch===loadVersion)timeline.setAttribute('aria-busy','false');}
 }
 window.addEventListener('ziwei-poke-saved',()=>{if(token)scheduleLoad();});
 function scheduleLoad(retain=true){clearTimeout(reloadTimer);const epoch=version;reloadTimer=setTimeout(()=>{if(epoch===version&&token&&!$('#chat').hidden)load(false,retain).catch(()=>{});},150);}
 function progress(){const id=active.keys().next().value;$('#chatProgress').hidden=!pending&&!id;$('#chatProgressLabel').textContent=pending?'正在发送消息':'知微正在回应';$('#chatWork').textContent=pending?(busy?'正在发送…':'发送状态待确认，请勿重复发送'):states[active.get(id)]||'';const stream=id?buffers.get(id)||'':'';$('#chatStreaming').textContent=/^\s*(?:\{|```(?:json)?\s*\n\s*\{)/.test(stream)?'':stream;}
 function syncPeer(){const n=document.querySelector('#ziweiName');const t=document.querySelector('#chatPeer');if(n&&t&&n.textContent.trim())t.textContent=n.textContent.trim();}
 function chips(){
  $('#chatAttachments').replaceChildren();for(const a of attachments){const chip=element('span','attachment-chip',a.name+' ');chip.append(button('×',()=>{attachments=attachments.filter(x=>x.id!==a.id);chips();}));$('#chatAttachments').append(chip);}
 }
 function layout(){
  cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{
   const panel=$('#chat');if(panel.hidden||!token)return;
   const viewport=window.visualViewport,bottom=viewport?viewport.offsetTop+viewport.height:innerHeight;
   const nav=document.querySelector('nav').getBoundingClientRect(),top=panel.getBoundingClientRect().top;
   panel.style.height=Math.max(0,Math.min(nav.top,bottom)-8-top)+'px';
  });
 }
 function compose(){
  const form=$('#chatForm'),input=$('#chatInput'),editing=document.activeElement===input;
  form.classList.toggle('is-editing',editing);form.style.setProperty('--compose-row',quote?'2':'1');
  form.style.setProperty('--actions-row',String((quote?2:1)+(editing?1:0)));
  input.style.height=editing?'auto':'36px';if(editing)input.style.height=Math.min(112,Math.max(64,input.scrollHeight))+'px';
  layout();
 }
 function time(n){n=Math.max(0,Math.floor(n||0));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
 function stopAudio(except=null){document.querySelectorAll('#chatMessages audio').forEach(a=>{if(a!==except)a.pause();});}
 function clearVoice(){voiceDraft=null;$('#chatVoiceDraft').hidden=true;}
 function stopVoice(){
  voiceEpoch++;voicePress=null;voiceMeter?.stop();voiceMeter=null;const old=recorder;recorder=null;listening=false;clearInterval(voiceTimer);voiceTimer=null;
  if(old&&old.state!=='inactive'){try{old.stop();}catch{}}
  recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;clearVoice();stopAudio();voiceUploading=false;$('#chatVoiceHint').textContent='';controls();
 }
 $('#chatInput').addEventListener('focus',compose);$('#chatInput').addEventListener('blur',compose);$('#chatInput').addEventListener('input',compose);
 window.addEventListener('resize',layout);window.visualViewport?.addEventListener('resize',layout);window.visualViewport?.addEventListener('scroll',layout);
 if(window.ResizeObserver)new ResizeObserver(layout).observe(document.querySelector('nav'));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVoice();});
 const add=$('label[for=chatFiles]');add.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#chatFiles').click();}};
 $('#chatVoiceCancel').onclick=()=>{stopVoice();$('#chatVoiceHint').textContent='语音已取消。';};
 $('#chatVoice').title='按住说话，松手发送，上滑取消';
 async function beginVoice(press){
  if($('#chat').hidden||document.hidden||!token||busy||pending||voiceUploading||uploading||listening||voiceDraft)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('#chatVoiceHint').textContent='此浏览器暂不支持录音，请用支持录音的浏览器打开。';return;}
  voicePress=press;const epoch=version,attempt=++voiceEpoch;listening=true;controls();$('#chatVoiceHint').textContent='正在请求麦克风权限，请保持按住…';voiceMeter=window.ZiweiVoiceUI.meter();
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   if(epoch!==version||attempt!==voiceEpoch||voicePress!==press||!token){stream.getTracks().forEach(t=>t.stop());return;}
   recordStream=stream;voiceMeter?.connect(stream);const mime=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
   const r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];let bytes=0;const began=Date.now();recorder=r;
   const valid=()=>epoch===version&&attempt===voiceEpoch&&token;
   r.ondataavailable=e=>{if(!valid()||!e.data.size)return;bytes+=e.data.size;if(bytes>20*1024*1024){stopVoice();$('#chatVoiceHint').textContent='语音超过 20 MB，已取消录音。';return;}chunks.push(e.data);};
   r.onerror=()=>{if(valid()){stopVoice();$('#chatVoiceHint').textContent='录音失败，请重试。';}};
   r.onstop=()=>{
    if(!valid())return;clearInterval(voiceTimer);voiceTimer=null;recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;recorder=null;listening=false;voicePress=null;voiceMeter?.stop();voiceMeter=null;
    const type=r.mimeType||mime||'audio/webm',blob=new Blob(chunks,{type}),seconds=(Date.now()-began)/1000;
    if(!blob.size){$('#chatVoiceHint').textContent='未录到声音，请按住再说一次。';controls();return;}
    const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'weba';
    voiceDraft={blob,name:'voice-'+crypto.randomUUID()+'.'+ext,seconds};$('#chatVoiceDuration').textContent='语音 '+Math.ceil(seconds)+'″';controls();void uploadVoice();
   };
   const tick=()=>{const elapsed=(Date.now()-began)/1000;voiceMeter?.time(time(elapsed));if(elapsed>=300&&r.state==='recording')r.stop();};
   r.start(250);tick();voiceTimer=setInterval(tick,250);$('#chatVoiceHint').textContent='按住说话，松手发送，上滑取消。';
  }catch(e){if(epoch===version&&attempt===voiceEpoch){stopVoice();$('#chatVoiceHint').textContent=e.name==='NotAllowedError'?'未获得麦克风权限，请检查浏览器设置。':'无法启动录音，请检查麦克风并重试。';}}
 }
 $('#chatVoice').onclick=e=>e.preventDefault();
 $('#chatVoice').addEventListener('contextmenu',e=>e.preventDefault());
 $('#chatVoice').addEventListener('pointerdown',e=>{if(e.button!==0||voicePress)return;e.preventDefault();const press={id:e.pointerId,y:e.clientY};try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}void beginVoice(press);});
 $('#chatVoice').addEventListener('pointermove',e=>{if(voicePress?.id===e.pointerId&&e.clientY<voicePress.y-60){voiceMeter?.cancel();stopVoice();$('#chatVoiceHint').textContent='已上滑取消语音，不会发送。';}});
 function releaseVoice(e){if(!voicePress||e.pointerId!==undefined&&voicePress.id!==e.pointerId)return;voicePress=null;if(e.type==='pointercancel'||e.type==='lostpointercapture'){stopVoice();$('#chatVoiceHint').textContent='语音已取消。';return;}if(recorder?.state==='recording'){recorder.stop();}else{stopVoice();$('#chatVoiceHint').textContent='麦克风尚未准备好；授权后请重新按住说话。';}}
 for(const event of ['pointerup','pointercancel','lostpointercapture'])$('#chatVoice').addEventListener(event,releaseVoice);
 $('#chatVoice').addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();void beginVoice({id:'keyboard',y:0});}else if(e.key==='Escape'&&voicePress){stopVoice();$('#chatVoiceHint').textContent='语音已取消。';}});
 $('#chatVoice').addEventListener('keyup',e=>{if((e.key===' '||e.key==='Enter')&&voicePress?.id==='keyboard'){e.preventDefault();releaseVoice(e);}});
 async function uploadVoice(){
  if(!voiceDraft||voiceUploading)return;const epoch=version,attempt=voiceEpoch,draft=voiceDraft;voiceUploading=true;controls();$('#chatVoiceHint').textContent='正在上传语音…';
  try{
   const a=await request('/api/chat/attachments','POST',null,{headers:{'X-Filename':encodeURIComponent(draft.name),'Content-Type':draft.blob.type||'application/octet-stream'},body:draft.blob});
   if(epoch!==version||attempt!==voiceEpoch)return;attachments.push(a);clearVoice();chips();voiceUploading=false;controls();$('#chatVoiceHint').textContent='';submitMessage();
  }catch(e){if(epoch===version&&attempt===voiceEpoch){voiceUploading=false;controls();$('#chatVoiceDraft').hidden=false;$('#chatVoiceHint').textContent=e.message+' 录音已保留，点纸飞机重试发送，或取消语音。';}}
 }
 function controls(){if(pending)$('#chatSendStatus').textContent=busy?'正在发送…':'发送状态待确认';syncPeer();const archive=source==='archive';$('#chatForm').hidden=archive;$('#archiveNotice').hidden=!archive;$('#chatSend').disabled=busy||!!pending||listening||voiceUploading;$('#chatSend').dataset.state=busy?'sending':pending?'uncertain':'ready';$('#chatSend').setAttribute('aria-label',busy?'消息正在发送':pending?'发送状态待确认':'发送消息');$('#chatVoice').disabled=busy||!!pending||voiceUploading;$('#chatVoice').setAttribute('aria-pressed',String(listening));$('#chatInput').disabled=busy||!!pending||listening||voiceUploading;$('#chatFiles').disabled=busy||uploading>0||!!pending||voiceUploading||listening;$('#chatRecover').hidden=!pending||busy;$('#chatRecover').disabled=busy;progress();compose();}
 function responseNotice(messages){
  const latest=messages.at(-1),node=$('#chatServiceNotice');
  const failed=latest?.status==='failed',unavailable=failed&&latest.role==='assistant'&&/\b503\b/.test(latest.content)&&/API|service|error|busy|服务/i.test(latest.content);
  node.hidden=!failed;node.textContent=unavailable?'上次回复时模型服务暂不可用，可稍后再发消息。聊天记录和录音仍可使用。':failed?'上次回复未能完成，消息记录已保留。':'';
 }
 async function connection(){const epoch=version,s=await request('/api/chat/status');if(epoch!==version||!token)return;const text=!navigator.onLine?'已离线':!s.configured?'待接通':s.connected?'已连接':'连接中';$('#chatConnection').textContent=text;$('#chatConnection').title=text;window.ZiweiChatExtra?.presence(s.presence);}
 function pollConnection(){if(connectionTimer)return;connectionTimer=setInterval(()=>{if(token&&!$('#chat').hidden&&!document.hidden)void connection().catch(()=>{if(token)$('#chatConnection').textContent=navigator.onLine?'连接状态暂不可用':'已离线';});},30000);}

 function subscribe(){
  if(events)events.close();events=new EventSource('/api/chat/events?'+(lastEventCursor===null?'tail=true':'after='+lastEventCursor));const epoch=version,guard=fn=>e=>{if(token&&epoch===version)fn(e);};
  let opened=false;events.onopen=guard(()=>{if(opened){void load(false,true).catch(()=>{});void connection().catch(()=>{});}opened=true;});
  events.addEventListener('message.delta',guard(e=>{const o=JSON.parse(e.data);if(active.has(o.requestId)){buffers.set(o.requestId,(buffers.get(o.requestId)||'')+o.delta);progress();}}));
  events.addEventListener('message.saved',guard(()=>scheduleLoad()));events.addEventListener('timeline.changed',guard(e=>{const o=JSON.parse(e.data);if(!o.source||o.source===source)scheduleLoad(!o.action);}));
  events.addEventListener('request.state',guard(e=>{const o=JSON.parse(e.data);track(o.requestId,o.state);if(o.requestId===lastRequest&&['failed','completed'].includes(o.state))void connection().catch(()=>{});progress();scheduleLoad();}));
  events.addEventListener('approval.pending',guard(()=>{void window.ZiweiChatExtra?.approvals().catch(()=>{});}));events.addEventListener('approval.resolved',guard(()=>{void window.ZiweiChatExtra?.approvals().catch(()=>{});}));
  events.addEventListener('actions.changed',guard(()=>scheduleLoad()));
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
 async function callSend(a){
  if(pending||busy||attachments.length||$('#chatInput').value.trim())throw Error('请先处理当前输入区中的消息。');
  attachments=[a];chips();pending={requestId:crypto.randomUUID(),message:'',attachments:[a.id]};lastRequest=pending.requestId;const id=pending.requestId;
  await deliver();if(pending)throw Error('发送状态尚未确认。结束通话后，请点“确认发送状态”核对；原录音已保留。');return id;
 }
 function submitMessage(){if(!token||pending||listening||voiceUploading)return;if(uploading){queuedSend=true;$('#chatError').textContent='附件还在上传，完成后会自动发送。';return;}if(busy)return;if(voiceDraft){void uploadVoice();return;}const message=$('#chatInput').value;if(!message.trim()&&!attachments.length)return;pending={requestId:crypto.randomUUID(),message,attachments:attachments.map(a=>a.id),...(quote?{replyTo:quote.id}:{})};lastRequest=pending.requestId;void deliver();}
 $('#chatForm').onsubmit=e=>{e.preventDefault();submitMessage();};
 // 移动端 WebKit 在输入区被重排时可能不派发 form submit；直接绑定发送控件作为第二条路径，重复提交由 pending 兜底。
 $('#chatSend').onclick=e=>{e.preventDefault();submitMessage();};
 $('#chatRecover').onclick=()=>deliver();
 $('#chatRetry').onclick=()=>{if(token)void start(token);};
 $('#chatFiles').onchange=async e=>{
  const epoch=version,selected=[...e.target.files];e.target.value='';if(selected.length+attachments.length>6){$('#chatError').textContent='每条消息最多 6 个附件。';return;}
  uploading++;uploadFailed=false;controls();$('#chatError').textContent='';
  try{for(const file of selected){if(file.size>20*1024*1024)throw Error('附件超过 20 MB。');const a=await request('/api/chat/attachments','POST',null,{headers:{'X-Filename':encodeURIComponent(file.name),'Content-Type':file.type||'application/octet-stream'},body:file});if(epoch!==version)return;attachments.push(a);chips();}}
  catch(e){uploadFailed=true;if(epoch===version)$('#chatError').textContent=e.message;}finally{uploading=Math.max(0,uploading-1);const queued=queuedSend;queuedSend=false;if(epoch===version){controls();if(!uploading&&queued){if(uploadFailed)$('#chatError').textContent=($('#chatError').textContent||'附件上传失败。')+' 已取消自动发送，请检查附件后再发送。';else submitMessage();}}}
 };
 const st=$('#chatSearchToggle');if(st)st.onclick=()=>{const t=document.querySelector('#chatToolbar');if(!t)return;t.hidden=!t.hidden;st.setAttribute('aria-expanded',String(!t.hidden));$('#chatHistoryTools').hidden=t.hidden;if(t.hidden){$('#chatSearch').value='';scheduleLoad();}else $('#chatSearch').focus();};
 const cc=$('#chatCall');if(cc)cc.onclick=()=>window.alert('语音通话正在开发中，尚未接入实时语音服务。');
 $('#clearChatQuote').onclick=()=>{quote=null;$('#chatQuote').hidden=true;};
 $('#chatSource').onchange=()=>{source=$('#chatSource').value;before=null;trash=false;$('#chatTrash').setAttribute('aria-pressed','false');controls();load().catch(e=>$('#chatError').textContent=e.message);};
 $('#chatTrash').onclick=()=>{trash=!trash;favorite=false;source='live';$('#chatSource').value=source;$('#chatFavorites').setAttribute('aria-pressed','false');$('#chatTrash').setAttribute('aria-pressed',String(trash));controls();load().catch(()=>{});};
 $('#chatFavorites').onclick=()=>{favorite=!favorite;$('#chatFavorites').setAttribute('aria-pressed',String(favorite));load().catch(()=>{});};
 $('#chatSearch').oninput=()=>scheduleLoad();$('#chatOlder').onclick=()=>load(true).catch(()=>{});
 window.addEventListener('online',()=>{if(token){void start(token);if(pending)void deliver();}});window.addEventListener('offline',()=>{$('#chatConnection').textContent='已离线';});
 function stop(){window.ZiweiVoiceUI?.reset();window.ZiweiFiles?.reset();window.ZiweiChatCall?.end();window.ZiweiChatExtra?.stop();stopVoice();clearInterval(connectionTimer);connectionTimer=null;$('#chatServiceNotice').hidden=true;$('#chatServiceNotice').textContent='';window.ZiweiChatAppearance?.setVisible(false);version++;loadVersion++;token=null;startPromise=null;loadError='';viewKey=null;readingPosition=null;lastEventCursor=null;lastRequest=null;$('#chatVoiceHint').textContent='';$('#chatSendStatus').textContent='';events?.close();events=null;clearTimeout(reloadTimer);attachments=[];quote=null;pending=null;before=null;favorite=false;trash=false;source='live';busy=false;uploading=0;queuedSend=false;uploadFailed=false;active.clear();buffers.clear();$('#chatMessages').replaceChildren();$('#chatInput').value='';$('#chatSearch').value='';$('#chatSource').value='live';$('#chatFavorites').setAttribute('aria-pressed','false');$('#chatTrash').setAttribute('aria-pressed','false');$('#chatQuote').hidden=true;$('#chatError').textContent='';$('#chatStreaming').textContent='';$('#chatProgress').hidden=true;$('#chatEmpty').hidden=false;$('#chatEmpty').textContent='这里，留给我们慢慢说。';$('#chatRetry').hidden=true;$('#chatOlder').hidden=true;$('#chatTimeline').setAttribute('aria-busy','false');chips();controls();}
 async function start(csrf){
  if(!csrf)return;if(token!==csrf){stop();token=csrf;}window.ZiweiChatAppearance?.setVisible(true);syncPeer();compose();pollConnection();window.ZiweiChatExtra?.start(request);window.ZiweiChatCall?.configure({request,stopVoice,load,sendVoice:callSend,ready:()=>source==='live'&&!pending&&!busy&&!uploading&&!attachments.length&&!voiceDraft&&!$('#chatInput').value.trim()});if(startPromise)return startPromise;
  const epoch=version;
  // History must remain usable even when status checking or SSE is unavailable.
  const job=(async()=>{
   void connection().catch(()=>{if(epoch===version)$('#chatConnection').textContent='连接状态暂不可用';});
   await load(false,true).catch(()=>{});
   try{if(epoch===version&&!events)subscribe();}catch{if(epoch===version)$('#chatConnection').textContent='实时连接暂不可用';}
  })();
  startPromise=job;try{await job;}finally{if(epoch===version)startPromise=null;}
 }
 function canDraft(){return !pending&&!busy&&!$('#chatInput').value.trim();}
 function draft(text){if(!canDraft())return false;$('#chatInput').value=text;compose();return true;}
 return {start,stop,setProfiles,draft,canDraft,leave:()=>{if(!$('#chat').hidden){const t=$('#chatTimeline');readingPosition={top:t.scrollTop,follow:t.scrollHeight-t.scrollTop-t.clientHeight<80};}window.ZiweiChatCall?.end();if($('#chatImageViewer')?.open)$('#chatImageViewer').close();stopVoice();$('#chatInput').blur();}};
})();

/* 开一段新对话：旧记录保留，新的一段从空开始 */
(function(){
  function bind(){
    var b=document.getElementById('chatNewSession');
    if(!b) return;
    b.addEventListener('click',async function(){
      if(!confirm('开一段新的对话？\n旧记录都会留着，可以在这之前先让我把要紧的事记下来。'))return;
      b.disabled=true;
      try{
        var r=await fetch('/api/chat/session',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':(window.__zwCsrf||'')}});
        if(!r.ok) throw new Error('switch_failed');
        location.reload();
      }catch(e){ alert('切换没成功，再试一次。'); b.disabled=false; }
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
