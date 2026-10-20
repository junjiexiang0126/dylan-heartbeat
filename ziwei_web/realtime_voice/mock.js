'use strict';
const {RealtimeVoiceBridge}=require('./bridge');
// Deterministic offline providers: never call external APIs or access credentials.
function createMockVoiceBridge({onEvent=()=>{},onAudio=()=>{}}={}) {
 return new RealtimeVoiceBridge({
  onEvent,onAudio,
  asr:{async transcribe(audio,{signal}){if(signal.aborted)throw signal.reason;return audio.byteLength?'你好，知微':'';
  }},
  hermes:{async reply(text,{signal,onDelta}){if(signal.aborted)throw signal.reason;onDelta('我听到了。');onDelta('这是不调用付费模型的模拟回复。');}},
  tts:{async speak(text,{signal,onAudio}){if(signal.aborted)throw signal.reason;onAudio({mock:true,text,bytes:new Uint8Array(0)});}}
 });
}
module.exports={createMockVoiceBridge};
