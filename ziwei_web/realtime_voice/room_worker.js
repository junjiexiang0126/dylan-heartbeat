'use strict';
const {RealtimeVoiceBridge}=require('./bridge');
const {PcmSpeechFramer}=require('./pcm_framer');

// Room worker lifecycle: transport-independent boundary for a future official
// LiveKit server-side participant. The injected participant must implement:
// join(), onAudio(handler), publishAudio(frame), clearPlayback(), leave().
// It must emit *framed* speech, not arbitrary PCM packets, to onAudio().
class VoiceRoomWorker {
 constructor({participant,asr,hermes,tts,onEvent=()=>{},maxTurns=60,pcmFrames=false}={}){
  if(!participant||!['join','onAudio','publishAudio','clearPlayback','leave'].every(k=>typeof participant[k]==='function'))
   throw Error('voice_participant_required');
  this.participant=participant;this.started=false;this.closed=false;this.inflight=new Set();
  this.framer=pcmFrames?new PcmSpeechFramer({onSpeech:audio=>this.queueUtterance(audio)}):null;
  this.bridge=new RealtimeVoiceBridge({asr,hermes,tts,maxTurns,
   onEvent:e=>{if(e.type==='assistant.interrupted')void this.clearPlayback();onEvent(e);},
   onAudio:frame=>{if(!this.closed)void this.publish(frame);}
  });
 }
 async start(){
  if(this.closed||this.started)throw Error('voice_worker_already_started');
  this.started=true;
  try{
   await this.participant.join();
   if(this.closed)return;
   this.bridge.start();
   this.unsubscribe=this.participant.onAudio(audio=>{
    if(this.closed)return;
    if(this.framer){this.framer.push(audio);return;}
    this.queueUtterance(audio);
   });
  }catch(e){await this.close();throw e;}
 }
 queueUtterance(audio){
  if(this.closed)return;
  const task=Promise.resolve().then(()=>this.bridge.utterance(audio));
  this.inflight.add(task);task.catch(()=>{}).finally(()=>this.inflight.delete(task));
 }
 setMuted(value){this.framer?.setMuted(value);return this.bridge.mute(value);}
 async publish(frame){
  try{await this.participant.publishAudio(frame);}
  catch(e){if(!this.closed)await this.close();throw e;}
 }
 async clearPlayback(){if(!this.closed)await this.participant.clearPlayback();}
 async close(){
  if(this.closed)return;
  this.closed=true;this.framer?.close();this.bridge.hangup();
  try{this.unsubscribe?.();}finally{await this.participant.leave();}
 }
}
module.exports={VoiceRoomWorker};
