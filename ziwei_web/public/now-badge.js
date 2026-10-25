/* 此刻 · 粉色小卡片
 * 右下角一张可以拖的粉色小卡，点一下展开心潮的「天气」，再点收起。
 * 只读展示；数据来自 GET /api/now。
 */
(function () {
  'use strict';
  var pill, card, dragging = false, moved = false, startX = 0, startY = 0, originX = 0, originY = 0;
  var last = null;
  var POS_KEY = 'ziwei.now.pos';

  var PINK = 'linear-gradient(135deg,#ffd9e6 0%,#ffc0d4 55%,#ffb0c9 100%)';

  function el(tag, css, html) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function restorePos() {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && isFinite(p.right) && isFinite(p.bottom)) return p;
    } catch (e) {}
    return null;
  }

  function savePos() {
    if (!pill) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        right: parseFloat(pill.style.right) || 12,
        bottom: parseFloat(pill.style.bottom) || 96
      }));
    } catch (e) {}
  }

  function ensurePill() {
    if (pill) return;
    var pos = restorePos() || { right: 12, bottom: 96 };
    pill = el('button',
      'position:fixed;z-index:9000;border:0;padding:8px 12px;border-radius:16px;' +
      'background:' + PINK + ';color:#7a3d52;font-family:inherit;font-size:12px;line-height:1;' +
      'display:flex;align-items:center;gap:5px;' +
      'box-shadow:0 6px 16px rgba(255,140,175,.35),inset 0 1px 0 rgba(255,255,255,.7);' +
      'touch-action:none;user-select:none;-webkit-user-select:none;' +
      'animation:zwNowFloat 3.6s ease-in-out infinite',
      '<span style="font-size:13px">♡</span><span>此刻</span>');
    pill.type = 'button';
    pill.setAttribute('aria-label', '看此刻');
    pill.style.right = pos.right + 'px';
    pill.style.bottom = pos.bottom + 'px';

    var style = document.createElement('style');
    style.textContent = '@keyframes zwNowFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}' +
      '@keyframes zwNowIn{from{opacity:0;transform:translateY(6px) scale(.96)}to{opacity:1;transform:none}}';
    document.head.appendChild(style);

    pill.addEventListener('pointerdown', onDown);
    document.body.appendChild(pill);
  }

  function onDown(e) {
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    originX = parseFloat(pill.style.right) || 12;
    originY = parseFloat(pill.style.bottom) || 96;
    pill.setPointerCapture(e.pointerId);
    pill.style.animation = 'none';
    e.preventDefault();
  }

  document.addEventListener('pointermove', function (e) {
    if (!dragging || !pill) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    var right = Math.min(Math.max(originX - dx, 6), window.innerWidth - 90);
    var bottom = Math.min(Math.max(originY - dy, 60), window.innerHeight - 90);
    pill.style.right = right + 'px';
    pill.style.bottom = bottom + 'px';
  }, { passive: true });

  document.addEventListener('pointerup', function () {
    if (!dragging) return;
    dragging = false;
    if (pill) { pill.style.animation = 'zwNowFloat 3.6s ease-in-out infinite'; }
    if (moved) { savePos(); closeCard(); return; }
    toggle();
  });

  function closeCard() {
    if (card) { card.remove(); card = null; }
  }

  function renderCard(d) {
    closeCard();
    var right = parseFloat(pill.style.right) || 12;
    var bottom = (parseFloat(pill.style.bottom) || 96) + 46;
    card = el('div',
      'position:fixed;z-index:9001;max-width:min(300px,76vw);' +
      'background:' + PINK + ';color:#5f2f40;border-radius:18px;padding:12px 14px;' +
      'font-family:inherit;font-size:13px;line-height:1.65;' +
      'box-shadow:0 10px 26px rgba(255,130,170,.32),inset 0 1px 0 rgba(255,255,255,.6);' +
      'white-space:pre-wrap;animation:zwNowIn .22s ease-out both;' +
      'right:' + right + 'px;bottom:' + bottom + 'px');
    var text = (d && d.text) ? d.text.replace(/^【[^】]*】\n?/, '') : '心潮现在没有读数。';
    card.appendChild(el('div', 'font-weight:600;margin-bottom:6px', '♡ 此刻'));
    card.appendChild(el('div', '', text.replace(/\n/g, '<br>')));
    if (d && d.generatedAt) {
      card.appendChild(el('div', 'margin-top:8px;font-size:11px;opacity:.6',
        '更新于 ' + new Date(d.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
    }
    document.body.appendChild(card);
  }

  function toggle() {
    if (card) { closeCard(); return; }
    renderCard(last);
    fetch('/api/now', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { last = d; if (card) renderCard(d); } })
      .catch(function () {});
  }

  function boot() {
    if (!document.body) return;
    ensurePill();
    var tick = function () {
      fetch('/api/now', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) last = d; })
        .catch(function () {});
    };
    tick();
    setInterval(tick, 120000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
