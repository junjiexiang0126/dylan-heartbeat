'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{classify}=require('../recovery');
const hash=crypto.createHash('sha256').update('hello').digest('hex');
test('recovery recognizes one exact user and one assistant after baseline',()=>{const r=classify({hash,state:'uncertain',baseline:10},[{id:9,role:'user',content:'hello'},{id:11,role:'user',content:'hello'},{id:12,role:'assistant',content:'reply'}]);assert.equal(r.state,'history_confirmed');assert.equal(r.retrySafe,false)});
test('missing or ambiguous evidence never authorizes retry',()=>{for(const rows of [[],[{id:11,role:'user',content:'hello'}],[{id:11,role:'user',content:'hello'},{id:12,role:'user',content:'hello'},{id:13,role:'assistant',content:'reply'}]]){const r=classify({hash,state:'uncertain',baseline:10},rows);assert.equal(r.state,'uncertain');assert.equal(r.retrySafe,false)}});
