import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStatusCopy,plainText} from '../raven/status-copy.mjs';
const at='2026-10-16T10:00:00+07:00';
const value={source:'ziwei',state:'在工作',updatedAt:at,stale:false};
test('native note/mood take precedence and remain fixed across time slots',()=>{
 const v={...value,note:'今天先把这件事做好。',mood:'安静，专注'};
 for(const h of [0,6,12,18]){const now=Date.parse('2026-10-16T'+String(h).padStart(2,'0')+':05:00+07:00');const c=resolveStatusCopy({...v,updatedAt:new Date(now).toISOString()},now);assert.equal(c.note,v.note);assert.equal(c.mood,v.mood);assert.equal(c.noteSource,'ziwei');}
});
test('local scene copy rotates without repeats in one Bangkok day and survives refresh',()=>{
 const notes=[];
 for(const h of [0,6,12,18]){const now=Date.parse('2026-10-16T'+String(h).padStart(2,'0')+':05:00+07:00'),v={...value,updatedAt:new Date(now).toISOString()};const c=resolveStatusCopy(v,now);assert.equal(c.noteSource,'local');assert.equal(c.note,resolveStatusCopy(v,now+1000).note);assert.equal(c.note,resolveStatusCopy({...v,note:' ',mood:42},now).note);notes.push(c.note);}
 assert.equal(new Set(notes).size,4);
});
test('expiry uses local expired copy while missing and unknown records invent nothing',()=>{
 const now=Date.parse(at)+30*60000,c=resolveStatusCopy({...value,note:'旧的原话',mood:'旧心情'},now);assert.equal(c.noteSource,'local');assert.notEqual(c.note,'旧的原话');assert.match(c.mood,/等更新/);
 for(const v of [null,{...value,source:'tool'},{...value,state:'不存在'}])assert.deepEqual(resolveStatusCopy(v,now),{mood:'',note:'',moodSource:'none',noteSource:'none',slot:null});
 assert.equal(resolveStatusCopy(value,Date.parse(at),{}).note,'');
});
test('optional fields accept text only and enforce codepoint limits',()=>{
 assert.equal(plainText({text:'假'},60),'');assert.equal(plainText('  A\n B\u0000  ',60),'A B');assert.equal([...plainText('🪶'.repeat(65),60)].length,60);
 const c=resolveStatusCopy({...value,note:'🪶'.repeat(65),mood:'静'.repeat(30)},Date.parse(at));assert.equal([...c.note].length,60);assert.equal(c.mood.length,24);
});
