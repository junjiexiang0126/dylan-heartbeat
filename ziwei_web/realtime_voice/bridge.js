'use strict';
const {RealtimeCallSession}=require('./session');
const {parse}=require('../chat_presentation');
// Provider-neutral orchestration; no paid calls without explicitly supplied adapters.
// adapters: asr.transcribe(audio,{signal}), hermes.reply(text,{signal,onDelta}),
// tts.speak(text,{signal,onAudio}). A production transport handles LiveKit/WebRTC.
class RealtimeVoiceBridge {
 constructor({asr,hermes,tts,onEvent=()=>{},onAudio=()=>{},firstPhraseDelayMs=450,now=()=>performance.now()}={}) {
  if(!asr?.transcribe||!hermes?.reply||!tts?.speak)throw Error('voice_adapters_required');
  this.adapters={asr,hermes,tts};this.onAudio=onAudio;this.controllers=new Map();
  this.firstPhraseDelayMs=firstPhraseDelayMs;this.now=now;
  this.session=new RealtimeCallSession({onEvent,onCancel:type=>this.cancel(type)});
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
  const started=this.now(),timing={};
  const mark=name=>{if(timing[name]===undefined)timing[name]=Math.round(this.now()-started);};
  const token=this.session.beginSpeech();
  if(token===null)return {status:'ignored'};
  if(!audio||(audio.pcm instanceof Int16Array ? audio.pcm.length===0 : !audio.byteLength)){this.session.finishSpeech(token,false);return {status:'silence'};}
  let text;
  try{text=await this.invoke('asr',signal=>this.adapters.asr.transcribe(audio,{signal}));}
  catch(e){if(e.name==='AbortError'||this.session.closed){if(token===this.session.generation&&!this.session.closed)this.session.finishSpeech(token,false);return {status:'cancelled'};}throw e;}
  if(token!==this.session.generation)return {status:'ignored'};
  if(!text?.trim()){this.session.finishSpeech(token,false);return {status:'silence'};}
  if(!this.session.finishSpeech(token,true))return {status:'ignored'};
  mark('asrMs');
  this.session.emit('user.transcript',{text});
  const chunks=[];let answer='',pending='',format=null,speaking=Promise.resolve(),speechError;
  let firstQueued=false,firstAt=null,timer=null,ttsRequests=0,status='failed',stopped=false;
  const clearTimer=()=>{clearTimeout(timer);timer=null;};
  const active=()=>!stopped&&token===this.session.generation&&!this.session.closed&&!speechError;
  const enqueue=sentence=>{
   if(!sentence.trim())return;
   firstQueued=true;clearTimer();
   const chars=[...sentence];
   for(let i=0;i<chars.length;i+=240){
    const part=chars.slice(i,i+240).join('');
    speaking=speaking.then(()=>{
     if(!active())return;
     ttsRequests++;mark('firstTtsMs');
     return this.speakSentence(part,token,chunks,mark);
    }).catch(e=>{speechError=e;clearTimer();this.cancel('llm');});
   }
  };
  // Only the first phrase uses a short buffer. Later phrases retain sentence
  // boundaries, so normal speech does not become a series of tiny TTS requests.
  const flushFirst=()=>{
   if(firstQueued||!active()||format!=='plain')return;
   const cjk=/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(pending);
   if([...pending.trim()].length<(cjk?12:32))return;
   const chars=[...pending];let cut=Math.min(chars.length,40);
   // Keep Latin words and trailing UTF-16 surrogate pairs intact.
   if(!cjk){const prefix=chars.slice(0,cut).join('');const space=prefix.lastIndexOf(' ');if(space<12)return;cut=[...prefix.slice(0,space+1)].length;}
   const phrase=chars.slice(0,cut).join('');pending=chars.slice(cut).join('');enqueue(phrase);
  };
  const feed=delta=>{
   pending+=delta;
   if(!firstQueued){
    const clause=/[，,、：:—]/g;let match;
    const hard=pending.search(/[。！？!?；;\n]|\.(?=\s)/);
    while((match=clause.exec(pending))){if(hard>=0&&match.index>hard)break;if(pending.slice(0,match.index).trim().length>=6){const phrase=pending.slice(0,match.index+1);pending=pending.slice(match.index+1);enqueue(phrase);break;}}
   }
   let boundary;
   while((boundary=pending.search(/[。！？!?；;\n]|\.(?=\s)/))>=0){
    const sentence=pending.slice(0,boundary+1);pending=pending.slice(boundary+1);enqueue(sentence);
   }
   while([...pending].length>=240){const chars=[...pending];enqueue(chars.slice(0,240).join(''));pending=chars.slice(240).join('');}
   if(!firstQueued&&!timer){
    const remaining=this.firstPhraseDelayMs-(this.now()-firstAt);
    if(remaining<=0)flushFirst();
    else timer=setTimeout(()=>{timer=null;flushFirst();},remaining);
   }
  };
  try{
   await this.invoke('llm',async signal=>{
    signal.addEventListener('abort',clearTimer,{once:true});
    try{await this.adapters.hermes.reply(text,{signal,onDelta:delta=>{
    if(!signal.aborted&&token===this.session.generation&&typeof delta==='string') {
     answer+=delta;if(answer.length>8000)throw Error('voice_reply_limit');
     if(!format&&answer.trim()){
      // A structured reply may contain public notes or other metadata. Never
      // send its raw JSON/code fence to either speech or the transcript UI.
      format=/^[{\[`<]/.test(answer.trimStart())?'structured':'plain';
      if(format==='plain'){mark('firstTextMs');firstAt=this.now();this.session.emit('assistant.delta',{delta:answer});feed(answer);}
     }else if(format==='plain'){this.session.emit('assistant.delta',{delta});feed(delta);}
    }
   }});}finally{signal.removeEventListener('abort',clearTimer);clearTimer();}
   });
   mark('llmDoneMs');
   if(token!==this.session.generation||this.session.closed){await speaking;status='interrupted';return {status};}
   if(format==='structured'){
    const visible=parse(answer);
    if(!visible.structured)throw Error('voice_reply_format');
    const delta=visible.messages.join('\n');mark('firstTextMs');this.session.emit('assistant.delta',{delta});pending=delta;
   }
   if(pending.trim())enqueue(pending);
   await speaking;if(speechError)throw speechError;
   if(token!==this.session.generation||this.session.closed){await speaking;status='interrupted';return {status};}
   this.session.assistantDone(token);
   status='completed';return {status,text,answer:chunks.join('')};
  }catch(e){stopped=true;clearTimer();this.cancel('tts');await speaking;if(token!==this.session.generation||this.session.closed){status='interrupted';return {status};}if(speechError)throw speechError;if(e.name==='AbortError'){status='interrupted';return {status};}throw e;}
  finally{clearTimer();mark('totalMs');this.session.emit('assistant.latency',{...timing,ttsRequests,status,structured:format==='structured'});}
 }
 async speakSentence(text,token,chunks,mark=()=>{}){
  if(token!==this.session.generation||this.session.closed||!text.trim())return;
  await this.invoke('tts',signal=>this.adapters.tts.speak(text,{signal,onAudio:async frame=>{
   if(!signal.aborted&&token===this.session.generation){
    mark('firstPcmMs');this.session.assistantAudio(token);await this.onAudio(frame);mark('firstPublishMs');
   }
  }}));
  if(token===this.session.generation)chunks.push(text);
 }
 hangup(){this.session.hangup();for(const key of [...this.controllers.keys()])this.cancel(key);}
}
module.exports={RealtimeVoiceBridge};
