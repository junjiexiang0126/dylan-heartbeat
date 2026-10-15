'use strict';
window.ZiweiRecords=(()=>{
 const $=s=>document.querySelector(s),panels={diary:$('#logRecords'),work:$('#logRecords'),memory:$('#memoryRecords')};
 let token=null,epoch=0,visible=null,kind='work',timer=null,busy=false,sequence=0,onReply=null,searchTimer=null;
 const state=Object.fromEntries(['work','diary','memory'].map(k=>[k,{offset:0,next:null,q:'',category:'all',data:[],expanded:new Set()}]));
 const documents=new Map();
 const labels={pending:'待执行',in_progress:'执行中',completed:'已完成（后台记录）',failed:'失败',waiting_user:'等待你处理',deferred:'暂缓',saved:'已保存原文',admitted:'已放行一次机会',skipped:'未放行',delivery_failed:'执行后送达失败',recorded:'已记录',unknown:'状态未确认'};
 const bases={agent_task_state:'知微的任务当前状态',system_gate:'系统唤醒检查',cron_execution:'原生 Cron 执行记录',agent_activity_record:'知微保存的活动记录',saved_file:'知微保存的原文',agent_briefing:'知微自主简报 · 本人记录',memory_audit:'原生记忆维护审计'};
 function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function button(text,fn){const b=el('button','text-button',text);b.type='button';b.onclick=fn;return b;}
 function time(value){if(!value||!Number.isFinite(Date.parse(value)))return '记录未提供时间';return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok',hour12:false}).format(new Date(value));}
 function current(){return visible==='memory'?'memory':kind;}
 function statusNode(k){return $(k==='memory'?'#memoryStatus':'#logStatus');}
 function errorNode(k){return $(k==='memory'?'#memoryError':'#logError');}
 async function api(path){
  const v=epoch,r=await fetch(path,{cache:'no-store',headers:{'X-Ziwei-CSRF':token}});
  if(v!==epoch)throw Error('已锁定');
  if(r.status===401){stop();document.dispatchEvent(new Event('ziwei-session-expired'));throw Error('请重新登录。');}
  let value;try{value=await r.json();}catch{throw Error('后台返回格式异常。');}
  if(!r.ok)throw Error(r.status===404?'这份原文已不存在，或后台接口尚未部署。':r.status===413?'原文过大，当前无法完整读取。':r.status===409?'知微正在保存这份原文，请稍后重试。':'暂时无法读取知微后台，请稍后刷新。');
  return value;
 }
 async function full(k,row){const value=await api('/api/records/'+k+'?id='+encodeURIComponent(row.id));documents.set(k+':'+row.id,value);return value;}
 function updateBody(node,content){node.textContent=content;}
 function render(k){
  const s=state[k],list=panels[k];const top=window.scrollY;list.replaceChildren();
  for(const row of s.data){
   const card=el('article','glass record-card '+(k==='diary'?'diary-card':k==='memory'?'memory-card':'work-card'));card.dataset.id=row.id;
   const date=el('div','record-date');date.append(el('time','',k==='diary'&&row.date?row.date.replaceAll('-','.'):time(row.at||row.savedAt)),el('span','record-date-line'));card.append(date);
   if(k==='diary'){const author=el('p','record-author');author.textContent=($('#ziweiName').textContent||'知微')+' · 个人日记';card.append(author);}
   card.append(el('h2','record-title',row.title));
   if(k==='work'){card.append(el('span','record-state',row.basis==='memory_audit'&&row.state==='pending'?'等待核验':row.basis==='agent_task_state'&&row.state==='completed'?'标记完成':labels[row.state]||'状态未确认'),el('p','record-basis',bases[row.basis]||'后台原始记录'));if(row.recordedState)card.append(el('p','record-basis','原始状态：'+row.recordedState));if(row.opportunity!==null&&row.opportunity!==undefined)card.append(el('p','record-basis','第 '+row.opportunity+' 次自主机会'));}
   if(k==='memory'&&Number.isSafeInteger(row.chars))card.append(el('p','record-basis',row.chars+' 字符 · '+row.lines+' 行'));
   const content=el('div','record-body');let doc=documents.get(k+':'+row.id);if(k==='memory')doc=row;
   const expanded=s.expanded.has(row.id);content.classList.toggle('collapsed',!expanded);updateBody(content,expanded&&doc?doc.content:row.preview??row.content??'');card.append(content);
   if(row.error)card.append(el('p','error','原文读取失败，请刷新后重试。'));
   const actions=el('div','record-actions');
   if(k==='memory'||row.document){
    const toggle=button(expanded?'收起 ▴':'展开 ▾',async()=>{const v=epoch;if(s.expanded.has(row.id)){s.expanded.delete(row.id);render(k);return;}toggle.disabled=true;try{if(k!=='memory'){doc=await full(k,row);if(v!==epoch)return;updateBody(content,doc.content);}else updateBody(content,row.content);s.expanded.add(row.id);content.classList.remove('collapsed');toggle.textContent='收起 ▴';}catch(e){if(v===epoch)errorNode(k).textContent=e.message;}finally{if(v===epoch)toggle.disabled=false;}});actions.append(toggle);
    if(expanded&&k!=='memory'&&(!doc||doc.revision!==row.revision)){const v=epoch;full(k,row).then(value=>{if(v===epoch&&content.isConnected)updateBody(content,value.content);}).catch(e=>{if(v===epoch)errorNode(k).textContent=e.message;});}
   }
   if(k==='diary')actions.append(button('和知微聊这篇',async()=>{const v=epoch;try{const doc=await full(k,row);if(v!==epoch)return;const draft='我想和你聊这篇日记：'+(row.date||row.title)+'\n\n「'+doc.content.slice(0,2000)+'」\n\n';if(onReply&&!onReply(draft))errorNode(k).textContent='聊天里还有未发送内容或正在处理的消息，请先处理后再回复日记。';}catch(e){if(v===epoch)errorNode(k).textContent=e.message;}}));
   if(row.references?.length)card.append(el('p','record-basis','记录中的引用：'+row.references.join('、')));
   if(row.evidence?.length){const box=el('div','record-evidence');box.append(el('p','',row.evidenceVerified?'成果文件已落盘；文件存在不代表外部任务结果已核实。':'部分成果文件缺失或无法读取。'));for(const item of row.evidence){if(item.saved&&item.id){const a=el('a','record-artifact',item.source+' · '+item.bytes+' B');a.href='/api/records/artifact?id='+encodeURIComponent(item.id);a.download='';box.append(a);}else box.append(el('p','error',item.source+' · 未找到有效成果'));}card.append(box);}
   if(k==='work'&&row.basis==='agent_task_state'&&row.state==='completed'&&!row.evidence?.length)card.append(el('p','record-basis','没有可核对的成果文件，当前只能确认任务被标记完成。'));
   card.append(actions);const provenance=el('details','record-provenance');provenance.append(el('summary','','来源与保存时间'),el('p','',row.source),el('p','','保存于 '+time(row.savedAt||row.at)));if(row.revision)provenance.append(el('p','','内容指纹 '+row.revision.slice(0,12)));card.append(provenance);list.append(card);
  }
  const empty=$(k==='memory'?'#memoryEmpty':'#logEmpty');empty.hidden=s.data.length>0;empty.textContent=s.q?'没有找到符合条件的原始记录。':k==='diary'?'知微还没有在当前日记目录保存日记。':k==='memory'?'当前没有可读取的原生记忆文档。':'当前没有可读取的工作记录。';
  $(k==='memory'?'#memoryPrevious':'#logPrevious').disabled=s.offset===0;$(k==='memory'?'#memoryNext':'#logNext').disabled=s.next===null;
  if(top>0)window.scrollTo({top});
 }
 async function load(){
  if(!token||!visible)return;const k=current(),s=state[k],v=epoch,run=++sequence;busy=true;const status=statusNode(k);status.textContent=s.data.length?'正在核对后台更新…':'正在读取知微后台…';errorNode(k).textContent='';
  try{const params=new URLSearchParams({limit:'20',offset:String(s.offset),q:s.q,...(k==='memory'?{category:s.category}:{})}),value=await api('/api/records/'+k+'?'+params);if(v!==epoch||run!==sequence||current()!==k)return;if(!Array.isArray(value.data)||value.source!=='hermes_native')throw Error('未收到可核对的原生记录。');s.data=value.data;s.next=value.nextOffset??null;render(k);status.textContent='后台核对于 '+time(value.checkedAt)+' · '+value.total+(k==='memory'?' 份原生文档':' 条记录');if(value.errors?.length)errorNode(k).textContent='部分来源缺失或读取失败：'+value.errors.map(x=>x.source).join('、')+'。现有列表可能不完整。';if(k==='work'&&value.workLogWindow)$('#workLogScope').textContent='展示知微的自主简报与记忆维护记录，以原生后台实际返回为准。每次刷新最多读取 2,000 条，不补写历史。';}
  catch(e){if(v===epoch&&run===sequence){status.textContent=s.data.length?'后台更新未确认，以下保留上次读取结果。':'尚未读到真实后台记录。';errorNode(k).textContent=e.message;$(k==='memory'?'#memoryEmpty':'#logEmpty').hidden=true;}}
  finally{if(v===epoch&&run===sequence)busy=false;}
 }
 function show(name,csrf,reply){if(token!==csrf){stop();token=csrf;}onReply=reply;visible=['memory','logs'].includes(name)?name:null;clearInterval(timer);timer=null;if(!visible)return;void load();timer=setInterval(()=>{if(!document.hidden&&!busy)void load();},30000);}
 function stop(){epoch++;sequence++;token=null;visible=null;onReply=null;busy=false;clearInterval(timer);clearTimeout(searchTimer);timer=null;documents.clear();for(const s of Object.values(state)){s.data=[];s.offset=0;s.next=null;s.q='';s.category='all';s.expanded.clear();}$('#logRecords').replaceChildren();$('#memoryRecords').replaceChildren();for(const id of ['logStatus','logError','memoryStatus','memoryError'])$('#'+id).textContent='';$('#logSearch').value='';$('#memorySearch').value='';$('#memoryCategory').value='all';}
 for(const b of document.querySelectorAll('[data-log-kind]'))b.onclick=()=>{kind=b.dataset.logKind;sequence++;busy=false;document.querySelectorAll('[data-log-kind]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b));});$('#logSearch').value=state[kind].q;$('#workLogScope').hidden=kind!=='work';panels[kind].replaceChildren();void load();};
 for(const k of ['logs','memory']){
  const prefix=k==='logs'?'log':'memory';$('#'+prefix+'Refresh').onclick=()=>{void load();};
  $('#'+prefix+'Search').oninput=e=>{const s=state[current()];s.q=e.target.value;s.offset=0;sequence++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{void load();},300);};
  $('#'+prefix+'Previous').onclick=()=>{state[current()].offset=Math.max(0,state[current()].offset-20);void load();};
  $('#'+prefix+'Next').onclick=()=>{if(state[current()].next!==null){state[current()].offset=state[current()].next;void load();}};
 }
 $('#memoryCategory').onchange=e=>{state.memory.category=e.target.value;state.memory.offset=0;void load();};
 document.addEventListener('visibilitychange',()=>{if(visible&&!document.hidden&&!busy)void load();});
 return {show,stop};
})();
