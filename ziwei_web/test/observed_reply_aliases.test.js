'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../chat_presentation');
for(const type of ['ziwei.reply.v1','wei.reply.v1','weiwei.reply.v1','weiwen.reply.v1']){
 test('preserves full synthetic reply and optional note for '+type,()=>{
  const messages=['这是完整的一句话，不能按标点删改。','第二段保持原样。\nMEDIA: /workspace/outbox/test.png'];
  const public_notes=[{kind:'role_monologue',text:'这是一段合成测试内容。'}];
  const result=parse(JSON.stringify({type,messages,public_notes}),{publicNotes:true});
  assert.equal(result.structured,true);assert.deepEqual(result.messages,messages);
  const canonical=parse(JSON.stringify({type:'ziwei.reply.v1',messages,public_notes}),{publicNotes:true});
  assert.deepEqual(result.publicNotes,canonical.publicNotes);
 });
}
test('does not interpret unrelated JSON or force a note',()=>{
 const raw=JSON.stringify({type:'other.domain',messages:['技术资料示例']});assert.deepEqual(parse(raw).messages,[raw]);
 assert.deepEqual(parse('正常的一段话。',{publicNotes:true}).messages,['正常的一段话。']);
 assert.equal(parse('正常的一段话。',{publicNotes:true}).publicNotes,undefined);
});
