'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{ChatStore,hash}=require('../chat_store');
const {checkedDirectory}=require('../data_directory');
test('native directory descendants and symlink aliases are rejected before any business data write',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-path-'));try{const native=path.join(root,'native');fs.mkdirSync(native);const alias=path.join(root,'alias');fs.symlinkSync(native,alias);assert.throws(()=>checkedDirectory(path.join(alias,'new-web'),{HERMES_HOME:native}));assert.throws(()=>checkedDirectory('/data/some-web'));assert.deepEqual(fs.readdirSync(native),[]);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('archive imports are atomic, idempotent, searchable and separate from live conversation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-archive-'));let s=new ChatStore(dir,'test');
 try{const doc={sha256:hash('verified private source'),records:[{ref:'state.db/session:old/message:1',role:'user',content:'真实旧档案',at:'2026-10-01T00:00:00Z'}]};assert.equal(s.importArchive(doc,'fixture.zip').replayed,false);assert.equal(s.importArchive(doc,'fixture.zip').replayed,true);assert.equal(s.list({source:'live'}).length,0);assert.equal(s.list({source:'archive',q:'旧档案'}).length,1);assert.equal(s.db.prepare('SELECT count(*) n FROM requests').get().n,0);
  const invalid={sha256:hash('broken source'),records:[...doc.records,{ref:'bad',role:'system',content:'invalid',at:'unknown'}]};assert.throws(()=>s.importArchive(invalid,'bad'));assert.equal(s.list({source:'archive'}).length,1);s.close();s=new ChatStore(dir,'test');assert.equal(s.list({source:'archive'}).length,1);
 }finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('native endpoint, session or principal changes cannot reuse an existing request database',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-retention-')),s=new ChatStore(dir,'test');try{s.addRequest('11111111-1111-4111-8111-111111111111',{message:'existing accepted intent',attachments:[],quote:null});assert.throws(()=>new ChatStore(dir,'other-native-scope'));assert.equal(s.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
