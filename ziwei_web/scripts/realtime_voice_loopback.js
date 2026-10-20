'use strict';
// Real WebRTC/Opus transport; synthetic speech and provider fixtures. No paid keys.
const assert=require('node:assert/strict');
const rtc=require('@livekit/rtc-node');
const {AccessToken,TrackSource}=require('livekit-server-sdk');
const {LiveKitParticipant}=require('../realtime_voice/livekit_participant');
const {VoiceRoomWorker}=require('../realtime_voice/room_worker');
const {ZhipuASR,MiniMaxTTS}=require('../realtime_voice/providers');
async function main(){
 const url=process.env.VOICE_TEST_LIVEKIT_URL||'ws://127.0.0.1:7880';
 if(!/^ws:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url))throw Error('loopback_only');
 const room='voice-test-'+Date.now(),user='test-user';
 const token=async identity=>{const t=new AccessToken('devkey','local-test-secret-not-production',{identity,ttl:60});t.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishSources:[TrackSource.MICROPHONE]});return t.toJwt();};
 let asrCalls=0,replyFrames=0,resolveReply,reader;const received=new Promise(r=>resolveReply=r);
 const participant=new LiveKitParticipant({url,token:await token('ziwei-test'),userIdentity:user});
 const worker=new VoiceRoomWorker({participant,pcmFrames:true,
  asr:new ZhipuASR({apiKey:'fixture-only',fetchImpl:async(_url,o)=>{const b=Buffer.from(await o.body.get('file').arrayBuffer());assert.equal(b.readUInt32LE(24),16000);assert.equal(b.readUInt16LE(22),1);assert.ok(b.length>16000);asrCalls++;return Response.json({text:'协议测试'});}}),
  hermes:{reply:async(_,{onDelta})=>onDelta('听到了。')},
  tts:new MiniMaxTTS({apiKey:'fixture-only',voiceId:'fixture',fetchImpl:async()=>{
   const b=Buffer.alloc(16000);for(let i=0;i<8000;i++)b.writeInt16LE(Math.round(9000*Math.sin(i*2*Math.PI*660/16000)),i*2);
   return new Response('data: '+JSON.stringify({data:{status:1,audio:b.toString('hex')}})+'\n\ndata: '+JSON.stringify({data:{status:2},base_resp:{status_code:0}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }})
 });
 const client=new rtc.Room();let source;
 client.on(rtc.RoomEvent.TrackSubscribed,track=>{if(track.kind!==rtc.TrackKind.KIND_AUDIO)return;
  reader=new rtc.AudioStream(track,{sampleRate:48000,numChannels:1,frameSizeMs:20}).getReader();
  void(async()=>{while(true){const {value,done}=await reader.read();if(done)return;const rms=Math.sqrt(value.data.reduce((s,x)=>s+x*x,0)/value.data.length);if(rms>1000&&++replyFrames>=5)resolveReply();}})().catch(()=>{});
 });
 let deadline;
 try{
  await worker.start();await client.connect(url,await token(user),{autoSubscribe:true,dynacast:true});
  // 48 kHz stereo at sender -> Opus/WebRTC -> 16 kHz mono worker -> TTS -> WebRTC 48 kHz.
  source=new rtc.AudioSource(48000,2,100);const track=rtc.LocalAudioTrack.createAudioTrack('user-mic',source);
  const pub=await client.localParticipant.publishTrack(track,new rtc.TrackPublishOptions({source:rtc.TrackSource.SOURCE_MICROPHONE}));
  await pub.waitForSubscription();
  for(let n=0;n<85;n++){
   const data=new Int16Array(960*2);if(n>=10&&n<45)for(let i=0;i<960;i++){const v=Math.round(12000*Math.sin((n*960+i)*2*Math.PI*440/48000));data[2*i]=v;data[2*i+1]=v;}
   await source.captureFrame(new rtc.AudioFrame(data,48000,2,960));
  }
  await source.waitForPlayout();
  await Promise.race([received,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('audio_roundtrip_timeout')),15000);})]);
  assert.equal(asrCalls,1);assert.ok(replyFrames>=5);
  worker.setMuted(true);for(let i=0;i<50;i++)for(const fn of participant.listeners)fn(new Int16Array(320).fill(10000));assert.equal(asrCalls,1);
  console.log(JSON.stringify({livekitAudioRoundtrip:true,input:'48000 Hz stereo',worker:'16000 Hz mono PCM20ms',receivedFrames:replyFrames,asrCalls,providers:'fixtures, not paid-service validation'}));
 }finally{clearTimeout(deadline);await worker.close();await reader?.cancel().catch(()=>{});await client.disconnect();await source?.close();await rtc.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
