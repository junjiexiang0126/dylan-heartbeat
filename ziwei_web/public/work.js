/* Work phase one: independent, read-only-safe UI scaffold. No Hermes or private chat API calls. */
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
 const insertMention=name=>{const at=input.selectionStart??input.value.length;const before=input.value.slice(0,at),after=input.value.slice(input.selectionEnd??at);const match=before.match(/@[^@\\s]*$/);const start=match?at-match[0].length:at;const prefix=match?'':(before&& !/\\s$/.test(before)?' ':'');const value=prefix+'@'+name+' ';input.setRangeText(value,start,input.selectionEnd??at,'end');mentionMenu.hidden=true;input.focus();};
 root.querySelectorAll('[data-work-mention]').forEach(b=>b.addEventListener('click',()=>insertMention(b.dataset.workMention)));
 input.addEventListener('input',()=>{const before=input.value.slice(0,input.selectionStart??input.value.length);mentionMenu.hidden=!/@[^@\\s]*$/.test(before);});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')mentionMenu.hidden=true;});
 // Clear unsent Work drafts whenever the authenticated application is hidden.
 const app=document.getElementById('app');
 if(app){new MutationObserver(()=>{if(app.hidden){input.value='';status.textContent='前端预览阶段 · 尚未连接 Work 消息服务';}}).observe(app,{attributes:true,attributeFilter:['hidden']});}
 root.querySelector('#workForm').addEventListener('submit',e=>{e.preventDefault();status.textContent='Work 后端尚未接入，消息未发送。当前选择：'+label[selected]+'。';});
 root.querySelector('#workVoice').addEventListener('click',()=>{status.textContent='Work 语音消息尚未接入；私人聊天语音功能不受影响。';});
 root.querySelector('#workAttach').addEventListener('click',()=>{status.textContent='Work 附件传输尚未接入（目标上限 200 MB）。';});
})();
