'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatStore}=require('../chat_store');
test('tool action events are deduplicated, persisted and exposed on assistant replies without _thinking',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-tool-actions-'));
 let store;
 try{
  store=new ChatStore(dir,'tool-action-regression');
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  store.addRequest(id,{message:'test',attachments:[],quote:null});
  store.admitted(id,'run_test');
  store.upstreamEvent(id,1,()=>store.toolAction(id,1,'tool.started',{tool_name:'terminal',_thinking:'private text'}));
  store.upstreamEvent(id,2,()=>store.toolAction(id,2,'tool.completed',{tool_name:'terminal',_thinking:'private text'}));
  store.upstreamEvent(id,2,()=>store.toolAction(id,2,'tool.completed',{tool_name:'terminal'}));
  store.assistant(id,'reply-'+id,'done');
  let m=store.message('reply-'+id);
  assert.equal(m.toolActions.length,2);
  assert.deepEqual(m.toolActions.map(a=>a.state),['started','completed']);
  assert.ok(!JSON.stringify(m.toolActions).includes('private text'));
  store.close();store=null;
  store=new ChatStore(dir,'tool-action-regression');
  m=store.message('reply-'+id);
  assert.equal(m.toolActions.length,2);
 }finally{store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
