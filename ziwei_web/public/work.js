/* Isolated Work transport: GLM task replies, no Hermes private-chat or memory access. */
'use strict';
(()=> {
 const root=document.getElementById('work');
 if(!root)return;
 const input=root.querySelector('#workInput'),status=root.querySelector('#workStatus'),mode=root.querySelector('#workToolCurrent'),toggle=root.querySelector('#workToolToggle'),menu=root.querySelector('#workToolMenu'),mentionMenu=root.querySelector('#workMentionMenu');
 const choices=root.querySelectorAll('[data-work-tool]');
 const label={auto:'自由聊天',ppt:'PPT',word:'Word',pdf:'PDF',excel:'Excel',image:'图片',research:'资料研究'};
 let selected='auto';
 const closeMenu=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');};
 let touchStart=0;
 menu.addEventListener('touchstart',e=>{touchStart=e.touches[0]?.clientY??0;},{passive:true});
 menu.addEventListener('touchend',e=>{const dy=(e.changedTouches[0]?.clientY??touchStart)-touchStart;if(dy>90)closeMenu();},{passive:true});
 toggle.addEventListener('click',()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));});
 document.addEventListener('click',e=>{if(!e.target.closest('.work-tool-picker'))closeMenu();});
 root.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
 choices.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.workTool;choices.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));mode.textContent=label[selected];closeMenu();}));
 const insertMention=name=>{const at=input.selectionStart??input.value.length;const before=input.value.slice(0,at),after=input.value.slice(input.selectionEnd??at);const match=before.match(/@[^@\s]*$/);const start=match?at-match[0].length:at;const prefix=match?'':(before&& !/\s$/.test(before)?' ':'');const value=prefix+'@'+name+' ';input.setRangeText(value,start,input.selectionEnd??at,'end');mentionMenu.hidden=true;input.focus();};
 root.querySelectorAll('[data-work-mention]').forEach(b=>b.addEventListener('click',()=>insertMention(b.dataset.workMention)));
 input.addEventListener('input',()=>{const before=input.value.slice(0,input.selectionStart??input.value.length);mentionMenu.hidden=!/@[^@\s]*$/.test(before);});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')mentionMenu.hidden=true;});
 // Clear unsent Work drafts whenever the authenticated application is hidden.
 const app=document.getElementById('app');
 if(app){new MutationObserver(()=>{if(app.hidden){input.value='';status.textContent='Work 已就绪；@知微 委派与文件工具尚待接入';}}).observe(app,{attributes:true,attributeFilter:['hidden']});}
 const conversation=root.querySelector('.work-conversation');
 const show=items=>{
  conversation.replaceChildren();
  for(const m of items){
   const line=document.createElement('div');line.className='work-line';
   const who=document.createElement('strong');who.textContent=m.role==='user'?'你':m.role==='glm'?'白鸦':'系统';
   const body=document.createElement('p');body.textContent=m.text;
   line.append(who,body);conversation.append(line);
  }
  conversation.scrollTop=conversation.scrollHeight;
 };
 const refresh=async()=>{
  try{const r=await fetch('/api/work/messages',{credentials:'same-origin'});if(r.ok)show((await r.json()).data||[]);else if(r.status!==401)status.textContent='Work 历史读取失败';}
  catch{status.textContent='Work 历史读取失败，请检查网络';}
 };
 refresh();
 document.querySelector('[data-tab="work"]')?.addEventListener('click',refresh);
 root.querySelector('#workForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const text=input.value.trim();if(!text)return;
  if(/@知微(?:\\s|$|[，,。！!？?])/.test(text)){status.textContent='知微委派通道尚未接入，消息未发送；目前可直接 @白鸦 测试文本任务。';return;}
  const submit=root.querySelector('#workForm button[type=submit]');submit.disabled=true;
  status.textContent='白鸦正在处理（最多一次调用，12 秒超时）…';
  try{
   const session=await fetch('/api/session',{credentials:'same-origin'}).then(r=>r.json());
   if(!session.authenticated||!session.csrf)throw Error('请重新登录');
   const r=await fetch('/api/work/send',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Ziwei-CSRF':session.csrf},body:JSON.stringify({text,tool:selected})});
   const data=await r.json();
   if(!r.ok)throw Error(data.error||'发送失败');
   input.value='';status.textContent='白鸦已回复 · Token '+(data.usage?.total_tokens??'未报告');
   await refresh();
  }catch(err){status.textContent='Work 未完成：'+err.message;}
  finally{submit.disabled=false;}
 });
 root.querySelector('#workVoice').addEventListener('click',()=>{status.textContent='Work 语音消息尚未接入；私人聊天语音功能不受影响。';});
 root.querySelector('#workAttach').addEventListener('click',()=>{status.textContent='Work 附件传输尚未接入（目标上限 30 MB）。';});
})();
