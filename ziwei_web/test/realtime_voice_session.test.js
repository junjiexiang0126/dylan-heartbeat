'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {RealtimeCallSession}=require('../realtime_voice/session');
test('silence does not submit a turn',()=>{
 const events=[],s=new RealtimeCallSession({onEvent:e=>events.push(e.type)});
 assert.equal(s.start(),true);
 const token=s.beginSpeech(); assert.equal(s.finishSpeech(token,false),false);
 assert.equal(s.turn,0);assert.equal(s.phase,'listening');
 assert.equal(events.includes('user.speech.ready'),false);
});
test('mute cancels pending ASR and blocks new speech while preserving assistant playback',()=>{
 const cancelled=[],s=new RealtimeCallSession({onCancel:x=>cancelled.push(x)});
 s.start(); const token=s.beginSpeech();s.setMuted(true);
 assert.equal(s.finishSpeech(token,true),false);assert.equal(s.beginSpeech(),null);
 assert.deepEqual(cancelled,['asr']);assert.equal(s.phase,'listening');
 s.setMuted(false);assert.equal(s.beginSpeech(),s.generation);
});
test('interruption invalidates old assistant chunks',()=>{
 const cancelled=[],s=new RealtimeCallSession({onCancel:x=>cancelled.push(x)});
 s.start();const first=s.beginSpeech();assert.equal(s.finishSpeech(first,true),true);
 assert.equal(s.assistantAudio(first),true);
 const next=s.beginSpeech();assert.notEqual(next,first);
 assert.deepEqual(cancelled,['tts','llm']);assert.equal(s.assistantAudio(first),false);
 assert.equal(s.finishSpeech(next,true),true);
});
test('hangup invalidates all work and is idempotent',()=>{
 const cancelled=[],s=new RealtimeCallSession({onCancel:x=>cancelled.push(x)});
 s.start();const token=s.beginSpeech();s.hangup();
 assert.equal(s.finishSpeech(token,true),false);assert.equal(s.start(),false);
 assert.equal(s.hangup(),false);assert.deepEqual(cancelled,['asr','tts','llm']);
});

test('muting while assistant speaks keeps playback valid',()=>{
 const s=new RealtimeCallSession();s.start();
 const token=s.beginSpeech();s.finishSpeech(token,true);s.assistantAudio(token);
 s.setMuted(true);assert.equal(s.phase,'speaking');assert.equal(s.generation,token);
 assert.equal(s.assistantDone(token),true);
});
