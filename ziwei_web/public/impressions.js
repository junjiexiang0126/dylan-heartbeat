/* 今日印记 · 渲染
   数据只来自 /api/records/impressions（原生事件日志），前端不造事件。
   没有记录就显示「今天还没有印记」。 */
(() => {
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const WEEK = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const KIND = {
    status: {cat:'状态',sticker:'此刻'},
    wake: { cat: '自主活动', sticker: '醒来' },
    memory: { cat: '记忆', sticker: '整理' },
    browse: { cat: '浏览', sticker: '看看' },
    activity: { cat: '活动', sticker: '足迹' },
    diary:   { cat: 'DIARY',     sticker: '写日记' },
    memo:    { cat: 'PRIVATE',   sticker: '默记' },
    work:    { cat: 'WORK',      sticker: '工作' },
    message: { cat: 'MESSAGE',   sticker: '发消息' },
    moments: { cat: 'MOMENTS',   sticker: '朋友圈' },
    garden:  { cat: 'GARDEN',    sticker: '逛花园' },
    file:    { cat: 'FILE',      sticker: '完成' },
    task:    { cat: 'TASK',      sticker: '完成' },
    rest:    { cat: 'REST',      sticker: '休息' },
    happy:   { cat: 'MOOD',      sticker: '开心' },
  };

  let busy = false, apiFn = null, active = false, timer = null, generation = 0, revision = '';
  const state = { range: 'week', rows: [], next: null, pages: 1 };
  const STATUS = {completed:'已完成',failed:'未完成',in_progress:'进行中',recorded:'已记录',skipped:'未唤醒'};

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function parts(ts) {
    const d = new Date(ts); if (!Number.isFinite(d.getTime())) return null;
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(p=>[p.type,p.value]));
    return {date:`${values.year}-${values.month}-${values.day}`,y:values.year,mo:Number(values.month),d:Number(values.day),hh:values.hour,mm:values.minute,dow:WEEK[new Date(`${values.year}-${values.month}-${values.day}T12:00:00+07:00`).getUTCDay()]};
  }
  function todayLabel(date) { return date === parts(new Date().toISOString()).date ? '今天' : ''; }

  function itemHTML(r) {
    const p = parts(r.ts); if (!p) return '';
    const meta = KIND[r.kind] || { cat: 'NOTE', sticker: '记录' };
    const detail = r.detail || (r.target?.kind === 'diary' ? 'diary/' + r.target.id : '');
    return `<div class="imp-item"><span class="imp-time">${p.hh}:${p.mm}</span>
      <div class="imp-card" role="${detail ? 'button' : 'group'}" tabindex="${detail ? '0' : '-1'}"
           data-detail="${esc(detail)}" data-title="${esc(r.title || '')}" data-target-id="${esc(r.target?.kind==='diary'?r.target.id:'')}"
           data-summary="${esc(r.summary || '')}" data-ts="${esc(r.ts || '')}" data-kind="${esc(r.kind || '')}">
        <span class="imp-cat">${esc(meta.cat)}</span>
        <strong>${esc(r.title)}</strong><span class="imp-state" data-state="${esc(r.state||'recorded')}">${esc(STATUS[r.state]||'已记录')}${Number.isSafeInteger(r.opportunity)?' · 第 '+r.opportunity+' 次自主机会':''}${r.automatic?' · 自动同步':''}</span>
        ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
        ${detail ? '<span class="imp-open">看看详情 ↗</span>' : ''}
        <span class="imp-sticker" data-kind="${esc(r.kind)}" data-label="${esc(meta.sticker)}"></span>
      </div></div>`;
  }

  function openDetail(card) {
    const detail = card.dataset.detail || '';
    const title = card.dataset.title || '印记';
    const summary = card.dataset.summary || '';
    const stamp=parts(card.dataset.ts);const ts=stamp?stamp.date+' '+stamp.hh+':'+stamp.mm:'';
    const box = document.getElementById('impressionsDetail');
    if (!box) return;
    const isDiary = /^diary\//.test(detail);
    const isFile = /^outbox\//.test(detail);
    box.innerHTML = `
      <span class="imp-cat">${esc(KIND[card.dataset.kind]?.cat || 'NOTE')}</span>
      <h2>${esc(title)}</h2>
      <p class="imp-detail-time">${esc(ts)}</p>
      ${summary ? `<p class="imp-detail-body">${esc(summary)}</p>` : ''}
      <details><summary>记录来源</summary><p class="imp-detail-path">${esc(detail)}</p></details>
      ${isDiary ? '<button type="button" class="imp-detail-link" data-goto="diary">去日记里打开这篇 ↗</button>' : ''}
      ${isFile ? '<p class="imp-detail-hint">这份文件在知微的工作区里，需要的话让他发给你。</p>' : ''}
      <button type="button" class="imp-detail-close">收起</button>`;
    box.hidden = false;
    const back = box.querySelector('.imp-detail-close');
    if (back) back.onclick = () => { box.hidden = true; box.innerHTML = ''; };
    const goto = box.querySelector('[data-goto="diary"]');
    if (goto) goto.onclick = () => {
      box.hidden = true; box.innerHTML = '';
      if(card.dataset.targetId) window.ZiweiRecords?.openDiaryById(card.dataset.targetId);
      else document.querySelector('[data-log-kind="diary"]')?.click();
    };
  }

  function bindCards(root) {
    root.querySelectorAll('.imp-card[data-detail]').forEach(card => {
      if (!card.dataset.detail) return;
      card.addEventListener('click', () => openDetail(card));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card); }
      });
    });
  }

  function render(rows) {
    const rail = document.getElementById('impressionsRail');
    const empty = document.getElementById('impressionsEmpty');
    const err = document.getElementById('impressionsError');
    if (!rail) return;
    const list = (rows || []).filter(r => parts(r.ts));
    const shown = list;
    if (err) { err.hidden = true; err.textContent = ''; }
    if (!shown.length) { rail.innerHTML = ''; if (empty) { empty.textContent = state.range==='all'?'还没有可读取的活动记录。':'最近一周还没有活动记录。'; empty.hidden = false; } return; }
    if (empty) empty.hidden = true;

    // 按日期分组：日内按时间正序，日期之间新的在前
    const groups = new Map();
    for (const r of shown) {
      const p = parts(r.ts);
      if (!groups.has(p.date)) groups.set(p.date, []);
      groups.get(p.date).push(r);
    }
    const dates = [...groups.keys()].sort().reverse();

    let html = '', lastMonth = '';
    for (const date of dates) {
      const p = parts(groups.get(date)[0].ts);
      const rowsOfDay = groups.get(date).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      if (p.y+'-'+p.mo !== lastMonth) {
        html += `<section class="imp-group"><div class="imp-year">${p.y}</div><div class="imp-month">${MONTHS[p.mo - 1]}</div>`;
        lastMonth = p.y+'-'+p.mo;
      } else {
        html += '<section class="imp-group">';
      }
      const tl = todayLabel(p.date);
      html += `<div class="imp-day"><strong>${p.mo}.${pad(p.d)}</strong><span>${p.dow}${tl ? ' · ' + tl : ''}</span></div><div class="imp-list">`;
      html += rowsOfDay.map(itemHTML).join('');
      html += '</div></section>';
    }
    rail.innerHTML = html;
    bindCards(rail);
  }

  async function load(more = false) {
    if (!active || busy || !apiFn || more && !state.next) return;
    busy = true; const run = generation;
    const status = document.getElementById('impressionsStatus');
    const err = document.getElementById('impressionsError');
    const nextButton = document.getElementById('impressionsMore');
    status.textContent = state.rows.length ? '正在同步最新活动…' : '正在读取活动记录…';
    nextButton.disabled = true;
    try {
      let rows = more ? [...state.rows] : [], cursor = more ? state.next : null, value;
      const pages = more ? 1 : state.pages;
      const since = state.range === 'week' ? parts(new Date(Date.now()-6*86400000).toISOString()).date+'T00:00:00+07:00' : null;
      const errors = [];
      for(let i=0;i<pages;i++) {
        const q = new URLSearchParams({limit:'50'});
        if(cursor) q.set('cursor',cursor); if(since) q.set('since',since);
        value = await apiFn('/api/records/impressions?'+q);
        if(run!==generation || !active) return;
        if(!Array.isArray(value.data) || value.source!=='hermes_native') throw Error('invalid_response');
        rows.push(...value.data); errors.push(...(value.errors||[])); cursor = value.nextCursor;
        if(!cursor) break;
      }
      state.rows = [...new Map(rows.map(r=>[r.id,r])).values()]; state.next = cursor || null;
      if(more) state.pages++;
      const changed = JSON.stringify(state.rows);
      if(changed!==revision) { render(state.rows); revision=changed; }
      nextButton.hidden = !state.next;
      const wake=value.wake;
      const count=Number.isSafeInteger(wake?.count)?` · 今天已使用 ${wake.count}${Number.isSafeInteger(wake.dailyLimit)?' / '+wake.dailyLimit:''} 次自主机会`:'';
      const checked=parts(value.checkedAt);
      status.textContent=`${checked?'已同步至 '+checked.hh+':'+checked.mm:'已同步'} · ${value.total??state.rows.length} 条活动${count}`;
      err.hidden = errors.length===0;
      err.textContent = errors.length ? '部分活动来源暂时未读全，当前记录可能不完整；系统会自动重试。' : '';
      if(errors.length && !state.rows.length) document.getElementById('impressionsEmpty').hidden=true;
    } catch(e) {
      if(run!==generation || !active) return;
      status.textContent = state.rows.length ? '暂未同步成功，保留上次记录。' : '暂时无法读取活动记录。';
      err.hidden=false;err.textContent='连接恢复后会自动重试，也可以点「刷新」。';
      document.getElementById('impressionsEmpty').hidden=true;
    } finally { if(run===generation) {busy=false;nextButton.disabled=false;} }
  }
  function setRange(range) {
    generation++; busy=false; state.range=range==='all'?'all':'week';state.rows=[];state.next=null;state.pages=1;revision='';
    document.getElementById('impressionsRail')?.replaceChildren();
    document.getElementById('impressionsMore').hidden=true;
    for(const b of document.querySelectorAll('[data-imp-range]')) {const on=b.dataset.impRange===state.range;b.setAttribute('aria-pressed',String(on));b.classList.toggle('active',on);}
    void load();
  }
  function stop() {
    active=false;generation++;busy=false;apiFn=null;clearInterval(timer);timer=null;
    state.rows=[];state.next=null;state.pages=1;revision='';
    for(const id of ['impressionsRail','impressionsDetail','impressionsStatus','impressionsError']) document.getElementById(id)?.replaceChildren();
    const box=document.getElementById('impressionsDetail');if(box)box.hidden=true;
  }
  document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)void load();});
  window.addEventListener('online',()=>{if(active)void load();});
  window.ZiweiImpressions = {
    show(on, api) {
      const page=document.getElementById('impressionsPage');if(page)page.hidden=!on;
      if(!on){if(active){active=false;generation++;busy=false;clearInterval(timer);timer=null;}return;}
      if(api)apiFn=api;
      if(active)return;active=true;
      for(const b of document.querySelectorAll('[data-imp-range]'))b.onclick=()=>setRange(b.dataset.impRange);
      document.getElementById('impressionsRefresh').onclick=()=>load();
      document.getElementById('impressionsMore').onclick=()=>load(true);
      void load();timer=setInterval(()=>{if(!document.hidden)void load();},15000);
    },
    stop, reload:()=>load(), setRange, _render:render,
  };
})();
