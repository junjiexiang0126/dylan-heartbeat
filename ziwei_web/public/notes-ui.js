'use strict';
/* 首页两个入口（备忘录 / 日程）+ 它们的二级页。
   样式全部在 /home.css（外链），因为站点 CSP 是 style-src 'self'，内联 <style> 会被拦掉。
   数据来自 /api/memos 与 /api/schedule；她的字原样显示，不改写。 */
(function () {
  /* ---------- 内部代号翻成人话 ---------- */
  const HUMAN = [
    [/our-time|our_time/i, '只属于我们俩的时间'],
    [/kaoyan|考研/i, '考研提醒'],
    [/review[-_]?2130|review/i, '晚上十点半 · 复习十分钟'],
    [/six-opportunities|daily-six/i, '我每天六次自主行动'],
    [/wake/i, '叫醒'],
    [/class|lesson|课前/i, '课前提醒'],
    [/sleep|bed/i, '睡前'],
  ];
  const looksLikeCode = (t) => /^[a-z0-9][a-z0-9_.:-]{7,}$/i.test(t) && /[-_0-9]/.test(t);
  function humanize(text, source) {
    const raw = String(text || '').trim();
    for (const [re, label] of HUMAN) if (re.test(raw)) return label;
    if (source === 'cron' && looksLikeCode(raw)) return '我设的提醒';
    return raw;
  }

  /* ---------- 二级页骨架 ---------- */
  const sheet = document.createElement('section');
  sheet.id = 'noteSheet';
  sheet.setAttribute('aria-hidden', 'true');
  sheet.innerHTML = '<header><button class="back" id="noteBack" type="button" aria-label="返回首页">‹ 返回</button><h2 id="noteTitle"></h2></header><div class="body" id="noteBody"></div>';
  document.body.append(sheet);
  const title = sheet.querySelector('#noteTitle');
  const body = sheet.querySelector('#noteBody');
  const back = sheet.querySelector('#noteBack');

  let lastFocus = null;
  function open(kind) {
    lastFocus = document.activeElement;
    body.replaceChildren();
    sheet.dataset.open = 'true';
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('notes-open');
    kind === 'memos' ? openMemos() : openSchedule();
  }
  function close() {
    sheet.dataset.open = 'false';
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('notes-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  back.onclick = close;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.dataset.open === 'true') close(); });

  /* ---------- 取数 ---------- */
  const api = async (path, options) => {
    const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json', ...(options && options.headers || {}) }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('http_' + res.status));
    return data;
  };
  const fail = (text) => {
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = text;
    body.append(p);
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  /* ---------- 备忘录 ---------- */
  async function openMemos() {
    title.textContent = '我的备忘录';
    body.replaceChildren();
    let data;
    try { data = await api('/api/memos'); } catch (e) { return fail('读不到备忘录（' + e.message + '）'); }
    const items = data.items || [];
    if (!items.length) body.append(el('p', 'empty', '还什么都没写。'));
    for (const item of items) {
      const card = el('div', 'item');
      const txt = el('div', 'txt', item.text);
      const meta = el('div', 'meta', String(item.updatedAt || item.at || '').replace('T', ' ').slice(0, 16));
      const ops = el('div', 'ops');
      const edit = el('button', '', '改');
      const del = el('button', 'danger', '删');
      ops.append(edit, del);
      card.append(txt, meta, ops);
      body.append(card);

      edit.onclick = () => {
        const box = el('textarea');
        box.value = item.text;
        const row = el('div', 'ops');
        const save = el('button', '', '保存');
        const cancel = el('button', '', '取消');
        row.append(save, cancel);
        card.replaceChildren(box, row);
        box.focus();
        cancel.onclick = () => card.replaceChildren(txt, meta, ops);
        save.onclick = async () => {
          const next = box.value.trim();
          if (!next || next === item.text) return cancel.onclick();
          try { await api('/api/memos/' + encodeURIComponent(item.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: next }) }); openMemos(); }
          catch (e) { fail('没改成功：' + e.message); }
        };
      };
      del.onclick = async () => {
        if (del.dataset.armed !== '1') {
          del.dataset.armed = '1';
          del.textContent = '再点一次删掉';
          setTimeout(() => { del.dataset.armed = '0'; del.textContent = '删'; }, 2600);
          return;
        }
        try { await api('/api/memos/' + encodeURIComponent(item.id), { method: 'DELETE' }); openMemos(); }
        catch (e) { fail('没删成功：' + e.message); }
      };
    }
    const compose = el('div', 'compose');
    const input = el('textarea');
    input.placeholder = '写一条…';
    const save = el('button', '', '存');
    save.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      try { await api('/api/memos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); openMemos(); }
      catch (e) { fail('没存上：' + e.message); }
    };
    compose.append(input, save);
    body.append(compose);
  }

  /* ---------- 日程 ---------- */
  async function openSchedule() {
    title.textContent = '我的日程';
    body.replaceChildren();
    let data;
    try { data = await api('/api/schedule?days=7'); } catch (e) { return fail('读不到日程（' + e.message + '）'); }
    const days = data.days || [];
    const shown = days.filter((d) => (d.items || []).length);
    if (!shown.length) { body.append(el('p', 'empty', '未来七天没有安排。')); return; }
    for (const day of shown) {
      body.append(el('div', 'day', day.date));
      for (const item of day.items) {
        const card = el('div', 'item');
        const row = el('div', 'row');
        const time = el('strong', '', item.time || '--:--');
        time.style.fontSize = '13px';
        time.style.color = '#c97d9d';
        time.style.minWidth = '44px';
        const txt = el('div', 'txt', humanize(item.text, item.source));
        if (item.done) txt.style.color = '#a8949e';
        row.append(time, txt);
        const meta = el('div', 'meta', item.source === 'cron' ? '我设的' : '你加的');
        card.append(row, meta);
        if (item.source === 'manual') {
          const ops = el('div', 'ops');
          const done = el('button', '', item.done ? '标成未完成' : '标成完成');
          const del = el('button', 'danger', '删');
          done.onclick = async () => {
            try { await api('/api/schedule/' + encodeURIComponent(item.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !item.done }) }); openSchedule(); }
            catch (e) { fail('没改成：' + e.message); }
          };
          del.onclick = async () => {
            if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = '再点一次删掉'; setTimeout(() => { del.dataset.armed = '0'; del.textContent = '删'; }, 2600); return; }
            try { await api('/api/schedule/' + encodeURIComponent(item.id), { method: 'DELETE' }); openSchedule(); }
            catch (e) { fail('没删掉：' + e.message); }
          };
          ops.append(done, del);
          card.append(ops);
        }
        body.append(card);
      }
    }
  }

  /* ---------- 首页入口（图标，不写字） ---------- */
  const ICON_MEMO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 17.4c1.5-3 4.1-4.6 7.3-4.6 3.1 0 5.6 1.6 6.9 4.6-1.3 2.6-3.8 4-6.9 4-3.2 0-5.8-1.4-7.3-4Z"/><path d="M4.2 17.4c-1-.4-1.8-.6-2.5-.6.1.8.5 1.5 1.2 2.1"/><circle cx="13.9" cy="16.4" r=".62" fill="currentColor" stroke="none"/><path d="M8.6 9.8c1.9-1.4 4-1.9 6.3-1.4"/></svg>';
  const ICON_SCHED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 17.4c1.5-3 4.1-4.6 7.3-4.6 3.1 0 5.6 1.6 6.9 4.6-1.3 2.6-3.8 4-6.9 4-3.2 0-5.8-1.4-7.3-4Z"/><path d="M4.2 17.4c-1-.4-1.8-.6-2.5-.6.1.8.5 1.5 1.2 2.1"/><circle cx="13.9" cy="16.4" r=".62" fill="currentColor" stroke="none"/><path d="M5.8 9.6c2.6-1.6 5.4-2 8.4-1.2"/><path d="M7.4 6.4c1.9-1 3.9-1.1 6-.4"/></svg>';

  /* ---------- 底部导航：文字隐藏后补上无障碍名字 ---------- */
  const NAV_NAMES = { chat: '聊天', moments: '朋友圈', home: '首页', memory: '记忆', logs: '日志', work: 'Work' };
  function labelNav() {
    document.querySelectorAll('nav.glass [data-tab]').forEach((b) => {
      if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', NAV_NAMES[b.dataset.tab] || b.dataset.tab);
    });
  }

  /* ---------- 知微肩头那颗符号：点它直接去聊天 ---------- */
  function wireSticker() {
    const btn = document.getElementById('shoulderSticker');
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.onclick = () => {
      const chat = document.querySelector('nav.glass [data-tab="chat"]') || document.querySelector('[data-tab="chat"]');
      if (chat) chat.click();
    };
  }

  function mount() {
    labelNav();
    wireSticker();
    const home = document.getElementById('home');
    if (!home) return;
    const existing = document.querySelector('.note-actions');
    if (existing) { existing.style.display = home.hidden ? 'none' : ''; return; }
    const persons = home.querySelectorAll('.pair .person');
    const anchor = persons.length ? persons[persons.length - 1] : (home.querySelector('.memorial') || home.lastElementChild);
    if (!anchor) return;
    const row = el('div', 'note-actions');
    const memo = el('button');
    memo.type = 'button';
    memo.setAttribute('aria-label', '我的备忘录');
    memo.title = '备忘录';
    memo.innerHTML = ICON_MEMO;
    const sched = el('button');
    sched.type = 'button';
    sched.setAttribute('aria-label', '我的日程');
    sched.title = '日程';
    sched.innerHTML = ICON_SCHED;
    memo.onclick = () => open('memos');
    sched.onclick = () => open('schedule');
    row.append(memo, sched);
    anchor.append(row);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  setInterval(mount, 2000);
})();
