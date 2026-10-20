'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ZhipuASR,MiniMaxTTS,VoiceQuota}=require('../realtime_voice/providers');
const {PcmFrames,decodePCM,wav}=require('../realtime_voice/pcm');
const audio={pcm:new Int16Array(320).fill(-1234),sampleRate:16000,channels:1};
const sse=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
test('ASR sends valid PCM WAV multipart using the official contract',async()=>{
 const a=new ZhipuASR({apiKey:'test',fetchImpl:async(url,o)=>{
  assert.equal(url,'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions');assert.equal(o.headers.Authorization,'Bearer test');assert.equal(o.headers['Content-Type'],undefined);
  assert.equal(o.body.get('model'),'glm-asr-2512');assert.equal(o.body.get('stream'),'false');
  const b=Buffer.from(await o.body.get('file').arrayBuffer());assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(24),16000);assert.equal(b.readInt16LE(44),-1234);
  return Response.json({text:'你好'});
 }});assert.equal(await a.transcribe(audio),'你好');
});
test('provider calls fail before network without keys or after cancellation',async()=>{
 let n=0;const fetchImpl=async()=>{n++;};
 await assert.rejects(new ZhipuASR({fetchImpl}).transcribe(audio),/not_configured/);
 const c=new AbortController();c.abort();await assert.rejects(new ZhipuASR({apiKey:'test',fetchImpl}).transcribe(audio,{signal:c.signal}),{name:'AbortError'});assert.equal(n,0);
});
test('MiniMax streams frame-aligned LE PCM and excludes aggregate replay',async()=>{
 const b=Buffer.alloc(1282);for(let i=0;i<b.length;i+=2)b.writeInt16LE(3210,i);
 const frames=[];const t=new MiniMaxTTS({apiKey:'test',voiceId:'test-voice',fetchImpl:async(_url,o)=>{
  const body=JSON.parse(o.body);assert.equal(body.model,'speech-2.8-turbo');assert.equal(body.audio_setting.format,'pcm');assert.equal(body.stream_options.exclude_aggregated_audio,true);
  return sse([{data:{audio:b.subarray(0,501).toString('hex'),status:1}},{data:{audio:b.subarray(501).toString('hex'),status:1}},{data:{status:2,audio:b.toString('hex')},base_resp:{status_code:0}}]);
 }});await t.speak('你好。',{onAudio:async f=>{frames.push(f);}});assert.equal(frames.length,3);assert.equal(frames[0].pcm[0],3210);assert.equal(frames[2].pcm[0],3210);assert.equal(frames[2].pcm[1],0);
});
test('MiniMax errors, truncated responses and invalid hex fail closed',async()=>{
 for(const events of [[{base_resp:{status_code:1008}}],[{data:{status:1,audio:'00'}}],[{data:{status:1,audio:'xz'}}]]){
  const t=new MiniMaxTTS({apiKey:'test',voiceId:'test',fetchImpl:async()=>sse(events)});await assert.rejects(t.speak('测试',{onAudio:async()=>{}}),/voice_tts_/);
 }
});
test('usage quotas reject additional submissions before fetch',async()=>{
 const quota=new VoiceQuota({maxASRSeconds:.02,maxTTSCharacters:2});let n=0;
 const a=new ZhipuASR({apiKey:'test',quota,fetchImpl:async()=>{n++;return Response.json({text:'好'});}});
 await a.transcribe(audio);await assert.rejects(a.transcribe(audio),/usage_limit/);assert.equal(n,1);quota.tts('你好');assert.throws(()=>quota.tts('呀'),/usage_limit/);
});
test('PCM tail is bounded, flush padded, invalid data rejected',()=>{
 const f=new PcmFrames();assert.equal(f.push(new Int16Array(319)).length,0);assert.equal(f.push(new Int16Array(2)).length,1);assert.equal(f.tail.length,1);assert.equal(f.flush().length,1);assert.equal(f.tail.length,0);
 assert.throws(()=>decodePCM(Buffer.alloc(3)),/truncated/);assert.throws(()=>wav({...audio,sampleRate:48000}),/format/);
});
test('installed native LiveKit resampler converts actual 48 kHz PCM to 16 kHz',async()=>{
 const rtc=require('@livekit/rtc-node');const resampler=new rtc.AudioResampler(48000,16000,1,rtc.AudioResamplerQuality.HIGH);
 try{const pcm=new Int16Array(48000);for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(9000*Math.sin(2*Math.PI*440*i/48000));
  const frames=[...resampler.push(new rtc.AudioFrame(pcm,48000,1,48000)),...resampler.flush()];
  assert.equal(frames.reduce((n,f)=>n+f.data.length,0),16000);assert.ok(frames.every(f=>f.sampleRate===16000&&f.channels===1));
 }finally{resampler.close();await rtc.dispose();}
});

test('MiniMax rejects a truncated final SSE completion instead of reporting success',async()=>{
 const pcm=Buffer.alloc(640);pcm.writeInt16LE(1234,0);
 const events='data: '+JSON.stringify({data:{status:1,audio:pcm.toString('hex')}})+'\n\n'+'data: '+JSON.stringify({data:{status:2}});
 const received=[];
 const t=new MiniMaxTTS({apiKey:'test',voiceId:'test',fetchImpl:async()=>new Response(events)});
 await assert.rejects(t.speak('尾音',{onAudio:async frame=>received.push(frame.pcm)}),/voice_tts_incomplete/);
 assert.equal(received.length,1);assert.equal(received[0][0],1234);
});
