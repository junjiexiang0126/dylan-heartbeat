'use strict';
const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_FILE = '/webdata/reminders.json';
const LIMIT = 500;
function shorten(value, max) { return String(value ?? '').slice(0, max); }
function first(item, keys) { for (const key of keys) if (item[key] != null && item[key] !== '') return item[key]; return ''; }
function readReminders(file = process.env.ZIWEI_WEB_REMINDERS_FILE || DEFAULT_FILE) {
  let raw; try { raw = fs.readFileSync(file, 'utf8'); if (!raw.trim()) return {items: [], updatedAt: null}; raw = JSON.parse(raw); } catch { return {items: [], updatedAt: null}; }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.reminders) ? raw.reminders : Array.isArray(raw?.items) ? raw.items : [];
  const items = list.slice(0, LIMIT).filter(x => x && typeof x === 'object' && !Array.isArray(x)).map((x, i) => ({
    at: shorten(first(x, ['at','due','remind_at']), 100), title: shorten(first(x, ['title','name','text']), 200), body: shorten(first(x, ['body','note','detail']), 1000), _i: i
  })).sort((a,b) => { const aa=Date.parse(a.at), bb=Date.parse(b.at); return (Number.isNaN(aa)?Infinity:aa)-(Number.isNaN(bb)?Infinity:bb) || a._i-b._i; }).map(({_i,...x})=>x);
  return {items, updatedAt: null};
}
module.exports = {readReminders};
