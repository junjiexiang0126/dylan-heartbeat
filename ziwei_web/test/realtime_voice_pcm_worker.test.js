'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {VoiceRoomWorker}=require('../realtime_voice/room_worker');
test('decoded PCM frames pass through speech framer before ASR',async()=>{
 let receiver;const asrPayloads=[],published=[];
 const participant={
  async join(){},onAudio(fn){receiver=fn;return ()=>{};},
  async publishAudio(frame){published.push(frame);},
  async clearPlayback(){},async leave(){}
 };
 const worker=new VoiceRoomWorker({participant,pcmFrames:true,
  asr:{async transcribe(audio){asrPayloads.push(audio);return '你好';}},
  hermes:{async reply(_,{onDelta}){onDelta('听到了。');}},
  tts:{async speak(text,{onAudio}){onAudio({text});}}
 });
 await worker.start();
 const speech=new Int16Array(320).fill(9000),silence=new Int16Array(320);
 for(let i=0;i<20;i++)receiver(speech);
 for(let i=0;i<33;i++)receiver(silence);
 for(let i=0;i<40&&!published.length;i++)await new Promise(r=>setImmediate(r));
 assert.equal(asrPayloads.length,1);
 assert.equal(asrPayloads[0].sampleRate,16000);
 assert.ok(asrPayloads[0].pcm instanceof Int16Array);
 assert.equal(published[0].text,'听到了。');
 await worker.close();
});
test('mute drops partial PCM utterance before ASR',async()=>{
 let receiver,asrCount=0;
 const participant={async join(){},onAudio(fn){receiver=fn;return ()=>{};},
  async publishAudio(){},async clearPlayback(){},async leave(){}};
 const worker=new VoiceRoomWorker({participant,pcmFrames:true,
  asr:{async transcribe(){asrCount++;return 'hello';}},
  hermes:{async reply(){}},tts:{async speak(){}}
 });
 await worker.start();
 for(let i=0;i<20;i++)receiver(new Int16Array(320).fill(9000));
 worker.setMuted(true);
 for(let i=0;i<50;i++)receiver(new Int16Array(320).fill(9000));
 worker.setMuted(false);
 for(let i=0;i<33;i++)receiver(new Int16Array(320));
 await new Promise(r=>setImmediate(r));
 assert.equal(asrCount,0);await worker.close();
});
