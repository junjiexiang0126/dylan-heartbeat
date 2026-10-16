'use strict';
// Optional wire format chosen by the Agent. Plain text is always one message.
const TYPE='ziwei.reply.v1';
const instruction='[网页消息展示约定；只影响本轮显示，不改变身份、记忆或工具权限]\n回复长短、消息数量由你自主决定。工作、代码或完整说明可直接发一段普通文本，不要为分段而拆分。若你选择多条独立气泡，最终输出完整 JSON：{"type":"ziwei.reply.v1","messages":["第一条原文","第二条原文"]}。每项是一条你亲自选择的完整消息；代码块可完整保留在任一项。附件的 MEDIA: 路径行放进最后一项，保持原路径。可选 summary 字符串只写供用户阅读的简短结论依据或行动摘要，不输出内部逐步推理或私人笔记。单条也可使用此格式，前端不会按字数拆开。\n[展示约定结束]\n\n';
function transport(input){
 if(typeof input==='string')return instruction+input;
 if(Array.isArray(input)){if(input[0]?.type==='text'&&typeof input[0].text==='string')return [{...input[0],text:instruction+input[0].text},...input.slice(1)];return [{type:'text',text:instruction},...input];}
 return input;
}
function parse(text){
 const plain={messages:[text],summary:null,structured:false};
 if(typeof text!=='string')return plain;
 const candidate=text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/,'$1');if(!candidate.startsWith('{'))return plain;
 let value;try{value=JSON.parse(candidate);}catch{return plain;}
 if(value?.type!==TYPE||!Array.isArray(value.messages)||!value.messages.length||value.messages.length>20||value.messages.some(x=>typeof x!=='string'||!x.trim()||x.length>200000))return plain;
 return {messages:value.messages,summary:typeof value.summary==='string'&&value.summary.trim()?value.summary.slice(0,4000):null,structured:true};
}
module.exports={parse,transport};
