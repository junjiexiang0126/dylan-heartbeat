/* 保存 / 分享文件时，别把 PWA 顶走。
 *
 * 背景：文件卡片、"保存原图"以前都是 <a download> 直接跳转。iOS 的 Safari/PWA 一旦跳进下载页
 * 就没有"返回"这个动作，用户只能杀掉 App 重进（2026-10-16 语报告的 bug）。
 *
 * 策略，按顺序试：
 *   1. navigator.share({files}) —— iOS 弹系统分享面板，"存储到文件"很顺，页面原地不动；
 *   2. 回落到 target="_blank" rel="noopener" 的新标签页打开，主页面（PWA）保持不动；
 *   3. 环境不支持以上任何一种时，报告失败，由调用方提示用户。
 *
 * 依赖是可注入的（env），因此这个文件能在 Node 里直接单测，不需要浏览器。
 */
(function (global) {
  'use strict';

  function defaultEnv() {
    return {
      navigator: typeof navigator !== 'undefined' ? navigator : undefined,
      document: typeof document !== 'undefined' ? document : undefined,
      fetch: typeof fetch !== 'undefined' ? fetch : undefined,
      File: typeof File !== 'undefined' ? File : undefined,
      URL: typeof URL !== 'undefined' ? URL : undefined,
      Blob: typeof Blob !== 'undefined' ? Blob : undefined,
    };
  }

  async function shareFile(url, name, env) {
    const e = env || defaultEnv();
    if (!e.navigator || typeof e.navigator.share !== 'function' || typeof e.fetch !== 'function') {
      return 'unsupported';
    }
    const response = await e.fetch(url);
    if (!response || !response.ok) throw new Error('fetch_failed');
    const blob = await response.blob();
    let file = blob;
    if (typeof e.File === 'function') file = new e.File([blob], name || 'file', { type: blob.type || 'application/octet-stream' });
    if (typeof e.navigator.canShare === 'function' && !e.navigator.canShare({ files: [file] })) return 'unsupported';
    await e.navigator.share({ files: [file], title: name || '' });
    return 'shared';
  }

  function openInNewTab(url, name, env) {
    const e = env || defaultEnv();
    if (!e.document || !e.document.createElement) return 'failed';
    const link = e.document.createElement('a');
    link.href = url;
    link.download = name || '';
    link.target = '_blank';
    link.rel = 'noopener';
    if (e.document.body && e.document.body.appendChild) {
      e.document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      return 'failed';
    }
    return 'opened';
  }

  /** 返回 'shared' | 'opened' | 'cancelled' | 'failed'，调用方据此给提示。 */
  async function saveOrShare(url, name, env) {
    if (!url) return 'failed';
    if (!env && global.ZiweiFiles) { await global.ZiweiFiles.open(url, name || '文件'); return 'prepared'; }
    try {
      const result = await shareFile(url, name, env);
      if (result === 'shared') return 'shared';
    } catch (error) {
      if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError')) return 'cancelled';
      // 分享失败（比如跨域取不到 blob）不致命，继续走新标签页兜底
    }
    try {
      return openInNewTab(url, name, env);
    } catch (error) {
      return 'failed';
    }
  }

  /** 把某个元素绑成"保存/下载"入口：永远不让主页面被顶走。 */
  function bind(element, getUrl, getName, env) {
    if (!element) return element;
    const e = env || defaultEnv();
    if (e.document && 'target' in element) {
      element.target = '_blank';
      element.rel = 'noopener';
    }
    element.addEventListener('click', function (event) {
      const url = typeof getUrl === 'function' ? getUrl() : getUrl;
      event.preventDefault();
      if (!url) return;
      const name = typeof getName === 'function' ? getName() : getName;
      saveOrShare(url, name, e).then(function (result) {
        element.dispatchEvent(new CustomEvent('ziwei-save-result', { detail: { result: result, name: name } }));
      });
    });
    return element;
  }

  const api = { saveOrShare: saveOrShare, bind: bind };
  if (global) global.ZiweiSave = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
