'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {VoiceRoomWorker}=require('../realtime_voice/room_worker');
const {createMockVoiceBridge}=require('../realtime_voice/mock');

function fixture(){
 const calls=[];let receiver;
 const participant={
  async join(){calls.push('join');},
  onAudio(fn){receiver=fn;calls.push('subscribe');return ()=>calls.push('unsubscribe');},
  async publishAudio(frame){calls.push(['audio',frame.text]);},
  async clearPlayback(){calls.push('clear');},
  async leave(){calls.push('leave');}
 };
 const worker=new VoiceRoomWorker({
  participant,
  asr:{async transcribe(){return '你好';}},
  hermes:{async reply(_,{onDelta}){onDelta('你好呀。');}},
  tts:{async speak(text,{onAudio}){onAudio({text});}}
 });
 return {worker,calls,send:audio=>receiver(audio)};
}
test('room worker joins, subscribes, publishes speech and closes',async()=>{
 const f=fixture();await f.worker.start();f.send(Buffer.from('mock audio'));
 for(let i=0;i<30&&!f.calls.some(x=>Array.isArray(x)&&x[0]==='audio');i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.calls.slice(0,2),['join','subscribe']);
 assert.ok(f.calls.some(x=>Array.isArray(x)&&x[1]==='你好呀。'));
 await f.worker.close();assert.ok(f.calls.includes('unsubscribe'));assert.ok(f.calls.includes('leave'));
});
test('worker cannot restart or publish after closing',async()=>{
 const f=fixture();await f.worker.start();await f.worker.close();
 await assert.rejects(()=>f.worker.start(),/already_started/);
 f.send(Buffer.from('ignored'));await new Promise(r=>setImmediate(r));
 assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='audio').length,0);
});
