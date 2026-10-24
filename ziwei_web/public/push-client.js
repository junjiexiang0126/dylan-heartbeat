/* 知微之家 · 通知开关（Web Push）
 * 只在手机把知微之家装到桌面（standalone）时提示；未授权前显示一枚小药丸。
 * 订阅走同域的 /push/* 服务（VAPID 已就绪），通知点开回到首页。
 */
(function () {
  'use strict';

  var isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

  // 注册根 service worker：不带它，iOS 不会把推送交给页面
  var regPromise = navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { return null; });

  function urlB64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  function showPill(text, onClick) {
    var old = document.getElementById('zw-push-pill');
    if (old) old.remove();
    var el = document.createElement('button');
    el.id = 'zw-push-pill';
    el.type = 'button';
    el.textContent = text;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'bottom:calc(env(safe-area-inset-bottom, 0px) + 84px)',
      'z-index:9999', 'border:0', 'border-radius:999px',
      'padding:9px 16px', 'font-size:14px', 'line-height:1.2',
      'background:rgba(60,50,48,.92)', 'color:#fff',
      'box-shadow:0 6px 18px rgba(0,0,0,.22)', 'font-family:inherit'
    ].join(';');
    if (onClick) el.addEventListener('click', onClick);
    document.body.appendChild(el);
    return el;
  }

  function subscribe() {
    return regPromise.then(function (reg) {
      if (!reg) throw new Error('no-sw');
      return reg.pushManager.getSubscription().then(function (existing) {
        if (existing) return existing;
        return Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') throw new Error('denied');
          return fetch('/push/vapid-public', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
              return reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8Array(j.key)
              });
            });
        });
      });
    }).then(function (sub) {
      return fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(sub)
      }).then(function () { return sub; });
    });
  }

  function boot() {
    if (!document.body) return;
    if (Notification.permission === 'granted') {
      // 已授权：确保后台订阅还在（换设备、清缓存后常见失效）
      subscribe().catch(function () {});
      return;
    }
    if (!isStandalone) return; // Safari 标签页拿不到权限，别烦她
    showPill('开启知微的通知', function () {
      var el = showPill('正在开启…', null);
      subscribe().then(function () {
        el.textContent = '已开启，我会来找你';
        setTimeout(function () { el.remove(); }, 2200);
      }).catch(function (err) {
        el.textContent = String(err && err.message) === 'denied' ? '通知被系统关了，去设置里打开' : '开启失败，点我再试一次';
        el.addEventListener('click', function () { location.reload(); });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
