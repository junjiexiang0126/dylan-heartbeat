'use strict';
const {RealtimeVoiceBridge}=require('./bridge');
const {PcmSpeechFramer}=require('./pcm_framer');
class VoiceRoomWorker {
 constructor({participant,asr,hermes,tts,onEvent=()=>{},maxTurns=20,pcmFrames=false}={}){
  if(!participant||!['join','onAudio','publishAudio','clearPlayback','leave'].every(k=>typeof participant[k]==='function'))throw Error('voice_participant_required');
  this.participant=participant;this.onEvent=onEvent;this.started=false;this.closed=false;this.inflight=new Set();
  this.bridge=new RealtimeVoiceBridge({asr,hermes,tts,maxTurns,onEvent:e=>{onEvent(e);},onAudio:frame=>this.publish(frame)});
  this.framer=pcmFrames?new PcmSpeechFramer({onSpeechStart:()=>this.interrupt(),onSpeech:audio=>this.queueUtterance(audio)}):null;
 }
 interrupt(){this.pending=null;this.bridge.interrupt();void this.clearPlayback().catch(()=>this.fail('voice_playback_failed'));}
 async start(){
  if(this.closed||this.started)throw Error('voice_worker_already_started');this.started=true;
  try{await this.participant.join();if(this.closed)return;this.bridge.start();this.unsubscribe=this.participant.onAudio(audio=>{
   if(this.closed)return;try{if(this.framer)this.framer.push(audio);else this.queueUtterance(audio);}catch{void this.fail('voice_input_failed');}
  });}catch(e){await this.close();throw e;}
 }
 queueUtterance(audio){
  if(this.closed||this.bridge.session.muted)return;
  this.pending=audio;if(this.running){this.bridge.interrupt();return;}
  this.running=true;
  const task=(async()=>{while(this.pending&&!this.closed){const next=this.pending;this.pending=null;await this.bridge.utterance(next);await this.participant.drain?.();}})();
  this.inflight.add(task);task.catch(()=>this.fail('voice_turn_failed')).finally(()=>{this.inflight.delete(task);this.running=false;if(this.pending&&!this.closed)queueMicrotask(()=>{if(this.pending&&!this.closed&&!this.running){const next=this.pending;this.pending=null;this.queueUtterance(next);}});}).catch(()=>{});
 }
 setMuted(value){if(value)this.pending=null;this.framer?.setMuted(value);return this.bridge.mute(value);}
 async publish(frame){if(!this.closed)await this.participant.publishAudio(frame);}
 async clearPlayback(){if(!this.closed)await this.participant.clearPlayback();}
 async fail(code){if(this.closed)return;this.onEvent({type:'call.error',code});await this.close();}
 async close(){
  if(this.closing)return this.closing;this.closed=true;this.pending=null;this.framer?.close();this.bridge.hangup();this.unsubscribe?.();
  this.closing=this.participant.leave();return this.closing;
 }
}
module.exports={VoiceRoomWorker};
