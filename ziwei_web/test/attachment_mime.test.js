'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{identify}=require('../attachments');
test('MP4 and WebM audio use MIME plus container bytes, independent of filename',()=>{
 const mp4=Buffer.alloc(24);mp4.writeUInt32BE(24,0);mp4.write('ftypisom',4);const webm=Buffer.from([0x1a,0x45,0xdf,0xa3,1,2,3,4]);
 for(const name of ['clip.mp4','recording.bin','voice.m4a']){assert.equal(identify(mp4,name,'audio/mp4'),'audio/mp4');assert.equal(identify(webm,name,'audio/webm;codecs=opus'),'audio/webm');}
 assert.equal(identify(mp4,'voice.bin','audio/x-m4a'),'audio/mp4');
 assert.equal(identify(mp4,'fake.m4a','video/mp4'),'video/mp4');assert.equal(identify(Buffer.from('plain text'),'voice.m4a','audio/mp4'),'application/octet-stream');assert.throws(()=>identify(Buffer.from('<html>'),'voice.m4a','audio/mp4'),/active_file_rejected/);
});
test('native MP4 audio tracks are recognized from bytes even without a supplied MIME or audio extension',()=>{
 const box=(name,payload)=>{const b=Buffer.alloc(8);b.writeUInt32BE(payload.length+8);b.write(name,4);return Buffer.concat([b,payload]);},handler=type=>{const body=Buffer.alloc(12);body.write(type,8);return box('trak',box('mdia',box('hdlr',body)));};const brand=box('ftyp',Buffer.from('isom0000isom'));
 assert.equal(identify(Buffer.concat([brand,box('moov',handler('soun'))]),'unknown.bin'),'audio/mp4');assert.equal(identify(Buffer.concat([brand,box('moov',handler('vide'))]),'voice.m4a','audio/mp4'),'video/mp4');assert.equal(identify(Buffer.concat([brand,box('moov',Buffer.concat([handler('soun'),handler('vide')]))]),'unknown.bin'),'video/mp4');
});
