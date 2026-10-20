'use strict';
// Bounded, deterministic PCM16 mono speech framing for a future LiveKit audio adapter.
// Input must be decoded signed 16-bit PCM, not compressed audio or arbitrary RTP packets.
// The adapter is responsible for resampling to sampleRate and suppressing echo.
class PcmSpeechFramer {
 constructor({sampleRate=16000,frameMs=20,startThreshold=0.025,stopThreshold=0.014,
  minSpeechMs=240,endSilenceMs=650,maxSpeechMs=15000,onSpeechStart=()=>{},onSpeech=()=>{}}={}){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>48000||
   !Number.isInteger(frameMs)||frameMs<10||frameMs>100||
   sampleRate*frameMs%1000!==0)throw Error('invalid_pcm_format');
  this.sampleRate=sampleRate;this.frameMs=frameMs;this.frameSamples=sampleRate*frameMs/1000;
  this.startThreshold=startThreshold;this.stopThreshold=stopThreshold;
  this.minFrames=Math.ceil(minSpeechMs/frameMs);
  this.endFrames=Math.ceil(endSilenceMs/frameMs);
  this.maxFrames=Math.ceil(maxSpeechMs/frameMs);
  this.onSpeechStart=onSpeechStart;this.onSpeech=onSpeech;this.closed=false;this.muted=false;
  this.reset();
 }
 reset(){this.frames=[];this.silence=0;this.active=false;this.preRoll=[];}
 setMuted(value){this.muted=Boolean(value);if(this.muted)this.reset();}
 push(frame){
  if(this.closed||this.muted)return false;
  if(!(frame instanceof Int16Array)||frame.length!==this.frameSamples)throw Error('invalid_pcm_frame');
  const rms=Math.sqrt(frame.reduce((sum,sample)=>sum+(sample/32768)**2,0)/frame.length);
  const speech=rms>=(this.active?this.stopThreshold:this.startThreshold);
  const copy=Int16Array.from(frame);
  if(!this.active){
   this.preRoll.push(copy);if(this.preRoll.length>5)this.preRoll.shift();
   if(!speech)return false;
   this.onSpeechStart();this.active=true;this.frames=this.preRoll.splice(0);this.silence=0;
   return true;
  }
  this.frames.push(copy);
  this.silence=speech?0:this.silence+1;
  if(this.silence>=this.endFrames||this.frames.length>=this.maxFrames)this.flush();
  return true;
 }
 flush(){
  if(!this.active)return false;
  const frames=this.frames,voiced=frames.length-this.silence;
  this.reset();
  if(voiced<this.minFrames)return false;
  const pcm=new Int16Array(frames.reduce((n,f)=>n+f.length,0));
  let offset=0;for(const f of frames){pcm.set(f,offset);offset+=f.length;}
  this.onSpeech({pcm,sampleRate:this.sampleRate,channels:1});
  return true;
 }
 close(){this.closed=true;this.reset();}
}
module.exports={PcmSpeechFramer};
