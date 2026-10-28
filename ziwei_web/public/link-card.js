/* 链接卡片：把消息里的 URL 变成一张可点的卡。
 *
 * 分工（这是关键）：
 *   抓到标题和图 → 画完整卡片；抓不到（Lazada 这类会拦服务器 IP）→ 画一张只带域名的卡，
 *   仍然可点。任何失败都不报错、不显示红字，也不改变原消息的文字。
 *
 * 数据来源只有服务端 /api/link-preview（浏览器直接抓会被 CORS 挡，而且拿不到 og 标签）。
 */
(function () {
  'use strict';

  const URL_RE = /https?:\/\/[^\s<>"'`）)】\]]+/g;
  const MAX_CARDS = 3;
  const CACHE_KEY = 'zw_link_preview_v1';

  function readCache() {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function writeCache(obj) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch {
      /* 满了就算了，不是功能错误 */
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function fetchPreview(url) {
    const cache = readCache();
    if (Object.prototype.hasOwnProperty.call(cache, url)) return Promise.resolve(cache[url]);

    return fetch('/api/link-preview?url=' + encodeURIComponent(url), {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        const clean = data && data.title ? data : null;
        // 抓失败不写客户端缓存：否则一次失败会在这一整个会话里都显示裸卡。
        if (clean) {
          const next = readCache();
          next[url] = clean;
          writeCache(next);
        }
        return clean;
      });
  }

  function buildCard(url, preview) {
    const a = document.createElement('a');
    a.className = 'link-card';
    if (!preview) a.classList.add('link-card--bare');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.dataset.url = url;

    if (preview && preview.image) {
      const media = document.createElement('div');
      media.className = 'link-card-media';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = preview.image;
      img.addEventListener('error', () => media.remove(), { once: true });
      media.append(img);
      a.append(media);
    }

    const body = document.createElement('div');
    body.className = 'link-card-body';

    const title = document.createElement('div');
    title.className = 'link-card-title';
    title.textContent = (preview && preview.title) || url;
    body.append(title);

    if (preview && preview.description) {
      const desc = document.createElement('div');
      desc.className = 'link-card-desc';
      desc.textContent = preview.description;
      body.append(desc);
    }

    const host = document.createElement('div');
    host.className = 'link-card-host';
    const name = (preview && preview.siteName) || hostOf(url);
    host.textContent = name || hostOf(url);
    if (preview && preview.price) {
      const price = document.createElement('strong');
      price.className = 'link-card-price';
      price.textContent = ' ' + preview.price;
      host.append(price);
    }
    body.append(host);

    a.append(body);
    return a;
  }

  // 把一段纯文本 span 里的 URL 抽出来：文字留下并转成 <a>，卡片挂在后面
  function decorateSpan(span) {
    const text = span.textContent || '';
    const urls = text.match(URL_RE);
    if (!urls || !urls.length) return [];

    const unique = [];
    for (const raw of urls) {
      const url = raw.replace(/[.,;:!?]+$/, '');
      if (!unique.includes(url)) unique.push(url);
      if (unique.length >= MAX_CARDS) break;
    }

    const frag = document.createDocumentFragment();
    let rest = text;
    for (const url of unique) {
      const idx = rest.indexOf(url);
      if (idx < 0) continue;
      if (idx > 0) frag.append(document.createTextNode(rest.slice(0, idx)));
      const link = document.createElement('a');
      link.className = 'message-inline-link';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = url;
      frag.append(link);
      rest = rest.slice(idx + url.length);
    }
    if (rest) frag.append(document.createTextNode(rest));
    span.replaceChildren(frag);
    return unique;
  }

  function decorate(root) {
    if (!root || root.dataset.linkCards === 'done') return;
    root.dataset.linkCards = 'done';

    const spans = Array.from(root.querySelectorAll('span')).filter(
      (s) => s.childElementCount === 0 && /https?:\/\//.test(s.textContent || '')
    );
    if (!spans.length) return;

    const found = [];
    for (const span of spans) {
      for (const url of decorateSpan(span)) {
        if (!found.includes(url) && found.length < MAX_CARDS) found.push(url);
      }
    }

    const holder = document.createElement('div');
    holder.className = 'link-cards';
    const cards = found.map((url) => {
      const card = buildCard(url, null); // 先出裸卡，抓到了再补内容
      holder.append(card);
      return { url, card };
    });
    if (cards.length) root.append(holder);

    for (const { url, card } of cards) {
      fetchPreview(url).then((preview) => {
        if (!preview) return;
        const fresh = buildCard(url, preview);
        card.replaceWith(fresh);
      });
    }
  }

  window.ZiweiLinkCard = { decorate, buildCard };
})();
