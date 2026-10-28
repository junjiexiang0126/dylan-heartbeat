'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DEFAULT_DIR = '/webdata';
function paths(dir = process.env.ZIWEI_WEB_DAY_DIR || DEFAULT_DIR) {
  return {briefings:path.join(dir,'briefings.jsonl'), tasks:path.join(dir,'tasks.json'), approvals:path.join(dir,'approvals.json')};
}
// A malformed or unavailable source is an empty collection, never an exception to the reader.
function readArray(file, key) {
  try {
    const value = JSON.parse(fs.readFileSync(file,'utf8'));
    const list = key ? value?.[key] : value;
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function readBriefings(file) {
  try {
    const lines = fs.readFileSync(file,'utf8').trim();
    if (!lines) return [];
    return lines.split(/\r?\n/).map(line=>JSON.parse(line)).filter(x=>x && typeof x==='object' && !Array.isArray(x) && !Number.isNaN(Date.parse(x.at)) && typeof x.did==='string')
      .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  } catch { return []; }
}
function rank(p) {
  if (typeof p==='number' && Number.isFinite(p)) return p;
  if (typeof p==='string') {
    const n = Number(p); if (p.trim() && Number.isFinite(n)) return n;
    return {urgent:100,high:80,medium:50,low:20}[p.toLowerCase()] ?? -Infinity;
  }
  return -Infinity;
}
function activeTasks(file) {
  return readArray(file).filter(x=>x && typeof x==='object' && !Array.isArray(x) && !['done','completed','complete','cancelled','canceled','closed'].includes(String(x.status||'').toLowerCase()))
    .sort((a,b)=>rank(b.priority)-rank(a.priority));
}
function pendingApprovals(file) {
  return readArray(file,'items').filter(x=>x && typeof x==='object' && !Array.isArray(x) && (x.decision == null || x.decision === '') && !x.decided_at);
}
function readDay(dir) {
  const p=paths(dir);
  return {briefings:readBriefings(p.briefings), approvals:pendingApprovals(p.approvals), tasks:activeTasks(p.tasks)};
}
function atomic(file, value) {
  const temp=path.join(path.dirname(file),`.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600}); fs.renameSync(temp,file);}
  finally {try {fs.unlinkSync(temp);} catch (e) {if (e.code!=='ENOENT') throw e;}}
}
function approve(id, decision, dir) {
  if (typeof id!=='string' || !id || !['approved','rejected'].includes(decision)) return {status:400,error:'invalid_input'};
  const p=paths(dir), items=readArray(p.approvals,'items');
  const item=items.find(x=>x && x.id===id);
  if (!item) return {status:404,error:'not_found'};
  if ((item.decision != null && item.decision !== '') || item.decided_at) return {status:409,error:'already_decided'};
  item.decision=decision; item.decided_at=new Date().toISOString();
  try {atomic(p.approvals,{items});} catch {return {status:503,error:'write_failed'};}
  return {status:200,item};
}
function topTask(id, dir) {
  if (typeof id!=='string' || !id) return {status:400,error:'invalid_input'};
  const p=paths(dir), tasks=readArray(p.tasks);
  const item=tasks.find(x=>x && x.id===id && !['done','completed','complete','cancelled','canceled','closed'].includes(String(x.status||'').toLowerCase()));
  if (!item) return {status:404,error:'not_found'};
  const max=Math.max(0,...tasks.map(x=>rank(x?.priority)).filter(Number.isFinite));
  item.priority=max+1;
  try {atomic(p.tasks,tasks);} catch {return {status:503,error:'write_failed'};}
  return {status:200,item};
}
module.exports={readDay,approve,topTask,paths};
