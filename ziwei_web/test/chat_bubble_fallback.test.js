'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parse}=require('../chat_presentation');
test('malformed reply envelope shows individual plain bubbles, never raw JSON',()=>{
 const result=parse('{"type":"ziwei.reply.v1","messages":["第一句","第二句",]}');
 assert.deepEqual(result.messages,['第一句','第二句']);
 assert.equal(result.structured,false);
});
test('unrecoverable envelope never shows wire JSON',()=>{
 const result=parse('{"type":"ziwei.reply.v1","messages":[oops]}');
 assert.equal(result.messages.length,1);
 assert.doesNotMatch(result.messages[0],/ziwei.reply.v1|\{"type"/);
});
test('ordinary prose and unrelated JSON remain untouched',()=>{
 for(const value of ['你好','{"type":"other","messages":["a"]}'])assert.deepEqual(parse(value).messages,[value]);
});
test('valid structured reply keeps each chosen bubble',()=>{
 const result=parse(JSON.stringify({type:'ziwei.reply.v1',messages:['一','二','三']}));
 assert.deepEqual(result.messages,['一','二','三']);
 assert.equal(result.structured,true);
});
