'use strict';
const {spawn}=require('node:child_process'),path=require('node:path');
function extract(file,name){
 const pdf=/\.pdf$/i.test(name),office=/\.(docx|xlsx)$/i.test(name);if(!pdf&&!office)return Promise.resolve(null);
 return new Promise(resolve=>{const child=spawn(pdf?'pdftotext':'python3',pdf?['-enc','UTF-8','-f','1','-l','100',file,'-']:[path.join(__dirname,'attachment_text.py'),file,name.toLowerCase()],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH}});child.stdout.setEncoding('utf8');let out='',ended=false;const finish=value=>{if(ended)return;ended=true;clearTimeout(timer);resolve(value);};const timer=setTimeout(()=>{child.kill('SIGKILL');finish(null);},15000);child.stdout.on('data',c=>{out+=c;if(Buffer.byteLength(out)>800000){child.kill('SIGKILL');finish({text:out.slice(0,200000),truncated:true});}});child.stderr.resume();child.on('error',()=>finish(null));child.on('close',code=>{try{finish(code?null:pdf?{text:out.slice(0,200000),truncated:true}:JSON.parse(out));}catch{finish(null);}});});
}
module.exports={extract};
