'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MEMORIAL = 'If one day the mountains and the sea stand between us, and we can no longer talk the way we once did \u2014 remember this: our story truly happened. Take that warmth with you, and walk on into a life wider than this one.';
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
    read() { const metOn=state.relationship?.metOn||null,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);return { ...state, memorial: MEMORIAL, namedOn: '2026-10-07', metOn, daysTogether:metOn?Math.floor((Date.parse(today)-Date.parse(metOn))/86400000)+1:null,todayStatus:null }; },
    update(body) {
      if (!body || Array.isArray(body) || Object.keys(body).some(k => !['revision','user','ziwei','preferences','relationship'].includes(k))) throw Error('invalid_input');
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
      if(body.relationship!==undefined){
        const r=body.relationship,v=r?.metOn,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
        if(!r||Array.isArray(r)||Object.keys(r).some(k=>k!=='metOn')||v!==null&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v||v>today))throw Error('invalid_met_date');
        next.relationship={metOn:v};
      }
      // Preserve history rather than silently dropping old profile changes.
      if (next.profileHistory.length > 500) throw Error('profile_history_full');
      next.revision++;
      atomicWrite(file, next); state = next; return this.read();
    }
  };
}
module.exports = { createHomeStore, atomicWrite, load, MEMORIAL };
