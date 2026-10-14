'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
class VoiceTranscriber {
 constructor(env=process.env){this.python=env.ZIWEI_VOICE_PYTHON||'/opt/voice-env/bin/python';this.model=env.ZIWEI_VOICE_MODEL_PATH||'/opt/voice-model';this.runner=env.NODE_ENV==='test'&&env.ZIWEI_VOICE_TEST_RUNNER||path.join(__dirname,'voice_transcribe.py');}
 available(){return fs.existsSync(this.python)&&fs.existsSync(this.model);}
 transcribe(file){
  if(!this.available())return Promise.reject(Error('voice_transcription_unavailable'));
  return new Promise((resolve,reject)=>{
   const child=spawn(this.python,[this.runner,file,this.model],{stdio:['ignore','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',OMP_NUM_THREADS:'1'}});
   let output='',ended=false;const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('voice_transcription_timeout'));},120000);
   function finish(error,value){if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve(value);}
   child.stdout.on('data',c=>{output+=c;if(Buffer.byteLength(output)>65536){child.kill('SIGKILL');finish(Error('voice_transcription_limit'));}});
   // Consume diagnostic output without logging recordings, transcripts or secrets.
   child.stderr.on('data',()=>{});child.on('error',()=>finish(Error('voice_transcription_unavailable')));
   child.on('close',code=>{if(ended)return;try{const o=JSON.parse(output);if(code||o.error)throw Error(['voice_too_long','voice_empty'].includes(o.error)?o.error:'voice_transcription_failed');if(typeof o.text!=='string'||!o.text.trim()||o.text.length>10000)throw Error('voice_empty');finish(null,o.text.trim());}catch(e){finish(Error(/^[a-z_]+$/.test(e.message)?e.message:'voice_transcription_failed'));}});
  });
 }
}
module.exports={VoiceTranscriber};
