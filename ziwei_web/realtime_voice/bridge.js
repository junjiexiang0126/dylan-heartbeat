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
  if(token!==this.session.generation||!text?.trim()||!this.session.finishSpeech(token,true))return {status:'ignored'};
  const chunks=[];let answer='';let pending='';let speaking=Promise.resolve();
  try{
   await this.invoke('llm',signal=>this.adapters.hermes.reply(text,{signal,onDelta:delta=>{
    if(!signal.aborted&&token===this.session.generation&&typeof delta==='string') {
     answer+=delta;pending+=delta;
     let boundary;
     while((boundary=pending.search(/[。！？!?；;\n]/))>=0){
      const sentence=pending.slice(0,boundary+1);pending=pending.slice(boundary+1);
      speaking=speaking.then(()=>this.speakSentence(sentence,token,chunks));
     }
    }
   }}));
   if(token!==this.session.generation||this.session.closed)return {status:'interrupted'};
   if(pending.trim())speaking=speaking.then(()=>this.speakSentence(pending,token,chunks));
   await speaking;
   if(token!==this.session.generation||this.session.closed)return {status:'interrupted'};
   this.session.assistantDone(token);
   return {status:'completed',text,answer:chunks.join('')};
  }catch(e){if(e.name==='AbortError'||token!==this.session.generation)return {status:'interrupted'};throw e;}
 }
 async speakSentence(text,token,chunks){
  if(token!==this.session.generation||this.session.closed||!text.trim())return;
  await this.invoke('tts',signal=>this.adapters.tts.speak(text,{signal,onAudio:frame=>{
   if(!signal.aborted&&token===this.session.generation){
    this.session.assistantAudio(token);this.onAudio(frame);
   }
  }}));
  if(token===this.session.generation)chunks.push(text);
 }
 hangup(){this.session.hangup();for(const key of [...this.controllers.keys()])this.cancel(key);}
}
module.exports={RealtimeVoiceBridge};
