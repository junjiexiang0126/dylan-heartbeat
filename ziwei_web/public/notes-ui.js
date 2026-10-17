'use strict';
/* 主页两个按钮：我的备忘录 / 我的日程提醒。
   数据全部来自 /api/memos 与 /api/schedule（转发到原生），页面只负责显示。
   她的字原样显示，不做任何改写。 */
(function () {
  const style = document.createElement('style');
  style.textContent = `
  .note-actions{display:flex;gap:10px;margin:12px 2px 0}
  .note-actions button{flex:1;border:1px solid rgba(80,63,72,.12);background:#fffcf6;border-radius:16px;
    padding:12px 10px;font:inherit;font-size:13px;color:#503f48;display:flex;align-items:center;justify-content:center;gap:6px}
  .note-actions button:active{transform:scale(.98)}
  .note-actions .ico{width:22px;height:22px;border-radius:8px;background:#f9e5ed;color:#c97d9d;
    display:flex;align-items:center;justify-content:center;font-size:12px}
  #noteSheet{position:fixed;inset:0;z-index:60;background:#fff9f7;display:none;flex-direction:column}
  #noteSheet[data-open=true]{display:flex}
  #noteSheet header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(80,63,72,.1)}
  #noteSheet header h2{font-size:17px;margin:0;flex:1}
  #noteSheet header button{border:0;background:transparent;font:inherit;font-size:15px;color:#c97d9d}
  #noteSheet .body{flex:1;overflow:auto;padding:12px 16px 24px}
  #noteSheet .empty{color:#7c6a73;font-size:13px;padding:24px 0;text-align:center}
  #noteSheet .day{font-size:12.5px;color:#7c6a73;margin:16px 0 6px}
  #noteSheet .item{background:#fffcf6;border:1px solid rgba(80,63,72,.1);border-radius:14px;padding:12px;margin-bottom:8px}
  #noteSheet .item .row{display:flex;gap:8px;align-items:flex-start}
  #noteSheet .item .txt{flex:1;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
  #noteSheet .item .meta{font-size:11.5px;color:#a8949e;margin-top:4px}
  #noteSheet .item .ops{display:flex;gap:10px;margin-top:8px}
  #noteSheet .item .ops button{border:0;background:transparent;font:inherit;font-size:12px;color:#c97d9d;padding:0}
  #noteSheet .compose{position:sticky;bottom:0;display:flex;gap:8px;padding:10px 0;background:#fff9f7}
  #noteSheet .compose textarea{flex:1;min-height:38px;max-height:120px;border:1px solid rgba(80,63,72,.16);
    border-radius:12px;padding:9px 10px;font:inherit;font-size:13.5px;resize:vertical;background:#fff}
  #noteSheet .compose button{border:0;border-radius:12px;background:#c97d9d;color:#fff;font:inherit;font-size:13px;padding:0 16px}
  #noteSheet .err{color:#b4453f;font-size:12px;padding:6px 0}
  `;
  document.head.append(style);

  const sheet = document.createElement('div');
  sheet.id = 'noteSheet';
  sheet.innerHTML = `<header><button id="noteBack">‹ 返回</button><h2 id="noteTitle"></h2></header>
    <div class="body" id="noteBody"></div>`;
  document.body.append(sheet);

  const title = sheet.querySelector('#noteTitle');
  const body = sheet.querySelector('#noteBody');
  sheet.querySelector('#noteBack').onclick = () => { sheet.dataset.open = 'false'; };

  const api = async (path, options) => {
    const res = await fetch(path, { headers: { Accept: 'application/json', ...(options?.headers || {}) }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('http_' + res.status));
    return data;
  };

  const err = (text) => { const p = document.createElement('p'); p.className = 'err'; p.textContent = text; body.append(p); };

  async function openMemos() {
    title.textContent = '我的备忘录';
    body.replaceChildren();
    let data;
    try { data = await api('/api/memos'); } catch (e) { return err('读不到备忘录（' + e.message + '）'); }
    const items = data.items || [];
    if (!items.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '还什么都没写。'; body.append(p); }
    for (const item of items) {
      const card = document.createElement('div'); card.className = 'item';
      const txt = document.createElement('div'); txt.className = 'txt'; txt.textContent = item.text;
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = (item.updatedAt || item.at || '').replace('T', ' ').slice(0, 16);
      const ops = document.createElement('div'); ops.className = 'ops';
      const edit = document.createElement('button'); edit.textContent = '改';
      const del = document.createElement('button'); del.textContent = '删';
      edit.onclick = async () => {
        const next = prompt('改成：', item.text);
        if (next === null || next.trim() === item.text) return;
        try { await api('/api/memos/' + item.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: next }) }); openMemos(); }
        catch (e) { alert('没改成功：' + e.message); }
      };
      del.onclick = async () => {
        if (!confirm('删掉这一条？')) return;
        try { await api('/api/memos/' + item.id, { method: 'DELETE' }); openMemos(); }
        catch (e) { alert('没删成功：' + e.message); }
      };
      ops.append(edit, del);
      card.append(txt, meta, ops);
      body.append(card);
    }
    const compose = document.createElement('div'); compose.className = 'compose';
    const input = document.createElement('textarea'); input.placeholder = '写一条…';
    const save = document.createElement('button'); save.textContent = '存';
    save.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      try { await api('/api/memos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); openMemos(); }
      catch (e) { alert('没存上：' + e.message); }
    };
    compose.append(input, save);
    body.append(compose);
  }

  async function openSchedule() {
    title.textContent = '我的日程提醒';
    body.replaceChildren();
    let data;
    try { data = await api('/api/schedule?days=7'); } catch (e) { return err('读不到日程（' + e.message + '）'); }
    const days = data.days || [];
    if (!days.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '未来七天没有安排。'; body.append(p); return; }
    for (const day of days) {
      const head = document.createElement('div'); head.className = 'day'; head.textContent = day.date;
      body.append(head);
      for (const item of day.items) {
        const card = document.createElement('div'); card.className = 'item';
        const row = document.createElement('div'); row.className = 'row';
        const time = document.createElement('strong'); time.textContent = item.time || '--:--';
        time.style.fontSize = '13px'; time.style.color = '#c97d9d'; time.style.minWidth = '44px';
        const txt = document.createElement('div'); txt.className = 'txt'; txt.textContent = item.text;
        if (item.done) txt.style.color = '#a8949e';
        row.append(time, txt);
        const meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = item.source === 'cron' ? '我设的提醒' : '你加的';
        card.append(row, meta);
        if (item.source === 'manual') {
          const ops = document.createElement('div'); ops.className = 'ops';
          const done = document.createElement('button'); done.textContent = item.done ? '标成未完成' : '标成完成';
          const del = document.createElement('button'); del.textContent = '删';
          done.onclick = async () => {
            try { await api('/api/schedule/' + item.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !item.done }) }); openSchedule(); }
            catch (e) { alert('没改成：' + e.message); }
          };
          del.onclick = async () => {
            if (!confirm('删掉这条？')) return;
            try { await api('/api/schedule/' + item.id, { method: 'DELETE' }); openSchedule(); }
            catch (e) { alert('没删掉：' + e.message); }
          };
          ops.append(done, del); card.append(ops);
        }
        body.append(card);
      }
    }
  }

  function mount() {
    if (document.querySelector('.note-actions')) return;
    const anchor = document.querySelector('.raven-house') || document.querySelector('#home .today') || document.querySelector('main') || document.body;
    const host = anchor.parentElement || anchor;
    const row = document.createElement('div');
    row.className = 'note-actions';
    const memo = document.createElement('button');
    memo.innerHTML = '<span class="ico">▤</span>我的备忘录';
    const sched = document.createElement('button');
    sched.innerHTML = '<span class="ico">⏰</span>我的日程提醒';
    memo.onclick = () => { sheet.dataset.open = 'true'; openMemos(); };
    sched.onclick = () => { sheet.dataset.open = 'true'; openSchedule(); };
    row.append(memo, sched);
    host.append(row);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  // 首页是切页渲染的，切回来时补一次
  setInterval(mount, 1500);
})();
