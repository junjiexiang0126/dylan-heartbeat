'use strict';
const JSZip=require('jszip');
const crypto=require('node:crypto');
const {documentBytes,MIME,EXT}=require('./work_documents');

function documentTool(){return {type:'function',function:{name:'work_document_create',description:'用工作正文生成当前已授权格式的真实文档草稿，交给知微审核。只传正文，不传路径、命令、密钥或私人聊天。',parameters:{type:'object',properties:{text:{type:'string',description:'完整工作正文。用空行分段，标题用 Markdown 标题，表格用竖线分列。'}},required:['text'],additionalProperties:false}}};}
function parseDocumentCall(message){
 const calls=message?.tool_calls;
 if(!Array.isArray(calls)||calls.length!==1||calls[0]?.type!=='function'||calls[0].function?.name!=='work_document_create')throw Error('work_document_tool_call_required');
 let value;try{value=JSON.parse(calls[0].function.arguments);}catch{throw Error('invalid_work_tool_arguments');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='text')||typeof value.text!=='string'||!value.text.trim()||value.text.length>48000)throw Error('invalid_work_tool_arguments');
 return {text:value.text,callId:typeof calls[0].id==='string'?calls[0].id.slice(0,120):null};
}
async function inspect(kind,bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>20*1024*1024)throw Error('work_document_integrity_failed');
 let parts=0;
 if(kind==='pdf'){
  if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!bytes.subarray(-100).toString('latin1').includes('%%EOF'))throw Error('work_document_integrity_failed');
 }else{
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true}),required={word:'word/document.xml',ppt:'ppt/presentation.xml',excel:'xl/workbook.xml'}[kind];
  if(!required||!zip.file('[Content_Types].xml')||!zip.file(required))throw Error('work_document_integrity_failed');
  parts=Object.keys(zip.files).length;
 }
 return {format:EXT[kind],mime:MIME[kind],bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),containerChecked:true,parts,visualChecked:false};
}
async function createDocuments(kind,title,text){
 const result=[];
 for(const format of kind==='bundle'?['word','ppt','pdf','excel']:[kind]){
  const bytes=await documentBytes(format,title,text),inspection=await inspect(format,bytes);
  result.push({bytes,name:title+'.'+EXT[format],mime:MIME[format],inspection});
 }
 return result;
}
function coordinatorCall(value,name){
 const call=value?.toolCall;
 if(!call||call.name!==name||!call.arguments||typeof call.arguments!=='object'||Array.isArray(call.arguments))throw Error('work_coordinator_tool_call_required');
 return call.arguments;
}
module.exports={documentTool,parseDocumentCall,createDocuments,coordinatorCall,inspect};
