'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{parse,transport}=require('../chat_presentation');
test('plain long work text and fenced code are never mechanically split',()=>{
 const text=('完整工作说明\n\n').repeat(2000)+'```js\nconsole.log(1)\n```';assert.deepEqual(parse(text).messages,[text]);assert.equal(parse(text).structured,false);
});
test('only a valid explicit Agent envelope selects multiple messages',()=>{
 const texts=['第一条','第二条\n保留段落'];assert.deepEqual(parse(JSON.stringify({type:'ziwei.reply.v1',messages:texts})).messages,texts);assert.deepEqual(parse('```json\n'+JSON.stringify({type:'ziwei.reply.v1',messages:texts})+'\n```').messages,texts);
 for(const text of ['{"messages":["ordinary","JSON"]}',JSON.stringify({type:'ziwei.reply.v1',messages:['valid',{}]}),'{"type":"ziwei.reply.v1",'])assert.deepEqual(parse(text).messages,[text]);
});
test('transport retains user text and multimodal parts without modifying input',()=>{
 assert.ok(transport('原文').endsWith('原文'));const input=[{type:'image_url',image_url:{url:'data:image/png;base64,AAA'}}],result=transport(input);assert.equal(input.length,1);assert.deepEqual(result[1],input[0]);assert.match(result[0].text,/不输出内部逐步推理/);
});
