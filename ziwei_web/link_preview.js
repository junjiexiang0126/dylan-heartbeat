'use strict';

/**
 * 链接预览：把消息里的 URL 变成一张卡片要用的元数据。
 *
 * 为什么在服务端抓而不是前端：
 *   前端 fetch 会被 CORS 挡住，也拿不到 og 标签；而且每台设备各抓一次，慢。
 *
 * 安全边界（必须有，这是服务端替用户去访问任意地址）：
 *   1. 只允许 http / https。
 *   2. 拒绝内网与保留地址（SSRF）：localhost、127/8、10/8、172.16/12、192.168/16、
 *      169.254/16、::1、fc00::/7 等。
 *   3. 跟随重定向最多 3 跳，每一跳都重新做 1、2 的检查。
 *   4. 超时 5 秒，只读前 256KB，Content-Type 不是 html 就放弃。
 *   5. 任何失败都返回 null —— 前端退回纯链接，不报错、不显示红字。
 */

const http = require('http');
const https = require('https');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 抓失败只记 5 分钟。踩过：一次失败若记一整天，用户看到的就是一整天的裸卡。
const FAIL_TTL_MS = 5 * 60 * 1000;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const MAX_CACHE = 500;

const cache = new Map(); // url -> { at, data }

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

  // IPv6
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7
    if (h.startsWith('fe80:')) return true;        // link-local
    const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]);
    return false;
  }

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // 域名，交给 DNS；这里不做 DNS rebinding 级别的防护，够用
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                        // 组播/保留
  return false;
}

function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('bad_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad_scheme');
  if (isPrivateHost(u.hostname)) throw new Error('private_host');
  return u;
}

function requestOnce(u, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'GET',
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ziwei-link-preview/1)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,th;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('too_many_redirects'));
          let next;
          try {
            next = assertPublicUrl(new URL(res.headers.location, u).toString());
          } catch (e) {
            return reject(e);
          }
          return resolve(requestOnce(next, redirectsLeft - 1));
        }

        if (status !== 200) {
          res.resume();
          return reject(new Error('http_' + status));
        }

        const ctype = String(res.headers['content-type'] || '').toLowerCase();
        if (ctype && !ctype.includes('html')) {
          res.resume();
          return reject(new Error('not_html'));
        }

        let size = 0;
        const chunks = [];
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            chunks.push(c.slice(0, Math.max(0, MAX_BYTES - (size - c.length))));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: u.toString() }));
        res.on('close', () => {
          if (size > MAX_BYTES) resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: u.toString() });
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function metaContent(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${name}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return '';
}

function pickMeta(html, baseUrl) {
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const title =
    metaContent(html, 'og:title') ||
    metaContent(html, 'twitter:title') ||
    decodeEntities(titleTag).trim();
  const description =
    metaContent(html, 'og:description') || metaContent(html, 'description') || metaContent(html, 'twitter:description');
  let image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  const siteName = metaContent(html, 'og:site_name');

  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch {
      image = '';
    }
  }

  let host = '';
  try {
    host = new URL(baseUrl).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }

  return {
    title: title.slice(0, 160),
    description: description.slice(0, 240),
    image,
    siteName: siteName.slice(0, 60),
    host,
  };
}

function cacheGet(url) {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > (hit.ttl || CACHE_TTL_MS)) {
    cache.delete(url);
    return undefined;
  }
  return hit.data;
}

function cacheSet(url, data, ttl) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(url, { at: Date.now(), data, ttl: ttl || CACHE_TTL_MS });
}

async function preview(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url || url.length > 2048) return null;

  const cached = cacheGet(url);
  if (cached !== undefined) return cached;

  let target;
  try {
    target = assertPublicUrl(url);
  } catch {
    return null;
  }

  try {
    const { html, finalUrl } = await requestOnce(target, MAX_REDIRECTS);
    const meta = pickMeta(html, finalUrl);
    if (!meta.title && !meta.image) {
      cacheSet(url, null, FAIL_TTL_MS);
      return null;
    }
    const data = { url: finalUrl, ...meta };
    cacheSet(url, data);
    return data;
  } catch {
    cacheSet(url, null, FAIL_TTL_MS); // 失败也缓存 5 分钟，避免同一条消息反复重试打人家的站
    return null;
  }
}

module.exports = { preview, pickMeta, isPrivateHost, assertPublicUrl, cache };
