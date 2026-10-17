/* 今日印记 · 渲染
   数据只来自 /api/records/impressions（原生事件日志），前端不造事件。
   没有记录就显示「今天还没有印记」。 */
(() => {
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const WEEK = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const KIND = {
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

  let loaded = false, busy = false, apiFn = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');

  function parts(ts) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(ts || '');
    if (!m) return null;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
    return { date: `${m[1]}-${m[2]}-${m[3]}`, y: m[1], mo: Number(m[2]), d: Number(m[3]), hh: m[4], mm: m[5],
             dow: isNaN(d) ? '' : WEEK[d.getDay()] };
  }

  function todayLabel(date) {
    const now = new Date();
    const t = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return date === t ? '今天' : '';
  }

  function itemHTML(r) {
    const p = parts(r.ts); if (!p) return '';
    const meta = KIND[r.kind] || { cat: 'NOTE', sticker: '记录' };
    const detail = r.detail ? ` data-detail="${esc(r.detail)}"` : '';
    return `<div class="imp-item"><span class="imp-time">${p.hh}:${p.mm}</span>
      <div class="imp-card" role="${r.detail ? 'button' : 'group'}" tabindex="${r.detail ? '0' : '-1'}"
           data-detail="${esc(r.detail || '')}" data-title="${esc(r.title || '')}"
           data-summary="${esc(r.summary || '')}" data-ts="${esc(r.ts || '')}" data-kind="${esc(r.kind || '')}">
        <span class="imp-cat">${esc(meta.cat)}</span>
        <strong>${esc(r.title)}</strong>
        ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
        ${r.detail ? '<span class="imp-open">看看详情 ↗</span>' : ''}
        <span class="imp-sticker" data-kind="${esc(r.kind)}" data-label="${esc(meta.sticker)}"></span>
      </div></div>`;
  }

  function openDetail(card) {
    const detail = card.dataset.detail || '';
    const title = card.dataset.title || '印记';
    const summary = card.dataset.summary || '';
    const ts = (card.dataset.ts || '').replace('T', ' ').slice(0, 16);
    const box = document.getElementById('impressionsDetail');
    if (!box) return;
    const isDiary = /^diary\//.test(detail);
    const isFile = /^outbox\//.test(detail);
    box.innerHTML = `
      <span class="imp-cat">${esc(KIND[card.dataset.kind]?.cat || 'NOTE')}</span>
      <h2>${esc(title)}</h2>
      <p class="imp-detail-time">${esc(ts)}</p>
      ${summary ? `<p class="imp-detail-body">${esc(summary)}</p>` : ''}
      <p class="imp-detail-path">${esc(detail)}</p>
      ${isDiary ? '<button type="button" class="imp-detail-link" data-goto="diary">去日记里打开这篇 ↗</button>' : ''}
      ${isFile ? '<p class="imp-detail-hint">这份文件在知微的工作区里，需要的话让他发给你。</p>' : ''}
      <button type="button" class="imp-detail-close">收起</button>`;
    box.hidden = false;
    const back = box.querySelector('.imp-detail-close');
    if (back) back.onclick = () => { box.hidden = true; box.innerHTML = ''; };
    const goto = box.querySelector('[data-goto="diary"]');
    if (goto) goto.onclick = () => {
      box.hidden = true; box.innerHTML = '';
      const b = document.querySelector('[data-log-kind="diary"]');
      if (b) b.click();
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
    if (err) { err.hidden = true; err.textContent = ''; }
    if (!list.length) { rail.innerHTML = ''; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;

    // 按日期分组：日内按时间正序，日期之间新的在前
    const groups = new Map();
    for (const r of list) {
      const p = parts(r.ts);
      if (!groups.has(p.date)) groups.set(p.date, []);
      groups.get(p.date).push(r);
    }
    const dates = [...groups.keys()].sort().reverse();

    let html = '', lastMonth = '';
    for (const date of dates) {
      const p = parts(groups.get(date)[0].ts);
      const rowsOfDay = groups.get(date).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      if (p.mo !== lastMonth) {
        html += `<section class="imp-group"><div class="imp-year">${p.y}</div><div class="imp-month">${MONTHS[p.mo - 1]}</div>`;
        lastMonth = p.mo;
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

  async function load() {
    if (busy) return;
    busy = true;
    const err = document.getElementById('impressionsError');
    try {
      const fn = apiFn || (p => fetch(p, { cache: 'no-store' }).then(r => r.json()));
      const value = await fn('/api/records/impressions?limit=50');
      render(value && value.data);
      if (value && value.errors && value.errors.length && err) {
        err.hidden = false; err.textContent = '有一点没读到：' + value.errors.join('；');
      }
    } catch (e) {
      if (err) { err.hidden = false; err.textContent = '印记没读到，等会儿再试。'; }
      render([]);
    } finally { busy = false; }
  }

  window.ZiweiImpressions = {
    show(on, api) {
      if (api) apiFn = api;
      const page = document.getElementById('impressionsPage');
      // style.css 里 [hidden]{display:none!important}，光靠 class 显示不出来，必须摘掉 hidden
      if (page) page.hidden = !on;
      if (!on) return;
      if (!loaded) { loaded = true; load(); }
    },
    reload() { loaded = true; load(); },
    _render: render,
  };
})();
