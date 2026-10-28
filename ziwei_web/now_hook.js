'use strict';
// 心潮「此刻」注入：只在这一轮发给 Hermes 的 user 文本前面加一段，
// 不动系统提示（不动缓存前缀），官方口径：未变化 30 分钟内不重复附加。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = process.env.ZIWEI_WEB_DATA_DIR || '/webdata';
const NOW = path.join(DIR, 'now.json');
const MEMO = path.join(DIR, 'now-injected.json');
const FRESH_MS = 15 * 60 * 1000;
const SKIP_SAME_MS = 30 * 60 * 1000;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function decorate(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  try {
    const now = readJson(NOW, null);
    if (!now || typeof now.text !== 'string' || !now.text.trim()) return text;
    const gen = Date.parse(now.generatedAt || '');
    if (!Number.isFinite(gen) || Date.now() - gen > FRESH_MS) return text;
    const memo = readJson(MEMO, {}) || {};
    const digest = now.digest || crypto.createHash('sha256').update(now.text).digest('hex').slice(0, 16);
    const last = Date.parse(memo.at || '');
    if (memo.digest === digest && Number.isFinite(last) && Date.now() - last < SKIP_SAME_MS) return text;
    const out = now.text.trim() + '\n\n' + text;
    const tmp = MEMO + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ digest, at: new Date().toISOString() }));
    fs.renameSync(tmp, MEMO);
    return out;
  } catch (e) {
    return text;
  }
}

module.exports = { decorate };
