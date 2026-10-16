/* Work phase one: independent, read-only-safe UI scaffold. No Hermes or private chat API calls. */
'use strict';
(()=> {
 const root=document.getElementById('work');
 if(!root)return;
 const input=root.querySelector('#workInput'),status=root.querySelector('#workStatus'),mode=root.querySelector('#workToolCurrent'),toggle=root.querySelector('#workToolToggle'),menu=root.querySelector('#workToolMenu');
 const choices=root.querySelectorAll('[data-work-tool]');
 const label={auto:'自由聊天',ppt:'PPT',word:'Word',pdf:'PDF',excel:'Excel',image:'图片',research:'资料研究'};
 let selected='auto';
 const closeMenu=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');};
 toggle.addEventListener('click',()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));});
 document.addEventListener('click',e=>{if(!e.target.closest('.work-tool-picker'))closeMenu();});
 root.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
 choices.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.workTool;choices.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));mode.textContent=label[selected];closeMenu();}));
 root.querySelectorAll('[data-work-mention]').forEach(b=>b.addEventListener('click',()=>{input.value+=(input.value&&!/\s$/.test(input.value)?' ':'')+'@'+b.dataset.workMention+' ';input.focus();}));
 // Clear unsent Work drafts whenever the authenticated application is hidden.
 const app=document.getElementById('app');
 if(app){new MutationObserver(()=>{if(app.hidden){input.value='';status.textContent='前端预览阶段 · 尚未连接 Work 消息服务';}}).observe(app,{attributes:true,attributeFilter:['hidden']});}
 root.querySelector('#workForm').addEventListener('submit',e=>{e.preventDefault();status.textContent='Work 后端尚未接入，消息未发送。当前选择：'+label[selected]+'。';});
 root.querySelector('#workVoice').addEventListener('click',()=>{status.textContent='Work 语音消息尚未接入；私人聊天语音功能不受影响。';});
 root.querySelector('#workAttach').addEventListener('click',()=>{status.textContent='Work 附件传输尚未接入（目标上限 200 MB）。';});
})();
