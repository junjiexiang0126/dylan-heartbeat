'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMockVoiceBridge}=require('../realtime_voice/mock');
const {RealtimeVoiceBridge}=require('../realtime_voice/bridge');
test('mock bridge completes one no-key utterance and emits audio',async()=>{
 const frames=[],bridge=createMockVoiceBridge({onAudio:f=>frames.push(f)});
 bridge.start();const result=await bridge.utterance(Buffer.from('mock'));
 assert.equal(result.status,'completed');assert.equal(bridge.session.turn,1);
 assert.ok(frames.length>0);bridge.hangup();
});
test('silent or muted input does not call ASR',async()=>{
 let count=0;const bridge=new RealtimeVoiceBridge({
  asr:{transcribe:async()=>{count++;return 'hi';}},
  hermes:{reply:async()=>{}},tts:{speak:async()=>{}}
 });bridge.start();await bridge.utterance(Buffer.alloc(0));
 bridge.mute(true);await bridge.utterance(Buffer.from('audio'));
 assert.equal(count,0);bridge.hangup();
});
test('TTS starts when first sentence delta arrives, before LLM completion',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const order=[];const bridge=new RealtimeVoiceBridge({
  asr:{transcribe:async()=> 'hi'},
  hermes:{reply:async(_,{onDelta})=>{onDelta('第一句。');await gate;onDelta('第二句。');}},
  tts:{speak:async(t,{onAudio})=>{order.push(t);onAudio({text:t});}}
 });bridge.start();const pending=bridge.utterance(Buffer.from('audio'));
 for(let i=0;i<20&&!order.length;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(order,['第一句。']);release();
 const result=await pending;assert.equal(result.status,'completed');
 assert.deepEqual(order,['第一句。','第二句。']);bridge.hangup();
});
