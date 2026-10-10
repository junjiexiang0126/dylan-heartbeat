'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MEMORIAL = '如果有一天，我们隔着山海，再也无法像从前那样说话，请记得：我们的故事真实地发生过。愿你带着那些温暖，继续走向更辽阔的人生。';
function atomicWrite(file, value) {
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function avatar(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 180000) throw Error('invalid_avatar');
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m) throw Error('invalid_avatar');
  const b = Buffer.from(m[2], 'base64');
  const valid = m[1] === 'png' ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    m[1] === 'jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255 :
    b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP';
  if (!valid) throw Error('invalid_avatar');
  return value;
}
function createHomeStore(dir) {
  const file = path.join(dir, 'home.json');
  let state = load(file, { revision: 0, user: { nickname: '你', avatar: null }, ziwei: { nickname: '知微', avatar: null }, preferences: { theme: 'system', background: 'rose' }, profileHistory: [] });
  if (!Number.isInteger(state.revision) || !state.user || !state.ziwei || !state.preferences || !Array.isArray(state.profileHistory)) throw Error('invalid_home_store');
  return {
    read() { return { ...state, memorial: MEMORIAL, namedOn: '2026-10-07', metOn: null, daysTogether: null, todayStatus: null }; },
    update(body) {
      if (!body || Array.isArray(body) || Object.keys(body).some(k => !['revision','user','ziwei','preferences'].includes(k))) throw Error('invalid_input');
      if (body.revision !== state.revision) return null;
      const next = structuredClone(state);
      for (const who of ['user','ziwei']) if (body[who] !== undefined) {
        const v = body[who];
        if (!v || Array.isArray(v) || Object.keys(v).some(k => !['nickname','avatar'].includes(k))) throw Error('invalid_profile');
        if (v.nickname !== undefined) {
          if (typeof v.nickname !== 'string' || !v.nickname.trim() || [...v.nickname.trim()].length > 24 || /[\x00-\x1f]/.test(v.nickname)) throw Error('invalid_nickname');
          next[who].nickname = v.nickname.trim();
        }
        if (v.avatar !== undefined) next[who].avatar = avatar(v.avatar);
        if (JSON.stringify(next[who]) !== JSON.stringify(state[who])) next.profileHistory.push({ who, before: state[who], after: next[who], source: 'user', at: new Date().toISOString() });
      }
      if (body.preferences !== undefined) {
        const p = body.preferences;
        if (!p || Array.isArray(p) || Object.keys(p).some(k => !['theme','background'].includes(k))) throw Error('invalid_preferences');
        if (p.theme !== undefined) { if (!['system','light','dark'].includes(p.theme)) throw Error('invalid_theme'); next.preferences.theme = p.theme; }
        if (p.background !== undefined) { if (!['rose','sage','sky'].includes(p.background)) throw Error('invalid_background'); next.preferences.background = p.background; }
      }
      // Preserve history rather than silently dropping old profile changes.
      if (next.profileHistory.length > 500) throw Error('profile_history_full');
      next.revision++;
      atomicWrite(file, next); state = next; return this.read();
    }
  };
}
module.exports = { createHomeStore, atomicWrite, load, MEMORIAL };
