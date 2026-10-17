'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ChatStore}=require('../chat_store'),{NativeHistory}=require('../native_history');
test('history checkpoints survive restart, stable sessions are skipped, and only changed sessions are read',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-history-resume-'));let store=new ChatStore(dir,'history-test'),history;
 const sessions=Array.from({length:23},(_,i)=>({id:'real-session-'+i,messages:[{id:1,role:'assistant',content:'native '+i,timestamp:1700000000+i}]}));
 const calls=[];const client={json:async route=>{calls.push(route);const u=new URL(route,'http://fixture'),id=/\/api\/sessions\/([^/]+)\/messages/.exec(u.pathname)?.[1];if(!id)return {data:sessions.map(s=>({id:s.id,message_count:s.messages.length,last_active:s.messages.at(-1).timestamp})),has_more:false};const rows=sessions.find(s=>s.id===id).messages,offset=Number(u.searchParams.get('offset'));return {data:rows.slice(offset,offset+500)};}};
 try{
  history=new NativeHistory(client,store);await history.sync();await history.running;assert.equal(history.status().state,'pending');assert.equal(history.status().messages,19);history.close();store.close();
  store=new ChatStore(dir,'history-test');history=new NativeHistory(client,store);calls.length=0;await history.sync();await history.running;assert.equal(history.status().state,'completed');assert.equal(history.status().messages,23);assert.equal(calls.filter(x=>x.includes('/messages?')).length,4);
  calls.length=0;const eventCount=store.db.prepare('SELECT count(*) n FROM events').get().n;await history.sync();await history.running;assert.equal(calls.length,1);assert.equal(store.db.prepare('SELECT count(*) n FROM events').get().n,eventCount);
  sessions[5].messages.push({id:2,role:'user',content:'new',timestamp:1700001000});calls.length=0;await history.sync();await history.running;assert.equal(history.status().messages,24);assert.equal(calls.filter(x=>x.includes('/messages?')).length,1);
 }finally{history?.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('history failure identifies the exact session and offset while retaining already imported data',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-history-error-')),store=new ChatStore(dir,'history-test');let fail=true;
 const client={json:async route=>{if(route.startsWith('/api/sessions?'))return {data:[{id:'real-a'},{id:'real-b'}],has_more:false};if(route.includes('/real-b/')&&fail)throw Error('unavailable');return {data:[{id:1,role:'user',content:route.includes('/real-b/')?'b':'a',timestamp:1700000000}]};}};
 const history=new NativeHistory(client,store);try{await history.sync();await history.running;assert.equal(history.status().state,'failed');assert.equal(history.status().failedAt.session,'real-b');assert.equal(history.status().failedAt.offset,0);assert.equal(store.list({source:'archive'}).length,1);fail=false;await history.sync();await history.running;assert.equal(history.status().state,'completed');assert.equal(store.list({source:'archive'}).length,2);}finally{history.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
