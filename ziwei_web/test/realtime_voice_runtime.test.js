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
 await worker.start();for(let i=0;i<20;i++)receive(new Int16Array(320).fill(9000));for(let i=0;i<33;i++)receive(new Int16Array(320));await gate;for(let i=0;i<3;i++)receive(new Int16Array(320).fill(9000));await new Promise(r=>setImmediate(r));assert.equal(aborted,true);assert.ok(clear>=2);assert.equal(worker.closed,false);await worker.close();
});
test('publish failure closes worker without an unhandled rejection',async()=>{
 let receive;const worker=new VoiceRoomWorker({participant:{join:async()=>{},onAudio:fn=>{receive=fn;return()=>{};},publishAudio:async()=>{throw Error('offline');},clearPlayback:async()=>{},leave:async()=>{}},asr:{transcribe:async()=> '你好'},hermes:{reply:async(_,{onDelta})=>onDelta('你好。')},tts:{speak:async(_,{onAudio})=>await onAudio({})}});
 await worker.start();receive(Buffer.from('x'));for(let i=0;i<20&&!worker.closed;i++)await new Promise(r=>setImmediate(r));assert.equal(worker.closed,true);
});
test('real HermesClient wire contract preserves native Web session and stores no new persona',async()=>{
 const {fakeHermes}=require('./helpers/fake_hermes'),{HermesClient}=require('../hermes_client');
 const fixture=fakeHermes({delay:40,interim:false});await new Promise(r=>fixture.server.listen(0,'127.0.0.1',r));
 try{const client=new HermesClient({NODE_ENV:'test',ZIWEI_BRIDGE_ENABLED:'true',ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS:'true',ZIWEI_HERMES_URL:'http://127.0.0.1:'+fixture.server.address().port,ZIWEI_HERMES_API_KEY:'protocol-fixture-key',ZIWEI_HERMES_WEB_SESSION_ID:'existing-web-session'});
  let output='';await new HermesVoiceAdapter({client}).reply('真实协议测试',{signal:new AbortController().signal,onDelta:d=>output+=d});
  assert.equal(output,'协议测试回复');assert.equal(fixture.executions,1);const run=[...fixture.runs.values()][0];assert.deepEqual(JSON.parse(run.body),{input:'真实协议测试',session_id:'existing-web-session'});assert.ok(fixture.seen.every(r=>r.sessionKey==='agent:main:web:existing-web-session'));
 }finally{fixture.server.closeAllConnections();await new Promise(r=>fixture.server.close(r));}
});

test('queued utterance during drain is processed without requiring another microphone event',async()=>{
 let receive,releaseDrain,drains=0;const drained=new Promise(resolve=>{releaseDrain=resolve;});
 const transcripts=[];
 const worker=new VoiceRoomWorker({
  participant:{join:async()=>{},onAudio:fn=>{receive=fn;return()=>{};},publishAudio:async()=>{},clearPlayback:async()=>{},leave:async()=>{},drain:async()=>{drains++;if(drains===1)await drained;}},
  asr:{transcribe:async audio=>{transcripts.push(audio.toString());return '你好';}},
  hermes:{reply:async(_,{onDelta})=>onDelta('好的。')},
  tts:{speak:async()=>{}}
 });
 try{
  await worker.start();receive(Buffer.from('first'));
  for(let i=0;i<20&&drains===0;i++)await new Promise(r=>setImmediate(r));
  assert.equal(drains,1);
  receive(Buffer.from('second'));releaseDrain();
  for(let i=0;i<30&&transcripts.length<2;i++)await new Promise(r=>setImmediate(r));
  assert.deepEqual(transcripts,['first','second']);
  assert.equal(worker.closed,false);
 }finally{releaseDrain();await worker.close();}
});
test('timed-out LiveKit join releases admission and closes a late successful join',async()=>{
 let finishJoin,closeCount=0,started=false;
 const gate=new Promise(resolve=>{finishJoin=resolve;});
 const s=new RealtimeVoiceService({env,client:{configured:()=>true},joinTimeoutMs:15,
  createWorker:async()=>({start:async()=>{started=true;await gate;},close:async()=>{closeCount++;},setMuted:()=>{}})});
 try{
  await assert.rejects(s.start('owner'),/voice_join_timeout/);
  assert.equal(started,true);assert.equal(s.calls.size,0);
  assert.ok(closeCount>=1,'timeout must close the worker');
  finishJoin();for(let i=0;i<20&&closeCount<2;i++)await new Promise(r=>setImmediate(r));
  assert.ok(closeCount>=2,'late join must be closed again');
  assert.equal(s.calls.size,0);
 }finally{finishJoin();await s.close();}
});

test('empty ASR transcript returns session to listening without calling Hermes',async()=>{
 const {RealtimeVoiceBridge}=require('../realtime_voice/bridge');
 let replies=0;const bridge=new RealtimeVoiceBridge({asr:{transcribe:async()=> '   '},hermes:{reply:async()=>{replies++;}},tts:{speak:async()=>{}}});
 bridge.start();const result=await bridge.utterance(Buffer.from('audio'));
 assert.equal(result.status,'silence');assert.equal(bridge.session.phase,'listening');assert.equal(replies,0);
});
