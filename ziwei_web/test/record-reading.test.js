'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const reading=require('../public/record-reading');
test('work titles translate known internal choices and preserve user prose',()=>{
 assert.equal(reading.title({basis:'agent_briefing',title:'self_directed_task'}),'做了一点自己的事');
 assert.equal(reading.title({basis:'agent_briefing',title:'rest'}),'让自己歇一会儿');
 assert.equal(reading.title({basis:'memory_audit',title:'append · MEMORY.md'}),'补充了一段记忆');
 assert.equal(reading.title({basis:'agent_briefing',title:'窗边的一点想法'}),'窗边的一点想法');
 assert.equal(reading.title({basis:'memory_audit',title:'toString'}),'整理记忆');
});
test('legacy JSON narrative is read from known saved text fields without manufacturing prose',()=>{
 const raw=JSON.stringify({choice:'rest',did:'我歇了一会儿。',evidence:['internal/path'],reflection:'想到了昨天的对话。'});
 assert.equal(reading.narrative(raw),'我歇了一会儿。\n\n### 想到这里\n\n想到了昨天的对话。');
 assert.equal(reading.narrative('{not json}'),'{not json}');
 assert.equal(reading.narrative('{"count":3}'),'{"count":3}');
});
test('list previews remove Markdown notation and do not surface code snippets',()=>{
 assert.equal(reading.preview('## 一页\n\n**今天** [读到](https://example.org) 一句话。\n```js\nsecret()\n```'),'一页 今天 读到 一句话。 [代码片段]');
 assert.equal(reading.preview('真实内容'.repeat(80),100).length,100);
});
test('reading links allow only external http(s) links without credentials',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','https://u:p@x.test','https:\n//x.test','//x.test'])assert.equal(reading.safeURL(url),null);
 assert.equal(reading.safeURL('https://example.org/a?b=c'),'https://example.org/a?b=c');
});
