'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {LiveKitCallTransport}=require('../public/livekit-call-transport');
const {RealtimeVoiceService}=require('../realtime_voice/service');
const {RealtimeVoiceBridge}=require('../realtime_voice/bridge');
const {VoiceQuota}=require('../realtime_voice/providers');

const env={ZIWEI_REALTIME_VOICE_ENABLED:'true',LIVEKIT_URL:'wss://voice.example.org',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test-only-secret-123456789',ZHIPU_API_KEY:'test',MINIMAX_API_KEY:'test',MINIMAX_VOICE_ID:'clone'};
function browserFixture(){
 const microphone=[],requests=[],states=[],listeners={};
 class Room{
  constructor(){this.localParticipant={setMicrophoneEnabled:async enabled=>microphone.push(enabled)};}
  on(name,fn){listeners[name]=fn;}
  async connect(){}
  async disconnect(){}
 }
 const transport=new LiveKitCallTransport({
  sdk:{Room,RoomEvent:{TrackSubscribed:'track',Disconnected:'disconnect',Reconnecting:'reconnecting',Reconnected:'reconnected'}},
  request:async(url,method,body)=>{requests.push({url,method,body});return url.endsWith('livekit-token')?{url:'wss://voice.example.org',token:'test',callId:'sleep-call'}:{ok:true};},
  onState:state=>states.push(state)
 });
 return {transport,microphone,requests,states,listeners};
}
test('sleep companion: mute disables mic, maintains call and heartbeat, unmutes without redial',async()=>{
 const f=browserFixture();await f.transport.connect();await f.transport.setMuted(true);
 assert.deepEqual(f.microphone,[true,false]);assert.equal(f.transport.closed,false);assert.equal(f.transport.muted,true);
 assert.equal(f.requests.filter(r=>r.url.endsWith('livekit-token')).length,1);
 await f.transport.sync();await f.transport.sync();
 assert.ok(f.requests.filter(r=>r.url.endsWith('/control')).every(r=>r.body.muted===true||r.body.muted===false));
 assert.deepEqual(f.requests.filter(r=>r.url.endsWith('/control')).slice(-2).map(r=>r.body.muted),[true,true]);
 await f.transport.setMuted(false);
 assert.equal(f.transport.closed,false);assert.equal(f.requests.filter(r=>r.url.endsWith('livekit-token')).length,1);
 assert.deepEqual(f.microphone,[true,false,true]);await f.transport.disconnect();
});
test('sleep companion: reconnect restores mute and does not enable microphone',async()=>{
 const f=browserFixture();await f.transport.connect();await f.transport.setMuted(true);
 f.listeners.reconnecting();f.listeners.reconnected();await new Promise(r=>setImmediate(r));
 assert.equal(f.transport.muted,true);assert.equal(f.microphone.at(-1),false);
 assert.equal(f.transport.closed,false);await f.transport.disconnect();
});
test('sleep companion: server stays open for hours when muted heartbeat continues',async()=>{
 let now=0,muted=null,closed=0;
 const s=new RealtimeVoiceService({env,now:()=>now,client:{configured:()=>true},createWorker:async()=>({start:async()=>{},setMuted:v=>{muted=v;},close:async()=>{closed++;}})});
 try{
  const call=await s.start('owner');s.control(call.callId,'owner',{muted:true});
  assert.equal(muted,true);
  for(let i=0;i<720;i++){now+=10000;s.control(call.callId,'owner',{muted:true});}
  assert.equal(s.calls.size,1);assert.equal(closed,0);
  await s.end(call.callId,'owner');assert.equal(s.calls.size,0);
 }finally{await s.close();}
});
test('sleep companion: muted bridge ignores audio without ASR, Hermes or TTS',async()=>{
 let asr=0,hermes=0,tts=0;
 const bridge=new RealtimeVoiceBridge({asr:{transcribe:async()=>{asr++;return '你好';}},hermes:{reply:async()=>{hermes++;}},tts:{speak:async()=>{tts++;}}});
 bridge.start();bridge.mute(true);
 for(let i=0;i<100;i++)assert.equal((await bridge.utterance(Buffer.from('audio'))).status,'ignored');
 assert.deepEqual([asr,hermes,tts],[0,0,0]);assert.equal(bridge.session.closed,false);
 bridge.mute(false);assert.equal((await bridge.utterance(Buffer.alloc(0))).status,'silence');
 assert.deepEqual([asr,hermes,tts],[0,0,0]);
});
test('sleep companion: accumulated usage and turns do not terminate call',async()=>{
 const quota=new VoiceQuota();for(let i=0;i<200;i++){quota.asr(60);quota.tts('你好'.repeat(200));}
 assert.equal(quota.turns,200);assert.equal(quota.seconds,12000);assert.equal(quota.characters,80000);
 const bridge=new RealtimeVoiceBridge({asr:{transcribe:async()=>''},hermes:{reply:async()=>{}},tts:{speak:async()=>{}}});
 bridge.start();bridge.session.turn=1000;
 assert.notEqual(bridge.session.beginSpeech(),null);assert.equal(bridge.session.closed,false);
});
