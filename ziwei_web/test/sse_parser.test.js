'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{SSEParser}=require('../sse_parser');
test('split UTF-8 codepoints and SSE frames',()=>{const events=[],p=new SSEParser(x=>events.push(x)),buf=Buffer.from('data: {"text":"知微"}\n\ndata: [DONE]\n\n');for(let i=0;i<buf.length;i++)p.feed(buf.subarray(i,i+1));p.end();assert.deepEqual(events,[{event:'message',data:{text:'知微'}},{event:'done',data:null}])});
test('multiline and custom event',()=>{const e=[],p=new SSEParser(x=>e.push(x));p.feed(Buffer.from('event: tool\n'+'data: line1\n'+'data: line2\n\n'));p.end();assert.deepEqual(e,[{event:'tool',data:'line1\nline2'},{event:'disconnect',data:null}])});
test('disconnect is not successful completion',()=>{const e=[],p=new SSEParser(x=>e.push(x));p.feed(Buffer.from('data: {"delta":"partial"}\n\n'));p.end();assert.equal(e.at(-1).event,'disconnect')});

test('Hermes named done with JSON payload completes without disconnect',()=>{const events=[],p=new SSEParser(x=>events.push(x));p.feed(Buffer.from('event: assistant.completed\ndata: {"content":"测试完成"}\n\nevent: run.completed\ndata: {"completed":true}\n\nevent: done\ndata: {"seq":7}\n\n'));p.end();assert.equal(events.at(-1).event,'done');assert.equal(events.some(x=>x.event==='disconnect'),false);assert.equal(events[0].data.content,'测试完成')});
