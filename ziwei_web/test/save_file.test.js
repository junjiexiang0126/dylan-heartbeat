// 单测：保存/分享不许把 PWA 顶走（saveOrShare 的三级回落）
// 跑法：node --test test/save_file.test.js
const test = require('node:test');
const assert = require('node:assert');
const save = require('../public/save-file.js');

function fakeDocument() {
  const created = [];
  const body = {
    appendChild(el) { created.push(el); return el; },
  };
  return {
    created,
    body,
    createElement(tag) {
      return {
        tag,
        style: {},
        target: '',
        rel: '',
        clicked: false,
        removed: false,
        listeners: {},
        click() { this.clicked = true; },
        remove() { this.removed = true; },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        dispatchEvent(event) { this.lastEvent = event; return true; },
      };
    },
  };
}

function envWith({ share, canShare, fetchImpl, document, FileImpl } = {}) {
  return {
    navigator: share === undefined ? undefined : { share, canShare },
    fetch: fetchImpl,
    document,
    File: FileImpl || (typeof File === 'function' ? File : undefined),
    Blob: typeof Blob === 'function' ? Blob : undefined,
  };
}

const okFetch = async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) });

test('有系统分享面板时走分享，页面不动', async () => {
  const calls = [];
  const env = envWith({
    share: async payload => { calls.push(payload); },
    canShare: () => true,
    fetchImpl: okFetch,
    document: fakeDocument(),
  });
  assert.equal(await save.saveOrShare('blob:x', '乌鸦.png', env), 'shared');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, '乌鸦.png');
  assert.equal(calls[0].files.length, 1);
  assert.equal(calls[0].files[0].name, '乌鸦.png');
});

test('系统不支持分享时回落到新标签页，主页面仍然不动', async () => {
  const doc = fakeDocument();
  const env = envWith({ share: undefined, fetchImpl: okFetch, document: doc });
  assert.equal(await save.saveOrShare('blob:y', '课件.pptx', env), 'opened');
  assert.equal(doc.created.length, 1);
  const anchor = doc.created[0];
  assert.equal(anchor.tag, 'a');
  assert.equal(anchor.target, '_blank');
  assert.equal(anchor.rel, 'noopener');
  assert.equal(anchor.download, '课件.pptx');
  assert.ok(anchor.clicked, '应该真的点了这个链接');
  assert.ok(anchor.removed, '点完要清理临时节点');
});

test('用户在分享面板点取消，不算失败也不该顶走页面', async () => {
  const abort = () => { const e = new Error('cancelled'); e.name = 'AbortError'; return e; };
  const env = envWith({
    share: async () => { throw abort(); },
    canShare: () => true,
    fetchImpl: okFetch,
    document: fakeDocument(),
  });
  assert.equal(await save.saveOrShare('blob:z', 'a.png', env), 'cancelled');
});

test('取不到文件体（比如跨域）时回落到新标签页', async () => {
  const doc = fakeDocument();
  const env = envWith({
    share: async () => { throw new Error('should not be called'); },
    canShare: () => true,
    fetchImpl: async () => ({ ok: false, blob: async () => new Blob([]) }),
    document: doc,
  });
  assert.equal(await save.saveOrShare('https://example.invalid/x', 'x.png', env), 'opened');
  assert.equal(doc.created.length, 1);
});

test('没有 document 时如实报告失败，不假装成功', async () => {
  const env = envWith({ share: undefined, fetchImpl: okFetch, document: undefined });
  assert.equal(await save.saveOrShare('blob:q', 'q.png', env), 'failed');
});

test('bind 会拦住默认跳转，并把结果派发出去', async () => {
  const doc = fakeDocument();
  const anchor = doc.createElement('a');
  anchor.href = 'blob:w';
  const env = envWith({ share: async () => {}, canShare: () => true, fetchImpl: okFetch, document: doc });
  let prevented = false;
  save.bind(anchor, () => 'blob:w', 'w.png', env);
  await anchor.listeners.click({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented, '必须阻止默认的同页跳转');
  assert.equal(anchor.target, '_blank');
});
