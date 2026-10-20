'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PcmSpeechFramer}=require('../realtime_voice/pcm_framer');
const loud=()=>new Int16Array(320).fill(9000);
const silent=()=>new Int16Array(320);
test('silence does not emit billable utterances',()=>{
 const utterances=[],f=new PcmSpeechFramer({onSpeech:x=>utterances.push(x)});
 for(let i=0;i<150;i++)f.push(silent());
 assert.equal(utterances.length,0);f.close();
});
test('voiced frames then silence emit one bounded PCM utterance',()=>{
 const utterances=[],f=new PcmSpeechFramer({onSpeech:x=>utterances.push(x)});
 for(let i=0;i<20;i++)f.push(loud());
 for(let i=0;i<33;i++)f.push(silent());
 assert.equal(utterances.length,1);
 assert.equal(utterances[0].sampleRate,16000);
 assert.equal(utterances[0].channels,1);
 assert.ok(utterances[0].pcm instanceof Int16Array);
 f.close();
});
test('mute clears pending speech and ignores audio until unmuted',()=>{
 const utterances=[],f=new PcmSpeechFramer({onSpeech:x=>utterances.push(x)});
 for(let i=0;i<20;i++)f.push(loud());
 f.setMuted(true);
 for(let i=0;i<50;i++)f.push(loud());
 f.setMuted(false);
 for(let i=0;i<33;i++)f.push(silent());
 assert.equal(utterances.length,0);
 f.close();
});
test('too-short noise is rejected',()=>{
 const utterances=[],f=new PcmSpeechFramer({onSpeech:x=>utterances.push(x)});
 for(let i=0;i<2;i++)f.push(loud());
 for(let i=0;i<33;i++)f.push(silent());
 assert.equal(utterances.length,0);f.close();
});
test('malformed frames and format are rejected',()=>{
 assert.throws(()=>new PcmSpeechFramer({sampleRate:11025}),/invalid_pcm_format/);
 const f=new PcmSpeechFramer();
 assert.throws(()=>f.push(Buffer.alloc(640)),/invalid_pcm_frame/);
 assert.throws(()=>f.push(new Int16Array(100)),/invalid_pcm_frame/);
 f.close();
});
test('silent preroll does not count toward minimum voiced duration',()=>{
 let n=0;const f=new PcmSpeechFramer({onSpeech:()=>n++});for(let i=0;i<10;i++)f.push(new Int16Array(320));for(let i=0;i<8;i++)f.push(new Int16Array(320).fill(9000));for(let i=0;i<33;i++)f.push(new Int16Array(320));assert.equal(n,0);
});
