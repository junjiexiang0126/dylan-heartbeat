'use strict';
// Optional wire format chosen by the Agent. Plain text is always one message.
const TYPE='ziwei.reply.v1';
const instruction='[网页消息展示约定；只影响本轮显示，不改变身份、记忆或工具权限]\n回复长短、消息数量由你自主决定。工作、代码或完整说明可直接发一段普通文本，不要为分段而拆分。若你选择多条独立气泡，最终输出完整 JSON：{"type":"ziwei.reply.v1","messages":["第一条原文","第二条原文"]}。每项是一条你亲自选择的完整消息；代码块可完整保留在任一项。附件的 MEDIA: 路径行放进最后一项，保持原路径。可选 summary 字符串只写供用户阅读的简短结论依据或行动摘要，不输出内部逐步推理或私人笔记。单条也可使用此格式，前端不会按字数拆开。\n[展示约定结束]\n\n';
function transport(input){
 if(typeof input==='string')return instruction+input;
 if(Array.isArray(input)){if(input[0]?.type==='text'&&typeof input[0].text==='string')return [{...input[0],text:instruction+input[0].text},...input.slice(1)];return [{type:'text',text:instruction},...input];}
 return input;
}
function normalizeEnvelope(source){
 // Repair only JSON punctuation outside quoted strings and literal line breaks inside
 // JSON strings. Never split message content by commas, punctuation or length.
 let out='',quoted=false,escaped=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){
   if(escaped){out+=c;escaped=false;continue;}
   if(c==='\\'){out+=c;escaped=true;continue;}
   if(c==='"'){quoted=false;out+=c;continue;}
   if(c==='\n'){out+='\\n';continue;}
   if(c==='\r'){out+='\\r';continue;}
   if(c==='\t'){out+='\\t';continue;}
   out+=c;continue;
  }
  if(c==='"'){quoted=true;out+=c;continue;}
  out+=c==='，'?',':c;
 }
 return out;
}

function fallback(candidate,plain){
 // Only intercept a recognizable reply envelope; unrelated JSON and ordinary prose
 // must stay untouched. Recover literal string values without exposing wire JSON.
 if(!/["']type["']\s*:\s*["']ziwei\.reply\.v1["']/.test(candidate))return plain;
 const start=/"messages"\s*:\s*\[/.exec(candidate);
 if(!start)return {messages:['知微的这条回复格式不完整，请重新发送。'],summary:null,structured:false};
 const rest=candidate.slice(start.index+start[0].length);
 const messages=[];let i=0;
 while(i<rest.length&&messages.length<20){
  while(i<rest.length&&/[\s,，]/.test(rest[i]))i++;
  if(rest[i]===']')break;
  if(rest[i]!=='"')break;
  const begin=i++;let escaped=false;
  for(;i<rest.length;i++){
   if(escaped){escaped=false;continue;}
   if(rest[i]==='\\'){escaped=true;continue;}
   if(rest[i]==='"')break;
  }
  if(i>=rest.length)break;
  const raw=rest.slice(begin,i+1);i++;
  try{
   const value=JSON.parse(normalizeEnvelope(raw));
   if(typeof value!=='string'||!value.trim())break;
   messages.push(value);
  }catch{break;}
 }
 return {messages:messages.length?messages:['知微的这条回复格式不完整，请重新发送。'],summary:null,structured:false};
}

function parse(text){
 const plain={messages:[text],summary:null,structured:false};
 if(typeof text!=='string')return plain;
 const trimmed=text.trim();
 const fenced=/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
 const candidate=(fenced?fenced[1]:trimmed).trim();
 if(!candidate.startsWith('{'))return plain;
 let value;
 try{value=JSON.parse(candidate);}
 catch{try{value=JSON.parse(normalizeEnvelope(candidate));}catch{return fallback(candidate,plain);}}
 if(value?.type!==TYPE||!Array.isArray(value.messages)||!value.messages.length||value.messages.length>20||value.messages.some(x=>typeof x!=='string'||!x.trim()||x.length>200000))return plain;
 return {messages:value.messages,summary:typeof value.summary==='string'&&value.summary.trim()?value.summary.slice(0,4000):null,structured:true};
}

module.exports={parse,transport};
