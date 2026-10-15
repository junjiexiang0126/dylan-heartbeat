'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class VoiceSynthesizer {
 constructor(files,env=process.env){this.files=files;this.python=env.ZIWEI_VOICE_PYTHON||'/opt/voice-env/bin/python';this.runner=env.NODE_ENV==='test'&&env.ZIWEI_SPEECH_TEST_RUNNER||path.join(__dirname,'voice_synthesize.py');this.pending=new Map();}
 async read(message){
  message={...message,content:message.content.replace(/\[\[audio_as_voice\]\]/g,'').replace(/^\s*MEDIA:.*$/gm,'').trim()};
  if(message.role!=='assistant'||message.status!=='completed'||message.deleted||message.kind==='commentary'||!message.content.trim())throw Error('speech_not_allowed');
  if(message.content.length>30000)throw Error('speech_text_limit');
  const seed=crypto.createHash('sha256').update('read-aloud:'+message.id+':'+message.content).digest('hex');
  const id=seed.slice(0,8)+'-'+seed.slice(8,12)+'-4'+seed.slice(13,16)+'-8'+seed.slice(17,20)+'-'+seed.slice(20,32);
  const existing=this.files.store.attachment(id);if(existing)return existing;
  if(this.pending.has(id))return this.pending.get(id);if(this.pending.size>=2)throw Error('speech_busy');
  const job=this.generate(message.content,id).finally(()=>this.pending.delete(id));this.pending.set(id,job);return job;
 }
 async generate(text,id){
  const file=path.join(this.files.dir,'.speech-'+id+'.mp3');
  try{
   await new Promise((resolve,reject)=>{
    const child=spawn(this.python,[this.runner,file],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,...(process.env.SSL_CERT_FILE?{SSL_CERT_FILE:process.env.SSL_CERT_FILE}:{}),PYTHONDONTWRITEBYTECODE:'1'}});
    let ended=false;const finish=(error)=>{if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve();};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('speech_unavailable'));},60000);
    child.stdin.on('error',()=>{});child.stdin.end(text);child.stdout.resume();child.stderr.resume();child.on('error',()=>finish(Error('speech_unavailable')));child.on('close',code=>finish(code?Error('speech_unavailable'):null));
   });
   return this.files.save(fs.readFileSync(file),'reply.mp3',id);
  }finally{try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
 }
}
module.exports={VoiceSynthesizer};
