'use strict';
(()=>{
 const $=s=>document.querySelector(s);let csrf=null,pokeBusy=false,pokeId=null,pokeTarget=null,pokeTime=0;
 const row=(box,label,value)=>{const d=document.createElement('div'),s=document.createElement('span'),b=document.createElement('strong');s.textContent=label;b.textContent=value===null||value===undefined?'待同步':typeof value==='object'?JSON.stringify(value):String(value);d.append(s,b);box.append(d);};
 const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Bangkok'}):'待同步';
 async function get(url,method='GET',body){const r=await fetch(url,{method,cache:'no-store',headers:{'X-Ziwei-CSRF':csrf,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(r.status===401)window.dispatchEvent(new Event('ziwei-session-expired'));if(!r.ok)throw Error(value.error);return value;}
 async function refresh(){const b=$('#workbenchRefresh');b.disabled=true;$('#workbenchError').textContent='';try{const value=await get('/api/workbench');if(!csrf)return;const n=value.native;for(const id of ['workbenchOverview','workbenchUsage','workbenchWakes','workbenchTasks'])$('#'+id).replaceChildren();const status={online:'在线',offline:'离线',unknown:'未核实'};row($('#workbenchOverview'),'最近检查',time(value.checkedAt));row($('#workbenchOverview'),'网页',status[value.web.status]);for(const [key,label] of [['hermes','Hermes'],['gateway','Gateway'],['guardian','Guardian']])row($('#workbenchOverview'),label,status[n.services[key]]||'未核实');row($('#workbenchOverview'),'网页版本',value.web.commit?.slice(0,8)||'未提供');row($('#workbenchOverview'),'原生版本',n.deployment.commit?.slice(0,8)||'未提供');row($('#workbenchOverview'),'审核脚本',n.preflightUpgrade?.state==='updated'||n.preflightUpgrade?.state==='already_current'?'已核对新版本':'尚未收到升级回执');row($('#workbenchOverview'),'今日已用唤醒机会',n.wakeCounter?.wakes===undefined?null:n.wakeCounter.isCurrentDate===true?n.wakeCounter.wakes+' / 6':'待核对（最近计数：'+(n.wakeCounter.date||'日期未知')+'，'+n.wakeCounter.wakes+' / 6）');for(const m of n.memoryStorage||[])row($('#workbenchOverview'),'记忆保存 · '+m.name,time(m.savedAt));
 const u=n.usage;row($('#workbenchUsage'),'统计范围','原生已记录会话累计，不等于今日账单');for(const [key,label] of [['input_tokens','输入 Token'],['output_tokens','输出 Token'],['cache_read_tokens','缓存读取 Token'],['api_call_count','API 调用次数'],['actual_cost_usd','运行记录费用（USD，非结算账单）']])row($('#workbenchUsage'),label,u.totals?.[key]);row($('#workbenchUsage'),'今日／本月精确费用','暂无可靠分日账本');row($('#workbenchUsage'),'服务器费用','暂无可靠账单数据');
 for(const w of n.wakes||[])row($('#workbenchWakes'),time(w.time),w.wakeAgent?'已放行第 '+(w.opportunity||'?')+' 次机会':(w.reason||'跳过')+(w.error_type?' · '+w.error_type:'')+(w.invalid_completions?.length?' · 待核实任务：'+w.invalid_completions.join('、'):''));if(!(n.wakes||[]).length)row($('#workbenchWakes'),'记录','尚未读取到唤醒记录');for(const t of n.tasks||[])row($('#workbenchTasks'),t.title||t.name||t.id,t.status||'未知');if(!(n.tasks||[]).length)row($('#workbenchTasks'),'任务','暂无可展示记录');$('#workbenchStatus').textContent='只读预览 · 数据更新时间 '+time(n.checkedAt);}catch{$('#workbenchError').textContent='工作台暂未同步成功，请稍后刷新；不会把未知状态显示为正常。';}finally{b.disabled=false;}}
 $('#openWorkbench').onclick=()=>{$('#settings').close();$('#workbench').showModal();void refresh();};$('#closeWorkbench').onclick=()=>$('#workbench').close();$('#workbenchRefresh').onclick=refresh;$('#workbenchBalance').onclick=async()=>{const b=$('#workbenchBalance');b.disabled=true;try{const r=await get('/api/workbench/balance');if(!csrf)return;$('#workbenchBalanceText').textContent=r.available?(r.balances||[]).map(v=>v.currency+' '+v.total_balance).join(' · ')+'（账户余额）':'余额暂未同步';}catch{$('#workbenchBalanceText').textContent='余额暂未同步';}finally{b.disabled=false;}};
 async function poke(target='ziwei'){if(!csrf||pokeBusy)return;if(!pokeId&&Date.now()-pokeTime<3000){$('#pokeNotice').textContent='刚刚拍过，稍等一下。';return;}if(pokeId&&pokeTarget!==target){$('#pokeNotice').textContent='上一条拍一拍待核对，请先重试原来的头像。';return;}pokeBusy=true;pokeId=pokeId||crypto.randomUUID();pokeTarget=target;try{const r=await get('/api/chat/poke','POST',{id:pokeId,target});if(!csrf)return;pokeId=null;pokeTime=Date.now();$('#pokeNotice').textContent=r.notified?'已拍一拍；知微可以自行决定是否回应。':'已保存，连接恢复后会通知知微。';const avatar=target==='ziwei'?$('#chatAvatar'):$('#userAvatar');avatar?.classList.remove('poke-shake');requestAnimationFrame(()=>avatar?.classList.add('poke-shake'));window.dispatchEvent(new Event('ziwei-poke-saved'));}catch(e){$('#pokeNotice').textContent=e.message==='poke_cooldown'?'拍得有点快，稍等一下再试。':'拍一拍结果待核对，再次点击会核对同一条事件。';if(e.message==='poke_cooldown')pokeId=null;}finally{pokeBusy=false;}}
 document.addEventListener('dblclick',e=>{const a=e.target.closest('.message-avatar,#chatAvatar');if(!a||a.closest('.archive'))return;e.preventDefault();void poke(a.dataset.role==='user'?'user':'ziwei');});
 for(const id of ['pokeNotice','momentNotificationToast']){const element=$('#'+id);let timer;new MutationObserver(()=>{clearTimeout(timer);if(element.textContent)timer=setTimeout(()=>{element.textContent='';},6500);}).observe(element,{childList:true,characterData:true,subtree:true});}
 window.ZiweiPoke={send:poke,configure(token){csrf=token;window.__ziweiCsrf=token;},stop(){csrf=null;pokeId=null;pokeBusy=false;$('#pokeNotice').textContent='';if($('#workbench').open)$('#workbench').close();for(const id of ['workbenchOverview','workbenchUsage','workbenchWakes','workbenchTasks'])$('#'+id).replaceChildren();$('#workbenchBalanceText').textContent='';$('#workbenchStatus').textContent='';$('#workbenchError').textContent='';}};
})();

// ---- 工作台：等你拍板（2026-10-26 加）----
(()=>{
  const box=()=>document.getElementById('workbenchApprovals');
  const csrf=()=>window.__ziweiCsrf||'';
  async function renderApprovals(){
    const host=box(); if(!host) return;
    host.replaceChildren();
    let data;
    try{
      const r=await fetch('/api/day',{credentials:'same-origin',cache:'no-store'});
      if(!r.ok) throw Error('read');
      data=await r.json();
    }catch(e){
      const p=document.createElement('div');p.textContent='暂时读不到待批清单';host.append(p);return;
    }
    const items=Array.isArray(data.approvals)?data.approvals:[];
    if(!items.length){const p=document.createElement('div');p.textContent='现在没有要你拍板的事';host.append(p);return;}
    for(const item of items){
      const row=document.createElement('div');row.className='wb-approval';
      const t=document.createElement('strong');t.textContent=item.title||'待确认';
      const d=document.createElement('span');d.textContent=item.detail||'';
      const acts=document.createElement('div');acts.className='settings-inline-actions';
      for(const [decision,label] of [['approved','同意'],['rejected','不同意']]){
        const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;
        b.addEventListener('click',async()=>{
          for(const x of acts.children)x.disabled=true;
          try{
            const r=await fetch('/api/day/approve',{method:'POST',credentials:'same-origin',
              headers:{'Content-Type':'application/json','X-Ziwei-CSRF':csrf()},
              body:JSON.stringify({id:item.id,decision})});
            if(!r.ok) throw Error('save');
            acts.replaceChildren();
            const done=document.createElement('span');done.textContent=decision==='approved'?'已同意':'已不同意';acts.append(done);
          }catch(e){
            for(const x of acts.children)x.disabled=false;
            const err=document.getElementById('workbenchError');if(err)err.textContent='没保存上，请重试';
          }
        });
        acts.append(b);
      }
      row.append(t,d,acts);
      host.append(row);
    }
  }
  const hook=(id)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',()=>{setTimeout(renderApprovals,350);});};
  hook('openWorkbench');hook('workbenchRefresh');
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.getElementById('workbench')?.open)renderApprovals();});
})();


// ---- 主界面入口：把工作台搬出设置 ----
(()=>{
  const home=document.getElementById('homeWorkbench');
  if(!home) return;
  home.addEventListener('click',()=>{
    const opener=document.getElementById('openWorkbench');
    if(opener){opener.click();setTimeout(()=>{const f=document.getElementById('workbenchApprovals');if(f&&!f.children.length)document.getElementById('workbenchRefresh')?.click();},400);}
  });
})();

// ---- 工作台：今天做了什么（归拢后的印记，2026-10-26 加）----
(()=>{
  const host=()=>document.getElementById('workbenchDigest');
  const hhmm=ts=>{const d=new Date(ts);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Bangkok'});};
  async function renderDigest(){
    const box=host(); if(!box||box.dataset.loaded==='1') return;
    box.dataset.loaded='1';
    box.replaceChildren();
    let items=[];
    try{
      const r=await fetch('/api/day/digest',{credentials:'same-origin',cache:'no-store'});
      if(r.ok) items=(await r.json()).items||[];
    }catch(e){}
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date());
    const todays=items.filter(x=>String(x.ts||'').startsWith(today));
    const show=(todays.length?todays:items).slice(0,8);
    if(!show.length){const p=document.createElement('div');p.textContent='今天还没有记录';box.append(p);return;}
    for(const it of show){
      const row=document.createElement('div');row.className='wb-approval';
      const t=document.createElement('strong');t.textContent=(hhmm(it.ts)+'  '+(it.title||''));
      const s=document.createElement('span');s.textContent=it.summary||'';
      row.append(t,s);
      box.append(row);
    }
  }
  const hook=id=>{const el=document.getElementById(id);if(el)el.addEventListener('click',()=>{const b=host();if(b)b.dataset.loaded='0';setTimeout(renderDigest,350);});};
  hook('openWorkbench');hook('workbenchRefresh');hook('homeWorkbench');
})();
