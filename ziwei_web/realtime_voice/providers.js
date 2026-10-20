'use strict';
const {wav,decodePCM,PcmFrames}=require('./pcm');
const {SSEParser}=require('../sse_parser');
async function readJSON(r,limit){
 if(!r.ok){await r.body?.cancel();throw Error('voice_provider_http_'+r.status);}
 let n=0;const chunks=[];for await(const c of r.body){n+=c.length;if(n>limit)throw Error('voice_provider_response_limit');chunks.push(c);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// Quotas are submitted units, not a billing ledger. Aborted requests may still be billed.
class VoiceQuota {
 constructor({maxASRSeconds=300,maxTTSCharacters=4000,maxTurns=20}={}){this.maxASRSeconds=maxASRSeconds;this.maxTTSCharacters=maxTTSCharacters;this.maxTurns=maxTurns;this.seconds=0;this.characters=0;this.turns=0;}
 asr(seconds){if(this.seconds+seconds>this.maxASRSeconds||this.turns>=this.maxTurns)throw Error('voice_usage_limit');this.seconds+=seconds;this.turns++;}
 tts(text){const n=[...text].length;if(this.characters+n>this.maxTTSCharacters)throw Error('voice_usage_limit');this.characters+=n;}
}
class ZhipuASR {
 constructor({apiKey,quota=new VoiceQuota(),fetchImpl=fetch}={}){this.key=apiKey;this.quota=quota;this.fetch=fetchImpl;}
 async transcribe(audio,{signal}={}){
  if(!this.key)throw Error('voice_asr_not_configured');signal?.throwIfAborted();
  const bytes=wav(audio);this.quota.asr(audio.pcm.length/audio.sampleRate);
  const form=new FormData();form.set('model','glm-asr-2512');form.set('stream','false');form.set('file',new Blob([bytes],{type:'audio/wav'}),'speech.wav');
  const deadline=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(30000)]);
  const r=await this.fetch('https://open.bigmodel.cn/api/paas/v4/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+this.key},body:form,signal:deadline,redirect:'error'});
  const data=await readJSON(r,128*1024);deadline.throwIfAborted();if(data.error||typeof data.text!=='string'||data.text.length>10000)throw Error('voice_asr_invalid_response');return data.text;
 }
}
class MiniMaxTTS {
 constructor({apiKey,voiceId,quota=new VoiceQuota(),fetchImpl=fetch,endpoint='https://api.minimax.cn/v1/t2a_v2'}={}){
  if(!['https://api.minimax.cn/v1/t2a_v2','https://api.minimaxi.com/v1/t2a_v2','https://api.minimax.io/v1/t2a_v2'].includes(endpoint))throw Error('voice_tts_endpoint');
  this.key=apiKey;this.voiceId=voiceId;this.quota=quota;this.fetch=fetchImpl;this.endpoint=endpoint;
 }
 async speak(text,{signal,onAudio}={}){
  if(!this.key||!this.voiceId)throw Error('voice_tts_not_configured');signal?.throwIfAborted();
  if(!text.trim())return;if(text.length>1000)throw Error('voice_tts_text_limit');this.quota.tts(text);
  const deadline=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(45000)]);
  const r=await this.fetch(this.endpoint,{method:'POST',redirect:'error',signal:deadline,headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({model:'speech-2.8-turbo',text,stream:true,stream_options:{exclude_aggregated_audio:true},voice_setting:{voice_id:this.voiceId,speed:1,vol:1,pitch:0},audio_setting:{sample_rate:16000,format:'pcm',channel:1}})});
  if(!r.ok){await r.body?.cancel();throw Error('voice_provider_http_'+r.status);}
  const frames=new PcmFrames();let done=false,bytes=0,carry=Buffer.alloc(0);const queue=[];
  const parser=new SSEParser(({data})=>{
   if(!data||typeof data!=='object')return;
   if(data.base_resp&&data.base_resp.status_code!==0)throw Error('voice_tts_rejected');
   // status 2 is completion; aggregated audio is explicitly disabled above.
   if(data.data?.status===2){done=true;return;}
   const hex=data.data?.audio;if(!hex)return;
   if(typeof hex!=='string'||hex.length%2||!/^[0-9a-f]+$/i.test(hex))throw Error('voice_tts_invalid_audio');
   const raw=Buffer.concat([carry,Buffer.from(hex,'hex')]);carry=raw.subarray(raw.length-raw.length%2);
   const pcm=decodePCM(raw.subarray(0,raw.length-raw.length%2));
   for(let i=0;i<pcm.length;i+=32000)queue.push(...frames.push(pcm.subarray(i,i+32000)));
  });
  for await(const chunk of r.body){
   bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('voice_tts_response_limit');parser.feed(chunk);
   if(parser.buffer.length>512*1024)throw Error('voice_tts_event_limit');
   while(queue.length){deadline.throwIfAborted();await onAudio({pcm:queue.shift(),sampleRate:16000,channels:1});}
  }
  parser.end();if(!done||carry.length)throw Error('voice_tts_incomplete');
  while(queue.length){deadline.throwIfAborted();await onAudio({pcm:queue.shift(),sampleRate:16000,channels:1});}
  for(const pcm of frames.flush()){deadline.throwIfAborted();await onAudio({pcm,sampleRate:16000,channels:1});}
 }
}
module.exports={ZhipuASR,MiniMaxTTS,VoiceQuota};
