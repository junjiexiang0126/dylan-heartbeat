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
 interrupt(){
  if(this.session.closed)return;
  this.session.generation++;for(const key of [...this.controllers.keys()])this.cancel(key);
  this.session.phase="listening";this.session.emit("assistant.interrupted");
 }
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
  if(!audio||(audio.pcm instanceof Int16Array ? audio.pcm.length===0 : !audio.byteLength)){this.session.finishSpeech(token,false);return {status:'silence'};}
  let text;
  try{text=await this.invoke('asr',signal=>this.adapters.asr.transcribe(audio,{signal}));}
  catch(e){if(e.name==='AbortError'||this.session.closed)return {status:'cancelled'};throw e;}
  if(token!==this.session.generation||!text?.trim()||!this.session.finishSpeech(token,true))return {status:'ignored'};
  this.session.emit('user.transcript',{text});
  const chunks=[];let answer='';let pending='';let speaking=Promise.resolve();let speechError;
  const enqueue=sentence=>{const chars=[...sentence];for(let i=0;i<chars.length;i+=240){const part=chars.slice(i,i+240).join('');speaking=speaking.then(()=>{if(!speechError)return this.speakSentence(part,token,chunks);}).catch(e=>{speechError=e;this.cancel('llm');});}};
  try{
   await this.invoke('llm',signal=>this.adapters.hermes.reply(text,{signal,onDelta:delta=>{
    if(!signal.aborted&&token===this.session.generation&&typeof delta==='string') {
     this.session.emit('assistant.delta',{delta});answer+=delta;pending+=delta;if(answer.length>8000)throw Error('voice_reply_limit');
     let boundary;
     while((boundary=pending.search(/[。！？!?；;\n]/))>=0){
      const sentence=pending.slice(0,boundary+1);pending=pending.slice(boundary+1);
      enqueue(sentence);
     }
    }
    while(pending.length>=240){enqueue(pending.slice(0,240));pending=pending.slice(240);}
   }}));
   if(token!==this.session.generation||this.session.closed){await speaking;return {status:'interrupted'};}
   if(pending.trim())enqueue(pending);
   await speaking;if(speechError)throw speechError;
   if(token!==this.session.generation||this.session.closed){await speaking;return {status:'interrupted'};}
   this.session.assistantDone(token);
   return {status:'completed',text,answer:chunks.join('')};
  }catch(e){this.cancel('tts');await speaking;if(token!==this.session.generation||this.session.closed)return {status:'interrupted'};if(speechError)throw speechError;if(e.name==='AbortError')return {status:'interrupted'};throw e;}
 }
 async speakSentence(text,token,chunks){
  if(token!==this.session.generation||this.session.closed||!text.trim())return;
  await this.invoke('tts',signal=>this.adapters.tts.speak(text,{signal,onAudio:async frame=>{
   if(!signal.aborted&&token===this.session.generation){
    this.session.assistantAudio(token);await this.onAudio(frame);
   }
  }}));
  if(token===this.session.generation)chunks.push(text);
 }
 hangup(){this.session.hangup();for(const key of [...this.controllers.keys()])this.cancel(key);}
}
module.exports={RealtimeVoiceBridge};
