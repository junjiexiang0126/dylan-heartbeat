'use strict';
// Explicit deployment verification. No model, no chat request, no memory writes.
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-speech-check-')),file=path.join(dir,'probe.mp3');
 try{await new Promise((resolve,reject)=>{const child=spawn(process.env.ZIWEI_VOICE_PYTHON||'/opt/voice-env/bin/python',[path.join(__dirname,'../voice_synthesize.py'),file],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('timeout'));},60000);child.stdin.on('error',()=>{});child.stdin.end('语音连接检查。');child.stdout.resume();child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('unavailable'));});child.on('close',code=>{clearTimeout(timer);code?reject(Error('unavailable')):resolve();});});
  const b=fs.readFileSync(file);console.log('VOICE_OUTPUT_CHECK '+JSON.stringify({passed:b.length>1000,bytes:b.length}));
 }catch{console.log('VOICE_OUTPUT_CHECK '+JSON.stringify({passed:false}));}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={run};
