'use strict';
window.ZiweiRecords=(()=>{
 const $=s=>document.querySelector(s),panels={diary:$('#logRecords'),work:$('#logRecords'),memory:$('#memoryRecords')};
 let token=null,epoch=0,visible=null,kind='work',timer=null,busy=false,sequence=0,onReply=null,searchTimer=null;
 const state=Object.fromEntries(['work','diary','memory'].map(k=>[k,{offset:0,next:null,q:'',category:'all',data:[],expanded:new Set()}]));
 const documents=new Map();
 let logOpen=false,memoryOpen=false,workSelected=null,diarySelected=null,memorySnapshot=null,historySession=0;
 const logTitles={work:'工作日志',diary:'个人日志',private:'私人日志',photos:'照片墙',impressions:'今日印记'};
 const pageMeta={};let memoryOriginalId=null,todayDiary=null,overviewRun=0;
 function pageChrome(){
  const sheet=visible==='logs'&&logOpen||visible==='memory'&&memoryOpen;
  document.body.classList.toggle('records-subpage',sheet);document.body.classList.toggle('records-memory-overview',visible==='memory'&&!memoryOpen);
  for(const [id,open] of [['logs',logOpen],['memory',memoryOpen]])$('#'+id).classList.toggle('record-open',open);
  $('#logDetail').hidden=!logOpen;const impView=visible==='logs'&&logOpen&&kind==='impressions';document.body.classList.toggle('impressions-open',impView);window.ZiweiImpressions?.show(impView,api);window.ZiweiPhotos?.show(visible==='logs'&&logOpen&&kind==='photos',token);
  $('#logDetailTitle').textContent=workSelected?'工作记录':diarySelected?'日记原文':logTitles[kind];
  $('#logs').classList.toggle('diary-reading',!!diarySelected);
  $('#logPrivateHint').hidden=kind!=='private';
  $('#memoryOverviewMeta').textContent=pageMeta['memory:all']||'正在读取…';
  $('#logBack').setAttribute('aria-label',workSelected?'返回工作日志':diarySelected?'返回个人日志':'返回日志首页');
  $('#logPageMeta').hidden=!logOpen||!['work','diary'].includes(kind)||!!workSelected||!!diarySelected;
  $('#logPageMeta').textContent=pageMeta[kind]||'正在读取…';
  $('#memoryRefresh').hidden=!memoryOpen;
  $('#memoryPageMeta').textContent=pageMeta['memory:'+state.memory.category]||'正在读取…';
  $('#workTimeline').hidden=kind!=='work'||!!workSelected||!!diarySelected;
  $('#logRecords').hidden=kind==='work'&&!workSelected;
  $('#logPagination').hidden=!!workSelected||!!diarySelected;
  $('#logSearchToggle').hidden=!!workSelected||!!diarySelected||!['work','diary'].includes(kind);
  if(!sheet){$('#logSearchBox').hidden=true;$('#memorySearchBox').hidden=true;}
 }
 function route(){return {panel:visible,logOpen,kind,memoryOpen,category:state.memory.category,workSelected,diarySelected,session:historySession};}
 function pushRoute(change){
  history.replaceState({...history.state,ziweiRecords:route()},'');
  change();history.pushState({...history.state,ziweiRecords:route()},'');
  pageChrome();window.scrollTo({top:0});
  const heading=$(visible==='memory'?'#memoryDetailTitle':'#logDetailTitle');heading?.focus({preventScroll:true});
 }
 function back(){if(history.state?.ziweiRecords?.session===historySession)history.back();}
 addEventListener('popstate',event=>{
  const r=event.state?.ziweiRecords;if(!token||!r||r.session!==historySession||!['logs','memory'].includes(r.panel))return;
  if(visible!==r.panel)document.querySelector('[data-tab="'+r.panel+'"]').click();
  sequence++;busy=false;clearTimeout(searchTimer);logOpen=r.logOpen;kind=r.kind;memoryOpen=r.memoryOpen;workSelected=r.workSelected;diarySelected=r.diarySelected||null;state.memory.category=r.category;if(!memoryOpen){state.memory.q='';state.memory.offset=0;$('#memorySearch').value='';}
  memoryChrome();logChrome();pageChrome();
  if(r.panel==='logs'&&logOpen&&state[kind])render(kind);else if(r.panel==='memory'&&memoryOpen)render('memory');
  if((r.panel==='logs'&&logOpen||r.panel==='memory')&&!workSelected&&!diarySelected)void load();
  window.scrollTo({top:0});if(r.panel==='logs'&&!logOpen)document.querySelector('[data-log-kind="'+kind+'"]')?.focus({preventScroll:true});else if(r.panel==='memory'&&!memoryOpen)document.querySelector('.memory-primary')?.focus({preventScroll:true});
 });
 function metadata(k,value){
  const key=k==='memory'?'memory:'+state.memory.category:k;
  if(state[k].offset===0){const dates=value.data.map(r=>r.at||r.savedAt||r.date).filter(x=>x&&Number.isFinite(Date.parse(x))).sort();pageMeta[key]='共 '+value.total+' 条 · 最近更新 '+(dates.length?(/^\d{4}-\d{2}-\d{2}$/.test(dates.at(-1))?dates.at(-1).replaceAll('-','.') : new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok',hour12:false}).format(new Date(dates.at(-1)))):'未提供');}
  pageChrome();
 }
 const memoryTitles={memory:'长期记忆原文',user:'关于你',self:'关于知微',protected:'长期记忆',work:'工作记忆',uncategorized:'待归类的原生记忆'};
 const memoryHints={memory:'MEMORY.md 原生原文；保护状态以每条后台标记为准。',user:'你的资料、偏好，以及与你有关的记忆。',self:'知微对自身身份、性格与经历的记忆。',protected:'后端设定的受保护记忆；保护规则由后端执行。',work:'代码、项目和实际工作中保存的记忆。',uncategorized:'这些原生记录没有明确分类，保留原文，等待补充分类标记。'};
 function memoryChrome(value){
  if(value)memorySnapshot=value;value=value||memorySnapshot;
  const category=state.memory.category,overview=!memoryOpen;$('#memoryOverview').hidden=!overview;$('#memoryDetail').hidden=overview;
  $('#memoryDetailTitle').textContent=category==='all'?'全部记忆':memoryTitles[category]||'记忆';$('#memoryDetailHint').textContent=category==='all'?'知微保存的全部原生记忆，只读查看。':memoryHints[category]||'';
  if(value){
   const counts={...value.counts,all:value.total};
   for(const b of document.querySelectorAll('[data-memory-count]')){const count=counts[b.dataset.memoryCount];b.textContent=Number.isSafeInteger(count)?count+' 条':'待同步';}
   for(const c of ['user','work']){const count=counts[c],small=Number.isSafeInteger(count)&&count<=1;document.querySelector('.memory-entry[data-memory-category="'+c+'"]').hidden=small;document.querySelector('#memorySmallEntries [data-memory-category="'+c+'"]').hidden=!small;}
   const count=counts.uncategorized;$('#memoryUncategorized').hidden=!Number.isSafeInteger(count)||count===0;$('#memoryUncategorized').textContent=count?'未分类 '+count+' 条 · 查看原文':'';
   const file=value.overview?.files?.find(f=>f.name==='MEMORY.md'),metric=Number.isSafeInteger(file?.chars)&&file.chars>=0&&Number.isSafeInteger(file?.budget)&&file.budget>0;
   $('#memoryBudgetValue').hidden=$('#memoryBudgetBar').hidden=$('#memoryBudgetHint').hidden=!metric;$('#memoryPrimaryTitle [data-memory-count]').hidden=metric;$('#memoryAllLink').textContent='全部记忆 '+value.total+' 条 · 可搜索、按分类筛选';
   if(metric){$('#memoryPrimaryTitle').firstChild.textContent='长期记忆 ';$('#memoryBudgetValue').replaceChildren(el('span','',file.chars.toLocaleString()+' / '+file.budget.toLocaleString()),el('small','',' 字'));$('#memoryBudgetBar').value=Math.min(100,file.chars/file.budget*100);$('#memoryBudgetHint').textContent=file.chars/file.budget>=.9?'快满了，留下值得记住的。':'知微自己的长期记录。';}
   else $('#memoryPrimaryTitle').firstChild.textContent='全部记忆 ';
   const row=value.overview?.excerpt||value.data?.[0],excerpt=$('#memoryMainExcerpt');excerpt.textContent=row?.content?'原文摘录：「'+row.content+'」':'这里还没有可读取的原生记忆。';excerpt.disabled=!row;excerpt.onclick=()=>{openMemory(value.overview?.excerpt?'memory':'all');if(row){state.memory.expanded.add(row.id);memoryOriginalId=row.id;}};
  }
  const sources=value?.protectedSources||[];$('#memoryProtectedSources').hidden=category!=='protected'||!sources.length;$('#memoryProtectedSources').textContent=sources.length?'后端另标记了受保护文件：'+sources.join('、')+'。当前接口未提供这些文件的原文。':'';
  $('#memoryCategoryFilters').hidden=overview;for(const b of document.querySelectorAll('[data-memory-filter]'))b.setAttribute('aria-pressed',String(b.dataset.memoryFilter===category));
  pageChrome();
 }
 function openMemory(category){
  pushRoute(()=>{memoryOpen=true;state.memory.category=category;state.memory.offset=0;state.memory.q='';state.memory.data=[];$('#memorySearch').value='';$('#memoryRecords').replaceChildren();$('#memoryEmpty').hidden=true;memoryChrome();});sequence++;busy=false;void load();
 }

 const labels={pending:'待执行',in_progress:'执行中',completed:'已完成（后台记录）',failed:'失败',waiting_user:'等待你处理',deferred:'暂缓',saved:'已保存原文',admitted:'已放行一次机会',skipped:'未放行',delivery_failed:'执行后送达失败',recorded:'已记录',unknown:'状态未确认'};
 const bases={agent_task_state:'知微的任务当前状态',system_gate:'系统唤醒检查',cron_execution:'原生 Cron 执行记录',agent_activity_record:'知微保存的活动记录',saved_file:'知微保存的原文',agent_briefing:'知微自主简报 · 本人记录',memory_audit:'原生记忆维护审计'};
 function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function button(text,fn){const b=el('button','text-button',text);b.type='button';b.onclick=fn;return b;}
 function time(value){if(!value||!Number.isFinite(Date.parse(value)))return '记录未提供时间';return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok',hour12:false}).format(new Date(value));}
 function current(){return visible==='memory'?'memory':logOpen?kind:null;}
 function logChrome(){
  const readable=kind==='work'||kind==='diary';
  $('#logReader').hidden=!readable;$('#logRefresh').hidden=!readable;$('#logUnavailable').hidden=readable||kind==='photos';
  const unavailable=$('#logUnavailable');unavailable.replaceChildren();if(kind==='private'){unavailable.append(el('h2','private-log-title','这一格是《默记》'),el('p','private-log-copy','他写给自己，不给人看。哪天他想让你读，他会自己把它改成可分享的那一层——那时它就会出现在个人日志里。'),el('p','private-log-note','只写给知微自己；这里不展示内容、标题、日期或数量，也不读取内容。'));}else if(!readable)unavailable.textContent='照片墙尚未接入，暂时没有可查看的照片。';
  $('#workLogScope').hidden=kind!=='work';if(!readable){$('#workTimeline').replaceChildren();$('#logRecords').replaceChildren();$('#logStatus').textContent='';$('#logError').textContent='';}
  for(const b of document.querySelectorAll('[data-log-kind]')){const selected=b.dataset.logKind===kind;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));}
 }
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
 async function full(k,row){const v=epoch,value=await api('/api/records/'+k+'?id='+encodeURIComponent(row.id));if(v===epoch)documents.set(k+':'+row.id,value);return value;}
 function updateBody(node,content){node.textContent=content;}
 function render(k){
  const s=state[k],list=panels[k];const top=window.scrollY;list.replaceChildren();if(k==='memory'&&!memoryOpen)return;
  if(k==='work'){
   $('#workTimeline').replaceChildren();
   let previousDay=null;
   for(const row of s.data){
    const stamp=row.at||row.savedAt,valid=stamp&&Number.isFinite(Date.parse(stamp)),day=valid?new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Bangkok'}).format(new Date(stamp)):'记录未提供日期';
    if(day!==previousDay){$('#workTimeline').append(el('h2','work-timeline-day',day));previousDay=day;}
    const entry=button('',()=>{pushRoute(()=>{workSelected=row.id;documents.set('work:view:'+row.id,row);});render('work');});entry.className='work-timeline-entry';
    entry.append(el('strong','work-timeline-title',row.title),el('span','work-timeline-summary',row.preview||''),el('time','work-timeline-time',valid?new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Bangkok'}).format(new Date(stamp)):'时间未提供'));entry.setAttribute('aria-label','查看工作记录：'+row.title);$('#workTimeline').append(entry);
   }
  }
  const selected=k==='work'?workSelected:k==='diary'?diarySelected:null;
  for(const row of selected?[s.data.find(x=>x.id===selected)||documents.get(k+':view:'+selected)].filter(Boolean):s.data){
   if(k==='work'&&row.id!==workSelected)continue;
   const card=el('article','glass record-card '+(k==='diary'?'diary-card':k==='memory'?'memory-card':'work-card'));card.dataset.id=row.id;
   const date=el('div','record-date');date.append(el('time','',k==='diary'&&row.date?row.date.replaceAll('-','.'):time(row.at||row.savedAt)),el('span','record-date-line'));card.append(date);
   if(k==='diary'){
    const author=el('p','record-author');author.textContent=($('#ziweiName').textContent||'知微')+' · 个人日记';card.append(author);
    const meta=el('dl','diary-meta');
    for(const [field,label] of [['weather','天气'],['mood','心情']]){
     const value=typeof row[field]==='string'?row[field].trim():'',item=el('div','diary-meta-item');
     item.append(el('dt','',label),el('dd','diary-'+field,value||'未记录'));meta.append(item);
    }
    card.append(meta);
   }
   card.append(el('h2','record-title',row.title));
   if(k==='work'){card.append(el('span','record-state',row.basis==='memory_audit'&&row.state==='pending'?'等待核验':row.basis==='agent_task_state'&&row.state==='completed'?'标记完成':labels[row.state]||'状态未确认'),el('p','record-basis',bases[row.basis]||'后台原始记录'));if(row.recordedState)card.append(el('p','record-basis','原始状态：'+row.recordedState));if(row.opportunity!==null&&row.opportunity!==undefined)card.append(el('p','record-basis','第 '+row.opportunity+' 次自主机会'));}
   if(k==='memory'&&row.protected===true)card.append(el('span','record-state','后端受保护'));else if(k==='memory'&&row.categories?.includes('protected'))card.append(el('p','record-basis','保护状态尚未由后端确认'));
   if(k==='memory'&&Number.isSafeInteger(row.chars))card.append(el('p','record-basis',row.chars+' 字符 · '+row.lines+' 行'));
   const content=el('div','record-body');let doc=documents.get(k+':'+row.id);if(k==='memory')doc=row;
   const expanded=k==='work'||k==='diary'&&!!diarySelected||s.expanded.has(row.id);content.classList.toggle('collapsed',!expanded);updateBody(content,expanded&&doc?doc.content:row.preview??row.content??'');card.append(content);
   if(row.error)card.append(el('p','error','原文读取失败，请刷新后重试。'));
   const actions=el('div','record-actions');
   if(k==='memory'||row.document&&k!=='diary'){
    const toggle=button(expanded?'收起 ▴':'展开 ▾',async()=>{const v=epoch;if(s.expanded.has(row.id)){s.expanded.delete(row.id);render(k);return;}toggle.disabled=true;try{if(k!=='memory'){doc=await full(k,row);if(v!==epoch)return;updateBody(content,doc.content);}else updateBody(content,row.content);s.expanded.add(row.id);content.classList.remove('collapsed');toggle.textContent='收起 ▴';}catch(e){if(v===epoch)errorNode(k).textContent=e.message;}finally{if(v===epoch)toggle.disabled=false;}});actions.append(toggle);
    if(expanded&&k!=='memory'&&(!doc||doc.revision!==row.revision)){const v=epoch;full(k,row).then(value=>{if(v===epoch&&content.isConnected)updateBody(content,value.content);}).catch(e=>{if(v===epoch)errorNode(k).textContent=e.message;});}
   }
   if(k==='diary'&&!diarySelected){
    const openDiary=()=>{pushRoute(()=>{diarySelected=row.id;documents.set('diary:view:'+row.id,row);});render('diary');};
    const open=button('打开日记 ↗',openDiary);open.className='diary-open text-button';actions.append(open);
    card.addEventListener('click',event=>{if(!event.target.closest('button,a,input,textarea,select,summary,details'))openDiary();});
   }
   if(k==='diary'&&diarySelected)actions.append(button('和知微聊这篇',async()=>{const v=epoch;try{const doc=await full(k,row);if(v!==epoch)return;const draft='我想和你聊这篇日记：'+(row.date||row.title)+'\n\n「'+doc.content.slice(0,2000)+'」\n\n';if(onReply&&!onReply(draft))errorNode(k).textContent='聊天里还有未发送内容或正在处理的消息，请先处理后再回复日记。';}catch(e){if(v===epoch)errorNode(k).textContent=e.message;}}));
   if(row.references?.length)card.append(el('p','record-basis','记录中的引用：'+row.references.join('、')));
   if(row.evidence?.length){const box=el('div','record-evidence');box.append(el('p','',row.evidenceVerified?'成果文件已落盘；文件存在不代表外部任务结果已核实。':'部分成果文件缺失或无法读取。'));for(const item of row.evidence){if(item.saved&&item.id){const a=el('a','record-artifact',item.source+' · '+item.bytes+' B');a.href='/api/records/artifact?id='+encodeURIComponent(item.id);a.download='';box.append(a);}else box.append(el('p','error',item.source+' · 未找到有效成果'));}card.append(box);}
   if(k==='work'&&row.basis==='agent_task_state'&&row.state==='completed'&&!row.evidence?.length)card.append(el('p','record-basis','没有可核对的成果文件，当前只能确认任务被标记完成。'));
   if(k==='diary'&&diarySelected&&(!doc||doc.revision!==row.revision)){const v=epoch;full(k,row).then(value=>{if(v===epoch&&content.isConnected)updateBody(content,value.content);}).catch(e=>{if(v===epoch)errorNode(k).textContent=e.message;});}
   card.append(actions);const provenance=el('details','record-provenance');provenance.append(el('summary','','来源与保存时间'),el('p','',row.source),el('p','','保存于 '+time(row.savedAt||row.at)));if(row.revision)provenance.append(el('p','','内容指纹 '+row.revision.slice(0,12)));if(k==='memory'&&row.classificationBasis)provenance.append(el('p','','分类依据：'+row.classificationBasis));card.append(provenance);list.append(card);if(k==='memory'&&row.id===memoryOriginalId){provenance.open=true;card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'start'});memoryOriginalId=null;}
  }
  const empty=$(k==='memory'?'#memoryEmpty':'#logEmpty');empty.hidden=s.data.length>0;empty.textContent=s.q?'没有找到符合条件的原始记录。':k==='diary'?'知微还没有在当前日记目录保存日记。':k==='memory'?'这个分类还没有可读取的原生记忆。':'当前没有可读取的工作记录。';
  $(k==='memory'?'#memoryPrevious':'#logPrevious').disabled=s.offset===0;$(k==='memory'?'#memoryNext':'#logNext').disabled=s.next===null;
  if(top>0)window.scrollTo({top});
 }
 async function load(){
  if(!token||!visible)return;const k=current(),s=state[k];if(!s)return;const v=epoch,run=++sequence;busy=true;const status=statusNode(k);status.textContent=s.data.length?'正在核对后台更新…':'正在读取知微后台…';errorNode(k).textContent='';
  try{const params=new URLSearchParams({limit:'20',offset:String(s.offset),q:s.q,...(k==='memory'?{category:s.category}:{})}),value=await api('/api/records/'+k+'?'+params);if(v!==epoch||run!==sequence||current()!==k)return;if(!Array.isArray(value.data)||value.source!=='hermes_native')throw Error('未收到可核对的原生记录。');s.data=value.data;s.next=value.nextOffset??null;if(k==='memory'&&!memoryOpen)memoryChrome(value);else if(k==='memory')memoryChrome();metadata(k,value);render(k);status.textContent='后台核对于 '+time(value.checkedAt)+' · '+value.total+(k==='memory'?' 条原生记忆':' 条记录');if(value.errors?.length)errorNode(k).textContent='部分来源缺失或读取失败：'+value.errors.map(x=>x.source).join('、')+'。现有列表可能不完整。';if(k==='work'&&value.workLogWindow)$('#workLogScope').textContent='展示知微的自主简报与记忆维护记录，以原生后台实际返回为准。每次刷新最多读取 2,000 条，不补写历史。';}
  catch(e){if(v===epoch&&run===sequence){status.textContent=s.data.length?'后台更新未确认，以下保留上次读取结果。':'尚未读到真实后台记录。';errorNode(k).textContent=e.message;$(k==='memory'?'#memoryEmpty':'#logEmpty').hidden=true;}}
  finally{if(v===epoch&&run===sequence)busy=false;}
 }
 async function loadOverview(){
  if(!token||visible!=='logs'||logOpen)return;const v=epoch,run=++overviewRun;
  const [diaryResult,workResult,photoResult]=await Promise.allSettled([api('/api/records/diary?limit=1&offset=0'),api('/api/records/work?limit=1&offset=0'),api('/api/photos?limit=100')]);if(v!==epoch||run!==overviewRun||visible!=='logs'||logOpen)return;
  if(diaryResult.status==='fulfilled'){const diary=diaryResult.value;todayDiary=diary.data?.[0]||null;$('#logTodayDate').textContent=todayDiary?.date||'还没有可分享的日记';$('#logTodayTitle').textContent=todayDiary?.title||'把今天留给以后';$('#logTodayPreview').textContent=todayDiary?.preview||'';$('#logTodayContinue').disabled=!todayDiary;$('#logDiaryMeta').textContent='共 '+diary.total+' 篇 · 最近更新 '+(todayDiary?.date||'未提供');}
  else{$('#logTodayDate').textContent='最近日记未读到，点入口重试。';$('#logTodayContinue').disabled=true;}
  if(workResult.status==='fulfilled'){const work=workResult.value;$('#logWorkMeta').textContent='共 '+work.total+' 条 · 最近更新 '+(work.data?.[0]?.at?time(work.data[0].at):'未提供');}
  $('#logPhotoThumbs').replaceChildren();if(photoResult.status==='fulfilled'){const days=new Set();for(const photo of photoResult.value.data||[]){if(days.has(photo.date))continue;days.add(photo.date);const img=el('img');img.src='/api/photos/'+encodeURIComponent(photo.id)+'/file?thumb=1';img.alt=photo.date+' 的照片';img.loading='lazy';$('#logPhotoThumbs').append(img);if(days.size===3)break;}}
 }
 $('#logTodayContinue').onclick=async()=>{if(!todayDiary||!onReply)return;const v=epoch;try{const doc=await full('diary',todayDiary);if(v!==epoch)return;if(!onReply('我想继续聊这篇日记：'+todayDiary.title+'\n\n「'+doc.content.slice(0,2000)+'」\n\n你愿意接着写吗？'))$('#logTodayDate').textContent='聊天里还有未发送内容或正在处理的消息，请先处理后再继续。';}catch(e){if(v===epoch)$('#logTodayDate').textContent=e.message;}};
 function show(name,csrf,reply){
  if(token!==csrf){stop();token=csrf;}onReply=reply;
  if(name!==visible){sequence++;busy=false;clearTimeout(searchTimer);logOpen=false;memoryOpen=false;workSelected=null;diarySelected=null;kind='work';state.memory.category='all';state.memory.q='';state.memory.offset=0;$('#memorySearch').value='';memorySnapshot=null;}
  visible=['memory','logs'].includes(name)?name:null;memoryChrome();logChrome();pageChrome();
  clearInterval(timer);timer=null;if(!visible)return;if(visible==='logs'&&!logOpen)void loadOverview();else void load();timer=setInterval(()=>{if(!document.hidden&&!busy){if(visible==='logs'&&!logOpen)void loadOverview();else void load();}},30000);
 }
 function stop(){window.ZiweiImpressions?.stop();historySession++;logOpen=false;memoryOpen=false;workSelected=null;diarySelected=null;memoryOriginalId=null;memorySnapshot=null;for(const key of Object.keys(pageMeta))delete pageMeta[key];overviewRun++;todayDiary=null;$('#logPhotoThumbs').replaceChildren();$('#logTodayTitle').textContent='等待读取真实日记';$('#logTodayPreview').textContent='';$('#logTodayDate').textContent='';$('#logTodayContinue').disabled=true;$('#workTimeline').replaceChildren();visible=null;pageChrome();epoch++;sequence++;token=null;visible=null;onReply=null;busy=false;clearInterval(timer);clearTimeout(searchTimer);timer=null;documents.clear();for(const s of Object.values(state)){s.data=[];s.offset=0;s.next=null;s.q='';s.category='all';s.expanded.clear();}$('#logRecords').replaceChildren();$('#memoryRecords').replaceChildren();for(const id of ['logStatus','logError','memoryStatus','memoryError'])$('#'+id).textContent='';$('#logSearch').value='';$('#memorySearch').value='';kind='work';logChrome();memoryChrome();for(const b of document.querySelectorAll('[data-memory-count]'))b.textContent='待同步';$('#memoryUncategorized').hidden=true;$('#memoryUncategorized').textContent='';$('#memoryMainExcerpt').textContent='等待读取真实记忆';$('#memoryMainExcerpt').disabled=true;$('#memoryMainExcerpt').onclick=null;$('#memoryBudgetValue').hidden=$('#memoryBudgetBar').hidden=$('#memoryBudgetHint').hidden=true;$('#memoryBudgetValue').textContent='';$('#memoryBudgetBar').value=0;$('#memoryAllLink').textContent='全部记忆 · 可搜索、按分类筛选';$('#logWorkMeta').textContent='等待读取工作记录';$('#logDiaryMeta').textContent='等待读取个人日记';}
 for(const b of document.querySelectorAll('[data-log-kind]'))b.onclick=()=>{
  pushRoute(()=>{kind=b.dataset.logKind;logOpen=true;workSelected=null;diarySelected=null;sequence++;busy=false;clearTimeout(searchTimer);$('#logSearch').value=state[kind]?.q||'';$('#logRecords').replaceChildren();$('#workTimeline').replaceChildren();$('#logStatus').textContent='';$('#logError').textContent='';$('#logEmpty').hidden=true;$('#logSearchBox').hidden=true;logChrome();});void load();
 };
 $('#memoryHomeBack').onclick=()=>document.querySelector('[data-tab=home]').click();
 $('#memoryOverviewSearch').onclick=()=>{openMemory('all');$('#memorySearchBox').hidden=false;$('#memorySearchToggle').setAttribute('aria-expanded','true');$('#memorySearch').focus();};
 for(const b of document.querySelectorAll('[data-memory-filter]'))b.onclick=()=>openMemory(b.dataset.memoryFilter);
 $('#logBack').onclick=back;$('#memoryBack').onclick=back;$('#memoryOverviewRefresh').onclick=()=>{void load();};
 for(const prefix of ['log','memory'])$('#'+prefix+'SearchToggle').onclick=()=>{const box=$('#'+prefix+'SearchBox');box.hidden=!box.hidden;$('#'+prefix+'SearchToggle').setAttribute('aria-expanded',String(!box.hidden));if(!box.hidden)$('#'+prefix+'Search').focus();};
 for(const k of ['logs','memory']){
  const prefix=k==='logs'?'log':'memory';$('#'+prefix+'Refresh').onclick=()=>{void load();};
  $('#'+prefix+'Search').oninput=e=>{const s=state[current()];if(!s)return;s.q=e.target.value;s.offset=0;sequence++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{void load();},300);};
  $('#'+prefix+'Previous').onclick=()=>{const s=state[current()];if(!s)return;s.offset=Math.max(0,s.offset-20);void load();};
  $('#'+prefix+'Next').onclick=()=>{const s=state[current()];if(s&&s.next!==null){s.offset=s.next;void load();}};
 }
 for(const b of document.querySelectorAll('[data-memory-category]'))b.onclick=()=>openMemory(b.classList.contains('memory-primary')&&memorySnapshot?.overview?.files?.some(f=>f.name==='MEMORY.md')?'memory':b.dataset.memoryCategory);$('#memoryUncategorized').onclick=()=>openMemory('uncategorized');
 document.addEventListener('visibilitychange',()=>{if(visible&&!document.hidden&&!busy)void load();});
 async function openDiaryById(id){
  if(!token)return;const v=epoch;
  try{const doc=await api('/api/records/diary?id='+encodeURIComponent(id));if(v!==epoch)return;
   const row={...doc,id,preview:doc.content,document:true};documents.set('diary:'+id,doc);documents.set('diary:view:'+id,row);
   pushRoute(()=>{kind='diary';logOpen=true;workSelected=null;diarySelected=id;});render('diary');
  }catch(e){if(v===epoch){const box=$('#impressionsError');box.hidden=false;box.textContent=e.message;}}
 }
 return {show,stop,openDiaryById};
})();

/* 右上角贴纸：真实元素，挂在卡片里（卡片被移除，贴纸随之消失）。
   语 2026-10-19：不要伪元素、不要边框、不要阴影，贴纸要实色。
   今日印记（.imp-card）不在此列——那里是知微自己的表情贴纸，保持原样。 */
(function(){
  // Replace these paths/mappings to change the sticker set; an entrance can override
  // one image with data-sticker-src. Size/offset remain shared CSS variables.
  const STICKERS=Object.fromEntries(['heart','ribbon','blossoms','leaves'].map(name=>[name,'/stickers/watercolor-'+name+'-v1.png']));
  const LOG_STICKERS={work:'leaves',diary:'ribbon',private:'heart',photos:'blossoms'};
  const MEMORY_STICKERS={user:'blossoms',work:'leaves'};
  function decorate(root){
    const cards=root.querySelectorAll('#logs .log-entry:not([data-log-kind="impressions"]), #memory .memory-main-group, #memory .memory-entry:not(.memory-primary)');
    cards.forEach(card=>{
      if(card.querySelector(':scope > .card-sticker'))return;
      const img=document.createElement('img');
      img.className='card-sticker'; img.alt=''; img.setAttribute('aria-hidden','true');
      const key=card.dataset.logKind?LOG_STICKERS[card.dataset.logKind]:MEMORY_STICKERS[card.dataset.memoryCategory];
      img.src=card.dataset.stickerSrc||STICKERS[key||'heart'];
      card.appendChild(img);
    });
  }
  function boot(){
    decorate(document);
    // These overview entrances are stable index.html nodes. Only their content
    // and hidden state change; chat/clock mutations never need redecoration.
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
