'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('raven presence has a strict source and TTL; missing records do not become pretend-dead states',async()=>{
 const {resolvePresence,PRESENCE_TTL}=await import('../raven/presence.mjs'),now=Date.parse('2026-10-16T10:00:00Z'),value={source:'ziwei',state:'在工作',updatedAt:new Date(now-PRESENCE_TTL+1).toISOString(),stale:false};
 assert.equal(resolvePresence(value,now).mode,'Work');assert.equal(resolvePresence(value,now+1).mode,'Stale');assert.equal(resolvePresence({...value,stale:true},now).mode,'Stale');
 for(const x of [null,{...value,source:'browser'},{...value,updatedAt:'bad'},{...value,state:'自己猜的状态'}])assert.deepEqual(resolvePresence(x,now),{mode:'Idle',state:null,updatedAt:null,stale:false});
 for(const [state,mode] of [['在休息','Rest'],['在思考','Think'],['在想你','Affection']])assert.equal(resolvePresence({...value,state},now).mode,mode);
 assert.equal(value.state,'在工作');assert.equal(value.stale,false);
});
test('the delivered articulated GLB validates and contains all real animation channels without external assets',async()=>{
 const bytes=fs.readFileSync(path.join(__dirname,'../public/models/raven.glb')),validator=require('gltf-validator');const report=await validator.validateBytes(new Uint8Array(bytes),{maxIssues:100});assert.equal(report.issues.numErrors,0);assert.equal(report.issues.numWarnings,0);assert.equal(bytes.readUInt32LE(0),0x46546c67);
 const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length).toString());assert.deepEqual(gltf.animations.map(x=>x.name),['Idle','Work','Rest','Think','Affection','Stale','Jump','Poke','Blink']);for(const a of gltf.animations)assert.ok(a.channels.length>0);assert.ok(gltf.meshes.length>10);assert.ok(gltf.nodes.some(x=>x.name==='WingL'));assert.ok(gltf.nodes.some(x=>x.name==='FootR'));assert.ok(!gltf.buffers.some(x=>x.uri));assert.ok(!gltf.images?.some(x=>x.uri));
});
