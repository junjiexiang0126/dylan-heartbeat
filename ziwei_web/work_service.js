'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicWrite,load}=require('./home_store');
const MAX_MESSAGES=500,MAX_TEXT=4000,MAX_CALLS=1,MAX_OUTPUT_TOKENS=600;
function createWorkService(dataDir){
 const file=path.join(dataDir,'work-messages.json');
 let messages=load(file,[]);
 if(!Array.isArray(messages))throw Error('invalid_work_history');
 let busy=false;
 const save=()=>atomicWrite(file,messages);
 const append=(role,text,extra={})=>{
  const item={id:crypto.randomUUID(),role,text,at:new Date().toISOString(),...extra};
  messages.push(item);if(messages.length>MAX_MESSAGES)messages=messages.slice(-MAX_MESSAGES);
  save();return item;
 };
 async function handle(req,res,pathname,readBody,json){
  if(pathname==='/api/work/messages'&&req.method==='GET')return json(res,200,{data:messages.slice(-100)});
  if(pathname!=='/api/work/send'||req.method!=='POST')return json(res,405,{error:'method_not_allowed'});
  if(busy)return json(res,429,{error:'work_busy'});
  const body=await readBody(req,8192);
  if(!body||typeof body.text!=='string'||!body.text.trim()||body.text.length>MAX_TEXT||!['auto','ppt','word','pdf','excel','image','research'].includes(body.tool))return json(res,400,{error:'invalid_work_message'});
  const key=process.env.ZHIPU_API_KEY||'';
  if(!key)return json(res,503,{error:'glm_not_configured'});
  busy=true;
  try{
   const user=append('user',body.text,{tool:body.tool});
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
   let response;
   try{
    response=await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions',{
     method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
     body:JSON.stringify({model:'glm-4-flash',max_tokens:MAX_OUTPUT_TOKENS,temperature:0.5,messages:[
      {role:'system',content:'你是知微之家 Work 的 GLM 执行助手。只处理当前用户明确提供的工作内容。你不是知微，不要假装知微或写入 Hermes 记忆。不能宣称已生成或上传文件、执行工具或完成外部操作。'},
      {role:'user',content:body.text}
     ]})
    });
   }finally{clearTimeout(timeout);}
   if(!response.ok){append('system','GLM 请求失败',{status:'failed'});return json(res,502,{error:'glm_upstream_error',httpStatus:response.status});}
   const result=await response.json();
   const answer=result?.choices?.[0]?.message?.content;
   if(typeof answer!=='string'||!answer.trim())return json(res,502,{error:'glm_empty_response'});
   const assistant=append('glm',answer.slice(0,16000),{model:'glm-4-flash',usage:result.usage||null});
   return json(res,200,{user,assistant,limits:{calls:MAX_CALLS,maxOutputTokens:MAX_OUTPUT_TOKENS,timeoutMs:12000},usage:result.usage||null});
  }catch(e){return json(res,502,{error:e.name==='AbortError'?'glm_timeout':'glm_request_failed'});}
  finally{busy=false;}
 }
 return {handle};
}
module.exports={createWorkService};
