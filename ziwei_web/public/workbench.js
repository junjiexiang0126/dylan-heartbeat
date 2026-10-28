'use strict';
(()=>{
 const $=s=>document.querySelector(s);let csrf=null,pokeBusy=false,pokeId=null,pokeTarget=null,pokeTime=0;
 const row=(box,label,value)=>{const d=document.createElement('div'),s=document.createElement('span'),b=document.createElement('strong');s.textContent=label;b.textContent=value===null||value===undefined?'待同步':typeof value==='number'?value.toLocaleString('zh-CN'):typeof value==='object'?JSON.stringify(value):String(value);d.append(s,b);box.append(d);};
 const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Bangkok'}):'待同步';
 async function get(url,method='GET',body){const r=await fetch(url,{method,cache:'no-store',headers:{'X-Ziwei-CSRF':csrf,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(r.status===401)window.dispatchEvent(new Event('ziwei-session-expired'));if(!r.ok)throw Error(value.error);return value;}
 async function refresh(){const b=$('#workbenchRefresh');b.disabled=true;$('#workbenchError').textContent='';try{const value=await get('/api/workbench');if(!csrf)return;const n=value.native;for(const id of ['workbenchOverview','workbenchUsage','workbenchWakes','workbenchTasks'])$('#'+id).replaceChildren();const status={online:'在线',offline:'离线',unknown:'未核实'};row($('#workbenchOverview'),'最近检查',time(value.checkedAt));row($('#workbenchOverview'),'网页',status[value.web.status]);for(const [key,label] of [['hermes','Hermes'],['gateway','Gateway'],['guardian','Guardian']])row($('#workbenchOverview'),label,status[n.services[key]]||'未核实');row($('#workbenchOverview'),'网页版本',value.web.commit?.slice(0,8)||'未提供');row($('#workbenchOverview'),'原生版本',n.deployment.commit?.slice(0,8)||'未提供');row($('#workbenchOverview'),'审核脚本',n.preflightUpgrade?.state==='updated'||n.preflightUpgrade?.state==='already_current'?'已核对新版本':'尚未收到升级回执');row($('#workbenchOverview'),'今日已用唤醒机会',n.wakeCounter?.wakes===undefined?null:n.wakeCounter.isCurrentDate===true?n.wakeCounter.wakes+' 次（上限待核实）':'待核对（最近计数：'+(n.wakeCounter.date||'日期未知')+'，'+n.wakeCounter.wakes+' 次）');for(const m of n.memoryStorage||[])row($('#workbenchOverview'),'记忆保存 · '+m.name,time(m.savedAt));

 const u=n.usage||{},totals=u.totals||{};
 const totalTokens=['input_tokens','output_tokens','cache_read_tokens'].every(k=>Number.isFinite(Number(totals[k])))?['input_tokens','output_tokens','cache_read_tokens'].reduce((sum,k)=>sum+Number(totals[k]),0):null;
 const providersBox=$('#workbenchProviders');providersBox.replaceChildren();
 const providerRows=Array.isArray(value.providers)?value.providers:Array.isArray(n.providers)?n.providers:[];
 const known=[{id:'deepseek',name:'DeepSeek',balance:true},{id:'bailian',name:'阿里云百炼'},{id:'zhipu',name:'智谱 GLM'},{id:'codex',name:'OpenAI / Codex'}];
 const byName=p=>String(p.id||p.provider||p.name||'').toLowerCase();
 const existing=new Set();
 function addProvider(p,knownInfo){
   const name=knownInfo?.name||String(p?.name||p?.provider||'其他供应商'),id=knownInfo?.id||byName(p);
   if(existing.has(id))return;existing.add(id);
   const card=document.createElement('details');card.className='wb-provider';if(id==='deepseek')card.open=true;
   const summary=document.createElement('summary'),title=document.createElement('span'),sub=document.createElement('small');
   title.textContent=name;sub.textContent=p?.status_label||p?.status||((id==='deepseek')?'余额查询已接入':'数据接口待核实');
   const head=document.createElement('span');head.className='wb-provider-name';head.append(title,sub);summary.append(head);card.append(summary);
   const body=document.createElement('div');body.className='wb-provider-body';
   const grid=document.createElement('div');grid.className='wb-provider-grid';
   const balance=document.createElement('div'),usage=document.createElement('div');balance.className=usage.className='wb-provider-metric';
   const bLabel=document.createElement('small'),bValue=document.createElement('strong'),uLabel=document.createElement('small'),uValue=document.createElement('strong');
   bLabel.textContent='账户余额';uLabel.textContent='累计 Token';
   bValue.textContent=p?.balance?.display||p?.balance_display||((id==='deepseek')?'点击查询':'待接入');
   const count=p?.usage?.total_tokens??p?.total_tokens;
   uValue.textContent=Number.isFinite(Number(count))&&count!==undefined&&count!==null?Number(count).toLocaleString('zh-CN'):'待核实';
   balance.append(bLabel,bValue);usage.append(uLabel,uValue);grid.append(balance,usage);body.append(grid);
   const calls=document.createElement('p');calls.className='wb-provider-calls';
   const callCount=p?.usage?.api_call_count??p?.api_call_count;
   calls.textContent='累计调用次数 · '+(callCount===undefined||callCount===null?'待核实':Number(callCount).toLocaleString('zh-CN'));body.append(calls);
   if(id==='deepseek'){
     const button=$('#workbenchBalance');button.hidden=false;body.append(button,$('#workbenchBalanceText'));
   }
   if(p?.usage&&typeof p.usage==='object'){
     const detail=document.createElement('details');detail.className='wb-provider-detail';const s=document.createElement('summary');s.textContent='Token 明细';detail.append(s);
     const rows=document.createElement('div');rows.className='workbench-rows';
     for(const [key,label] of [['input_tokens','输入'],['output_tokens','输出'],['cache_read_tokens','缓存读取']])row(rows,label,p.usage[key]);detail.append(rows);body.append(detail);
   }
   card.append(body);providersBox.append(card);
 }
 for(const info of known){const aliases=info.id==='bailian'?['bailian','dashscope','aliyun','qwen']:info.id==='zhipu'?['zhipu','glm','bigmodel']:info.id==='codex'?['codex','openai']:['deepseek'];const found=providerRows.find(p=>aliases.some(a=>byName(p).includes(a)));addProvider(found,info);}
 for(const p of providerRows){if(!known.some(k=>k.name===p.name||k.id===byName(p)))addProvider(p);}
 row($('#workbenchUsage'),'统计范围','Hermes 已记录会话累计，不代表任何单一供应商账户总量');
 row($('#workbenchUsage'),'累计 Token（输入＋输出＋缓存读取）',totalTokens);
 for(const [key,label] of [['input_tokens','输入 Token'],['output_tokens','输出 Token'],['cache_read_tokens','缓存读取 Token'],['api_call_count','API 调用次数']])row($('#workbenchUsage'),label,totals[key]);

 for(const w of n.wakes||[])row($('#workbenchWakes'),time(w.time),w.wakeAgent?'已放行第 '+(w.opportunity||'?')+' 次机会':(w.reason||'跳过')+(w.error_type?' · '+w.error_type:'')+(w.invalid_completions?.length?' · 待核实任务：'+w.invalid_completions.join('、'):''));if(!(n.wakes||[]).length)row($('#workbenchWakes'),'记录','尚未读取到唤醒记录');for(const t of n.tasks||[])row($('#workbenchTasks'),t.title||t.name||t.id,t.status||'未知');if(!(n.tasks||[]).length)row($('#workbenchTasks'),'任务','暂无可展示记录');$('#workbenchStatus').textContent='只读预览 · 数据更新时间 '+time(n.checkedAt);}catch{$('#workbenchError').textContent='工作台暂未同步成功，请稍后刷新；不会把未知状态显示为正常。';}finally{b.disabled=false;}}
 $('#openWorkbench').onclick=()=>{$('#settings').close();$('#workbench').showModal();void refresh();};$('#closeWorkbench').onclick=()=>$('#workbench').close();$('#workbenchRefresh').onclick=refresh;$('#workbenchBalance').onclick=async()=>{const b=$('#workbenchBalance');b.disabled=true;try{const r=await get('/api/workbench/balance');if(!csrf)return;$('#workbenchBalanceText').textContent=r.available?(r.balances||[]).map(v=>v.currency+' '+v.total_balance).join(' · ')+'（账户余额）':'余额暂未同步';}catch{$('#workbenchBalanceText').textContent='余额暂未同步';}finally{b.disabled=false;}};
 async function poke(target='ziwei'){if(!csrf||pokeBusy)return;if(!pokeId&&Date.now()-pokeTime<3000){$('#pokeNotice').textContent='刚刚拍过，稍等一下。';return;}if(pokeId&&pokeTarget!==target){$('#pokeNotice').textContent='上一条拍一拍待核对，请先重试原来的头像。';return;}pokeBusy=true;pokeId=pokeId||crypto.randomUUID();pokeTarget=target;try{const r=await get('/api/chat/poke','POST',{id:pokeId,target});if(!csrf)return;pokeId=null;pokeTime=Date.now();$('#pokeNotice').textContent=r.notified?'已拍一拍；知微可以自行决定是否回应。':'已保存，连接恢复后会通知知微。';const avatar=target==='ziwei'?$('#chatAvatar'):$('#userAvatar');avatar?.classList.remove('poke-shake');requestAnimationFrame(()=>avatar?.classList.add('poke-shake'));window.dispatchEvent(new Event('ziwei-poke-saved'));}catch(e){$('#pokeNotice').textContent=e.message==='poke_cooldown'?'拍得有点快，稍等一下再试。':'拍一拍结果待核对，再次点击会核对同一条事件。';if(e.message==='poke_cooldown')pokeId=null;}finally{pokeBusy=false;}}
 document.addEventListener('dblclick',e=>{const a=e.target.closest('.message-avatar,#chatAvatar');if(!a||a.closest('.archive'))return;e.preventDefault();void poke(a.dataset.role==='user'?'user':'ziwei');});
 for(const id of ['pokeNotice','momentNotificationToast']){const element=$('#'+id);let timer;new MutationObserver(()=>{clearTimeout(timer);if(element.textContent)timer=setTimeout(()=>{element.textContent='';},6500);}).observe(element,{childList:true,characterData:true,subtree:true});}
 window.ZiweiPoke={send:poke,configure(token){csrf=token;},stop(){csrf=null;pokeId=null;pokeBusy=false;$('#pokeNotice').textContent='';if($('#workbench').open)$('#workbench').close();for(const id of ['workbenchOverview','workbenchUsage','workbenchWakes','workbenchTasks'])$('#'+id).replaceChildren();$('#workbenchBalanceText').textContent='';$('#workbenchProviders').replaceChildren();$('#workbenchStatus').textContent='';$('#workbenchError').textContent='';}};
})();
