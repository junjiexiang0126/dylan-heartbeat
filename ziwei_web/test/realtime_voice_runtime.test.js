'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RealtimeVoiceService,livekitURL}=require('../realtime_voice/service');
const {HermesVoiceAdapter}=require('../realtime_voice/hermes_adapter');
const {VoiceRoomWorker}=require('../realtime_voice/room_worker');
const {TokenVerifier}=require('livekit-server-sdk');
const env={ZIWEI_REALTIME_VOICE_ENABLED:'true',LIVEKIT_URL:'wss://test.livekit.cloud',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test-only-secret-123456789',ZHIPU_API_KEY:'test',MINIMAX_API_KEY:'test',MINIMAX_VOICE_ID:'test'};
test('service admission is single-call, owner-bound, mic-only and releases cleanly',async()=>{
 let muted,closed=0;const s=new RealtimeVoiceService({env,client:{configured:()=>true},createWorker:async({onEvent})=>({start:async()=>{},setMuted:v=>muted=v,close:async()=>{closed++;onEvent({type:'call.ended'});}})});
 try{const a=await s.start('owner');await assert.rejects(s.start('owner2'),/busy/);
  const claims=await new TokenVerifier(env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET).verify(a.token);assert.equal(claims.video.room,a.room);assert.deepEqual(claims.video.canPublishSources,['microphone']);assert.equal(claims.video.canPublishData,false);
  assert.throws(()=>s.control(a.callId,'other',{muted:true}),/not_found/);s.control(a.callId,'owner',{muted:true});assert.equal(muted,true);
  await s.end(a.callId,'other');assert.equal(s.calls.size,1);await s.end(a.callId,'owner');assert.equal(s.calls.size,0);assert.equal(closed,1);
 }finally{await s.close();}
});
test('disabled or incomplete config cannot create a room',async()=>{
 const s=new RealtimeVoiceService({env:{},client:{configured:()=>true}});try{await assert.rejects(s.start('x'),/not_configured/);}finally{await s.close();}
 assert.equal(livekitURL({LIVEKIT_URL:'ws://public.example'}),null);assert.equal(livekitURL({LIVEKIT_URL:'wss://key:secret@foo'}),null);
});
test('Hermes adapter follows original session client and handles sequence zero',async()=>{
 const seen=[];const client={submit:async(id,text)=>{seen.push({id,text});return 'run_test';},fetch:async()=>new Response('data: '+JSON.stringify({seq:0,event:'message.delta',delta:'你'})+'\n\ndata: '+JSON.stringify({seq:1,event:'run.completed',output:'你好。'})+'\n\n',{headers:{'Content-Type':'text/event-stream'}})};
 let output='';await new HermesVoiceAdapter({client}).reply('你好',{signal:new AbortController().signal,onDelta:d=>output+=d});assert.equal(output,'你好。');assert.match(seen[0].id,/^voice-/);assert.equal(seen[0].text,'你好');
});
test('hangup while admission pending stops exact native run after admission resolves',async()=>{
 let resolve;const admission=new Promise(r=>resolve=r),calls=[];const c=new AbortController();
 const client={submit:()=>admission,json:async(route,o)=>{calls.push([route,o.method]);return {status:'cancelled'};}};
 const p=new HermesVoiceAdapter({client}).reply('你好',{signal:c.signal,onDelta:()=>assert.fail()});c.abort();resolve('run_owned');await assert.rejects(p,{name:'AbortError'});assert.deepEqual(calls,[['/v1/runs/run_owned/stop','POST'],['/v1/runs/run_owned',undefined]]);
});
test('barge-in cancels native work on speech onset before silence boundary',async()=>{
 let receive,aborted=false,clear=0,started;const gate=new Promise(r=>started=r);
 const worker=new VoiceRoomWorker({pcmFrames:true,participant:{join:async()=>{},onAudio:fn=>{receive=fn;return()=>{};},publishAudio:async()=>{},clearPlayback:async()=>clear++,leave:async()=>{}},asr:{transcribe:async()=> '你好'},hermes:{reply:async(_,{signal})=>{started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}},tts:{speak:async()=>{}}});
 await worker.start();for(let i=0;i<20;i++)receive(new Int16Array(320).fill(9000));for(let i=0;i<33;i++)receive(new Int16Array(320));await gate;receive(new Int16Array(320).fill(9000));await new Promise(r=>setImmediate(r));assert.equal(aborted,true);assert.ok(clear>=2);assert.equal(worker.closed,false);await worker.close();
});
test('publish failure closes worker without an unhandled rejection',async()=>{
 let receive;const worker=new VoiceRoomWorker({participant:{join:async()=>{},onAudio:fn=>{receive=fn;return()=>{};},publishAudio:async()=>{throw Error('offline');},clearPlayback:async()=>{},leave:async()=>{}},asr:{transcribe:async()=> '你好'},hermes:{reply:async(_,{onDelta})=>onDelta('你好。')},tts:{speak:async(_,{onAudio})=>await onAudio({})}});
 await worker.start();receive(Buffer.from('x'));for(let i=0;i<20&&!worker.closed;i++)await new Promise(r=>setImmediate(r));assert.equal(worker.closed,true);
});
