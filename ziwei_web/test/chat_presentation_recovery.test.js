'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parse}=require('../chat_presentation');
const wrap=(body)=>'{"type":"ziwei.reply.v1","messages":['+body+']}';
test('repairs Chinese commas only outside strings',()=>{
 const r=parse('{"type":"ziwei.reply.v1"，"messages":["你好，今天","第二条"]}');
 assert.equal(r.structured,true);assert.deepEqual(r.messages,['你好，今天','第二条']);
});
test('repairs literal line breaks inside quoted messages',()=>{
 const r=parse(wrap('"第一行\n第二行","下一条"'));
 assert.equal(r.structured,true);assert.deepEqual(r.messages,['第一行\n第二行','下一条']);
});
test('keeps MEDIA marker in last message without splitting',()=>{
 const r=parse(wrap('"你好","MEDIA: /workspace/outbox/a.png"'));
 assert.equal(r.structured,true);assert.equal(r.messages[1],'MEDIA: /workspace/outbox/a.png');
});
test('does not split ordinary prose or fabricate summary',()=>{
 const r=parse('你好，今天。\n明天见。');
 assert.deepEqual(r.messages,['你好，今天。\n明天见。']);assert.equal(r.summary,null);
});
test('does not interpret arbitrary JSON as reply envelope',()=>{
 const raw='{"messages":["a","b"]}';assert.deepEqual(parse(raw).messages,[raw]);
});
test('accepts fenced JSON with summary',()=>{
 const r=parse('```json\n'+wrap('"一","二"').replace(/}$/,',"summary":"已完成"}')+'\n```');
 assert.equal(r.structured,true);assert.equal(r.summary,'已完成');
});