'use strict';
const {RealtimeCallSession}=require('./session');
// Provider-neutral orchestration; no paid calls without explicitly supplied adapters.
// adapters: asr.transcribe(audio,{signal}), hermes.reply(text,{signal,onDelta}),
// tts.speak(text,{signal,onAudio}). A production transport handles LiveKit/WebRTC.
class RealtimeVoiceBridge {
 constructor({asr,hermes,tts,onEvent=()=>{},onAudio=()=>{},maxTurns=60}={}) {
  if(!asr?.transcribe||!hermes?.reply||!tts?.speak)throw Error('voice_adapters_required');
  this.adapters={asr,hermes,tts};this.onAudio=onAudio;this.controllers=new Map();
  this.session=new RealtimeCallSession({maxTurns,onEvent,onCancel:type=>this.cancel(type)});
 }
 start(){return this.session.start();}
 mute(value){return this.session.setMuted(value);}
 cancel(type){const controller=this.controllers.get(type);if(controller){controller.abort();this.controllers.delete(type);}}
 async invoke(type,callback){
  this.cancel(type);const controller=new AbortController();this.controllers.set(type,controller);
  try{return await callback(controller.signal);}
  finally{if(this.controllers.get(type)===controller)this.controllers.delete(type);}
 }
 async utterance(audio){
  const token=this.session.beginSpeech();
  if(token===null)return {status:'ignored'};
  if(!audio||!audio.byteLength){this.session.finishSpeech(token,false);return {status:'silence'};}
  let text;
  try{text=await this.invoke('asr',signal=>this.adapters.asr.transcribe(audio,{signal}));}
  catch(e){if(e.name==='AbortError'||this.session.closed)return {status:'cancelled'};throw e;}
  if(!text?.trim()||!this.session.finishSpeech(token,true))return {status:'ignored'};
  const chunks=[];let answer='';
  try{
   await this.invoke('llm',signal=>this.adapters.hermes.reply(text,{signal,onDelta:delta=>{
    if(!signal.aborted&&token===this.session.generation&&typeof delta==='string')answer+=delta;
   }}));
   if(token!==this.session.generation||this.session.closed)return {status:'interrupted'};
   // Sentence-level incremental TTS; providers may stream PCM frames via onAudio.
   const parts=answer.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g)||[];
   for(const part of parts){
    if(token!==this.session.generation||this.session.closed)return {status:'interrupted'};
    if(!part.trim())continue;
    await this.invoke('tts',signal=>this.adapters.tts.speak(part,{signal,onAudio:frame=>{
     if(!signal.aborted&&token===this.session.generation){
      this.session.assistantAudio(token);this.onAudio(frame);
     }
    }}));
    chunks.push(part);
   }
   this.session.assistantDone(token);
   return {status:'completed',text,answer:chunks.join('')};
  }catch(e){if(e.name==='AbortError'||token!==this.session.generation)return {status:'interrupted'};throw e;}
 }
 hangup(){this.session.hangup();for(const key of [...this.controllers.keys()])this.cancel(key);}
}
module.exports={RealtimeVoiceBridge};
