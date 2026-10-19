'use strict';
(()=>{
 const root=document.getElementById('work');if(!root)return;
 const $=id=>root.querySelector('#'+id),input=$('workInput'),status=$('workStatus'),conversation=root.querySelector('.work-conversation');
 const element=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const button=(label,fn)=>{const b=element('button','text-button',label);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(e=>status.textContent=e.message);return b;};
 let selected='auto',data=null,profiles={},attachments=[],quote=null,requestId=null,payload=null,sending=false,timer=null,epoch=0,favorites=false;
 const labels={auto:'聊天',word:'Word',ppt:'PPT',pdf:'PDF',excel:'Excel',bundle:'文档套件',image:'图片',research:'研究'};
 const api=async(url,method='GET',body)=>{
  const session=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json());if(!session.authenticated)throw Error('请重新登录');
  const r=await fetch(url,{method,cache:'no-store',headers:{'X-Ziwei-CSRF':session.csrf,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await r.json();if(!r.ok)throw Error(value.error||'请求失败');return value;
 };
 const closeMenu=()=>{$('workToolMenu').hidden=true;$('workToolToggle').setAttribute('aria-expanded','false');};
 const mention=name=>{const at=input.selectionStart??input.value.length,before=input.value.slice(0,at),match=before.match(/@[^@\s]*$/);input.setRangeText('@'+name+' ',match?at-match[0].length:at,input.selectionEnd??at,'end');$('workMentionMenu').hidden=true;input.focus();};
 root.querySelectorAll('[data-work-mention]').forEach(b=>b.onclick=()=>mention(b.dataset.workMention));
 $('workToolToggle').onclick=()=>{$('workToolMenu').hidden=!$('workToolMenu').hidden;$('workToolToggle').setAttribute('aria-expanded',String(!$('workToolMenu').hidden));};
 document.addEventListener('click',e=>{if(!e.target.closest('.work-tool-picker'))closeMenu();});
 root.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();$('workToolsPanel').hidden=true;}});
 root.querySelectorAll('[data-work-tool]').forEach(b=>b.onclick=()=>{selected=b.dataset.workTool;$('workToolCurrent').textContent=labels[selected];root.querySelectorAll('[data-work-tool]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));closeMenu();});
 input.addEventListener('input',()=>{const before=input.value.slice(0,input.selectionStart??input.value.length);$('workMentionMenu').hidden=!/@[^@\s]*$/.test(before);$('workForm').classList.toggle('is-editing',input.value.includes('\n')||input.value.length>36);input.style.height='';input.style.height=Math.min(input.scrollHeight,112)+'px';});
 function avatar(role,node){
  const p=role==='user'?profiles.user:role==='ziwei'?profiles.ziwei:null;
  node.replaceChildren();if(p?.avatar){const img=element('img');img.src=p.avatar;img.alt=(p.nickname||role)+'的头像';node.append(img);}else if(role==='glm'){const img=element('img');img.src='/skin-raven.svg';img.alt='白鸦的头像';node.append(img);}else node.textContent=role==='user'?'你':'微';
 }
 function chips(){const box=$('workAttachments');box.replaceChildren();for(const a of attachments){const chip=element('span','attachment-chip',a.name);chip.append(button('×',()=>{attachments=attachments.filter(x=>x.id!==a.id);chips();}));box.append(chip);}}
 function paint(){
  if(!data)return;const nearEnd=conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<100,top=conversation.scrollTop;
  conversation.replaceChildren();const q=$('workSearchInput').value.toLowerCase();
  const items=data.data.filter(m=>!m.deleted&&(!favorites||m.favorite)&&(!q||m.text.toLowerCase().includes(q)));
  for(const m of items){
   if(m.role==='system') {const line=element('article','message-poke',m.text);conversation.append(line);continue;}
   const line=element('article','message '+(m.role==='user'?'user':'assistant'));line.dataset.id=m.id;
   const face=element('div','message-avatar'),body=element('div','message-body');avatar(m.role,face);face.ondblclick=()=>action({action:'poke',target:m.role});
   const label=element('div','message-label',(m.role==='user'?'你':m.role==='glm'?'白鸦':'知微')+' · '+new Date(m.at).toLocaleString('zh-CN',{timeZone:'Asia/Bangkok'})+(m.stage==='draft'?' · 待审核':''));body.append(label);
   const bubble=element('div','message-bubble glass');if(m.replyTo){const reply=data.data.find(x=>x.id===m.replyTo);if(reply)bubble.append(element('blockquote','message-quote',reply.text.slice(0,500)));}
   const text=element('div','message-content');window.ZiweiChatRender.text(text,m.text);bubble.append(text);
   for(const id of m.attachments||[]){const file=data.files?.find(f=>f.id===id),filename=file?.name||'附件';if(file?.mime.startsWith('image/')){const img=element('img','message-media');img.src='/api/work/attachments/'+id;img.alt=filename;img.loading='lazy';img.tabIndex=0;img.onclick=()=>window.ZiweiChatExtra?.showImage(img);bubble.append(img);continue;}const link=element('a','file-card file-link',filename+' · 查看 / 保存');link.href='/api/work/attachments/'+id;link.download=filename;link.onclick=e=>{if(window.ZiweiSave){e.preventDefault();void window.ZiweiSave.saveOrShare(link.href,filename);}};bubble.append(link);}
   const actions=element('div','message-actions');if(m.role!=='user')actions.append(button('拍一拍',()=>action({action:'poke',target:m.role})));
   actions.append(button('引用',()=>{quote=m;$('workQuote').hidden=false;$('workQuoteText').textContent=m.text.slice(0,120);input.focus();}),button('复制',()=>navigator.clipboard.writeText(m.text)),button(m.favorite?'取消收藏':'收藏',()=>action({id:m.id,action:m.favorite?'unfavorite':'favorite'})),button('删除',()=>action({id:m.id,action:'delete'})));window.ZiweiChatRender.actions(actions);
   body.append(bubble,actions);line.append(face,body);conversation.append(line);
  }
  if(!items.length)conversation.append(element('p','chat-empty',q||favorites?'没有符合条件的 Work 消息。':'把工作放在这里，我们一起完成。'));
  conversation.scrollTop=nearEnd?conversation.scrollHeight:top;
  const active=data.tasks.find(t=>['queued','planning','executing','reviewing','generating'].includes(t.state));
  const names={queued:'任务排队中',planning:'知微正在委派',executing:'白鸦正在执行',reviewing:'知微正在审核',generating:'正在生成交付文件',completed:'已完成交付',needs_revision:'审核未通过，等待修改',failed:'任务失败',interrupted:'任务因重启中断'};
  const latest=active||data.tasks[0];if(latest&&status.textContent==='任务已受理')status.textContent='';$('workTaskStatus').textContent=latest?(names[latest.state]||latest.state)+(latest.error?' · '+latest.error:''):'';
  $('workUsage').textContent='累计模型请求 '+data.usage.length+' 次 · 配置上界估算 ¥'+data.usage.reduce((n,u)=>n+u.cost,0).toFixed(4)+(data.budget?' · 今日预算剩余 ¥'+data.budget.remaining.toFixed(2):'')+' · 实际账单待供应商核对';
  $('workSend').disabled=sending||!!active;
  const repairable=!active&&data.tasks.find(t=>t.canRepairDelivery);$('workRepairDelivery').hidden=!repairable;$('workRepairDelivery').dataset.taskId=repairable?repairable.id:'';
  const recoverable=!active&&data.tasks.find(t=>t.canResumeReview);$('workResumeReview').hidden=!recoverable;$('workResumeReview').dataset.taskId=recoverable?recoverable.id:'';
  avatar('ziwei',root.querySelector('[data-work-mention="知微"]'));avatar('glm',root.querySelector('[data-work-mention="白鸦"]'));
 }
 async function refresh(){const v=epoch;try{const d=await api('/api/work/messages');if(v!==epoch)return;const changed=JSON.stringify(data)!==JSON.stringify(d);data=d;if(changed)paint();}catch(e){if(v===epoch)status.textContent=e.message;}}
 async function action(b){await api('/api/work/action','POST',b);await refresh();}
 function renderTools(){const box=$('workToolCatalog');box.replaceChildren();const ledger=$('workUsageRows');ledger.replaceChildren();for(const u of data?.usage||[]){const row=element('p','',new Date(u.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Bangkok'})+' · '+({plan:'知微委派',execute:'白鸦执行',review:'知微审核'}[u.stage]||u.stage)+' · '+u.model+' · '+((u.usage?.total_tokens??((u.usage?.prompt_tokens||0)+(u.usage?.completion_tokens||0)))||'未报告')+' Token · 估算 ¥'+u.cost.toFixed(4));ledger.append(row);}const runs=$('workToolRuns');runs.replaceChildren();for(const r of (data?.toolRuns||[]).slice(-40).reverse()){runs.append(element('p','',new Date(r.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Bangkok'})+' · '+({ziwei:'知微',glm:'白鸦',system:'文件检查程序'}[r.agent]||r.agent)+' · '+r.name+' · '+({running:'运行中',completed:'已完成',failed:'失败',interrupted:'已中断'}[r.status]||r.status)+(r.result.files?.length?' · '+r.result.files.length+' 个文件':'')));}for(const t of data?.tools||[]){
  const card=element('section','work-tool-card'),head=element('div','work-tool-card-heading'),badge=element('span','work-tool-badge',({word:'W',ppt:'P',pdf:'PDF',excel:'X',bundle:'4'}[t.kind]||'＋')),identity=element('div','work-tool-identity');
  identity.append(element('strong','',t.name),element('small','work-tool-state',t.enabled?(t.authorized?'已授权':'未授权'):'已停用'));head.append(badge,identity);card.append(head);
  const title=element('input');title.value=t.config.title;title.setAttribute('aria-label',t.name+'文件标题');
  const save=b=>api('/api/work/tools/configure','POST',{id:t.id,revision:t.revision,title:title.value,...b}).then(async()=>{await refresh();renderTools();});
  const actions=element('div','work-tool-card-actions'),authorize=button(t.authorized?'撤销授权':'授权',()=>save({authorized:!t.authorized})),use=button('使用',()=>{selected=t.id;$('workToolCurrent').textContent=t.name;$('workToolsPanel').hidden=true;input.focus();});
  use.classList.add('work-tool-use');actions.append(authorize,use);card.append(actions);
  const settings=element('details','work-tool-settings'),summary=element('summary','','设置'),label=element('label','','文件标题'),settingsActions=element('div','work-tool-card-actions');label.append(title);settingsActions.append(button('保存',()=>save({})),button(t.enabled?'停用工具':'启用工具',()=>save({enabled:!t.enabled})));settings.append(summary,label,settingsActions);card.append(settings);box.append(card);
 }}
 $('workToolsOpen').onclick=async()=>{await refresh();renderTools();$('workToolsPanel').hidden=false;};$('workToolsClose').onclick=()=>{$('workToolsPanel').hidden=true;};
 $('workRepairDelivery').onclick=async()=>{const b=$('workRepairDelivery');b.disabled=true;try{const r=await api('/api/work/repair-delivery','POST',{taskId:b.dataset.taskId});status.textContent=r.checked?'明确的页数与字数要求已通过程序检查':'正在按检查结果修订交付文件';await refresh();}catch(e){status.textContent='检查修订未受理：'+e.message;}finally{b.disabled=false;}};
 $('workResumeReview').onclick=async()=>{const b=$('workResumeReview');b.disabled=true;try{await api('/api/work/resume-review','POST',{taskId:b.dataset.taskId});status.textContent='正在继续审核已保存的草稿';await refresh();}catch(e){status.textContent='继续审核未受理：'+e.message;}finally{b.disabled=false;}};
 $('workCheckRuntime').onclick=async()=>{const b=$('workCheckRuntime');b.disabled=true;$('workToolNotice').textContent='正在检查连接…';try{const r=await api('/api/work/runtime');$('workToolNotice').textContent='知微已连接 · 白鸦'+(r.glmConfigured?'已配置':'未配置');}catch(e){$('workToolNotice').textContent='连接暂不可用：'+e.message;}finally{b.disabled=false;}};
 $('workToolAdd').onclick=()=>{$('workRegister').hidden=!$('workRegister').hidden;};
 $('workRegister').onsubmit=async e=>{e.preventDefault();try{await api('/api/work/tools/register','POST',{kind:$('workRegisterKind').value,name:$('workRegisterName').value});await refresh();renderTools();$('workRegister').hidden=true;}catch(err){$('workToolNotice').textContent=err.message;}};
 $('workSearchToggle').onclick=()=>{$('workSearchBar').hidden=!$('workSearchBar').hidden;if(!$('workSearchBar').hidden)$('workSearchInput').focus();};$('workSearchInput').oninput=paint;
 $('workFavorites').onclick=()=>{favorites=!favorites;$('workFavorites').setAttribute('aria-pressed',String(favorites));paint();};
 $('workQuoteCancel').onclick=()=>{quote=null;$('workQuote').hidden=true;};
 $('workAttach').onclick=()=>$('workFiles').click();
 $('workFiles').onchange=async()=>{const picked=[...$('workFiles').files];$('workFiles').value='';for(const f of picked){if(attachments.length>=4||f.size>20*1024*1024){status.textContent='每次最多 4 个附件，每个 20 MB。';break;}try{const session=await fetch('/api/session').then(r=>r.json());const r=await fetch('/api/work/attachments',{method:'POST',headers:{'X-Ziwei-CSRF':session.csrf,'X-Filename':encodeURIComponent(f.name),'Content-Type':f.type||'application/octet-stream'},body:f});const a=await r.json();if(!r.ok)throw Error(a.error);attachments.push(a);chips();status.textContent='附件已保存';}catch(e){status.textContent=e.message;}}};
 $('workForm').onsubmit=async e=>{
  e.preventDefault();if(sending)return;const text=input.value.trim();if(!text)return;
  if(!payload||payload.text!==text||payload.tool!==selected||JSON.stringify(payload.attachments)!==JSON.stringify(attachments.map(a=>a.id))||payload.replyTo!==(quote?.id||null)){requestId=crypto.randomUUID();payload={requestId,text,tool:selected,attachments:attachments.map(a=>a.id),replyTo:quote?.id||null};}
  sending=true;paint();status.textContent='正在发送…';try{await api('/api/work/send','POST',payload);payload=null;requestId=null;input.value='';attachments=[];quote=null;chips();$('workQuote').hidden=true;status.textContent='任务已受理';await refresh();}catch(e){status.textContent='未能确认发送：'+e.message+'；可重试核对同一任务。';}finally{sending=false;paint();}
 };
 // Voice is intentionally outside this iteration's work-task contract; keep the
 // existing private chat voice implementation separate rather than fake a send.
 $('workVoice').hidden=true;
 const app=document.getElementById('app');
 let frame;function layout(){
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{
    if(root.hidden||app.hidden)return;
    // Match the proven private-chat layout: the panel ends above the
    // real navigation or visible keyboard, whichever comes first.
    const viewport=window.visualViewport;
    const bottom=viewport?viewport.offsetTop+viewport.height:innerHeight;
    const nav=document.querySelector('nav').getBoundingClientRect();
    const top=root.getBoundingClientRect().top;
    root.style.height=Math.max(0,Math.min(nav.top,bottom)-8-top)+'px';
    if(typeof window.__workScrollBottom==='function')window.__workScrollBottom();
  });
}
 window.addEventListener('resize',layout);window.visualViewport?.addEventListener('resize',layout);window.visualViewport?.addEventListener('scroll',layout);
 if(window.ResizeObserver)new ResizeObserver(layout).observe(document.querySelector('nav'));
 function compose(){const edit=document.activeElement===input;$('workForm').classList.toggle('is-editing',edit);$('workForm').style.setProperty('--actions-row',String((quote?2:1)+(edit?1:0)));input.style.height=edit?Math.min(112,Math.max(64,input.scrollHeight))+'px':'36px';layout();}input.addEventListener('focus',compose);input.addEventListener('blur',compose);
 const sync=()=>{const visible=!app.hidden&&!root.hidden;if(!visible){clearInterval(timer);timer=null;if(app.hidden){epoch++;data=null;profiles={};attachments=[];quote=null;payload=null;input.value='';conversation.replaceChildren();chips();}return;}
  layout();if(!timer){void api('/api/home').then(x=>{profiles=x;paint();}).catch(()=>{});void refresh();timer=setInterval(()=>{if(!document.hidden)void refresh();},2000);}};
 new MutationObserver(sync).observe(app,{attributes:true,attributeFilter:['hidden']});new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['hidden']});sync();
})();
