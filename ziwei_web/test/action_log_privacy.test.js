'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {ActionLog}=require('../action_log');
test('tool started/completed are correlated, no raw preview is stored',()=>{
 const db=new DatabaseSync(':memory:'),log=new ActionLog(db);
 assert.equal(log.capture('req','tool.started',{seq:1,tool:'web_search',tool_call_id:'call1',preview:'secret query'}),true);
 assert.equal(log.capture('req','tool.completed',{seq:2,tool:'web_search',tool_call_id:'call1'}),true);
 const rows=log.list('req');assert.equal(rows.length,1);assert.equal(rows[0].state,'completed');assert.equal(rows[0].preview,'');db.close();
});
test('never stores hidden thinking events',()=>{
 const db=new DatabaseSync(':memory:'),log=new ActionLog(db);
 assert.equal(log.capture('req','tool.started',{seq:1,tool_name:'_thinking',preview:'private'}),false);
 assert.deepEqual(log.list('req'),[]);db.close();
});
test('unmatched completions do not fabricate tool actions',()=>{
 const db=new DatabaseSync(':memory:'),log=new ActionLog(db);
 assert.equal(log.capture('req','tool.completed',{seq:9,tool_name:'terminal'}),false);
 assert.deepEqual(log.list('req'),[]);db.close();
});