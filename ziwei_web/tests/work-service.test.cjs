'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWorkService}=require('../work_service');
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-work-test-'));
const request=(svc,pathname,method,body)=>new Promise(async(resolve,reject)=>{
 const res={writeHead(code){this.code=code;},end(s){resolve({code:this.code,body:JSON.parse(s)})}};
 try{await svc.handle({method},res,pathname,async()=>body,(r,status,data)=>{r.writeHead(status);r.end(JSON.stringify(data));});}catch(e){reject(e);}
});
test('Work history persists but is separate from Hermes',async()=>{
 const d=dir();try{
  const svc=createWorkService(d);
  const before=await request(svc,'/api/work/messages','GET');
  assert.deepEqual(before.body.data,[]);
  assert.equal(fs.existsSync(path.join(d,'work-messages.json')),false);
  assert.equal(fs.existsSync(path.join(d,'hermes_native')),false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('Ziwei mentions fail closed without spending tokens',async()=>{
 const d=dir(),old=process.env.ZHIPU_API_KEY;process.env.ZHIPU_API_KEY='test-key';
 try{
  const svc=createWorkService(d);
  const r=await request(svc,'/api/work/send','POST',{text:'@知微 请审核',tool:'auto'});
  assert.equal(r.code,409);assert.equal(r.body.error,'ziwei_delegation_not_ready');
  assert.equal(fs.existsSync(path.join(d,'work-usage.json')),false);
 }finally{if(old===undefined)delete process.env.ZHIPU_API_KEY;else process.env.ZHIPU_API_KEY=old;fs.rmSync(d,{recursive:true,force:true});}
});
test('one GLM call yields persistent isolated history and token accounting',async()=>{
 const d=dir(),old=process.env.ZHIPU_API_KEY,original=global.fetch;
 process.env.ZHIPU_API_KEY='test-key';let count=0;
 global.fetch=async(url,options)=>{
  count++;assert.match(url,/bigmodel.cn/);assert.match(options.headers.Authorization,/Bearer test-key/);
  return {ok:true,json:async()=>({choices:[{message:{content:'白鸦测试回复'}}],usage:{total_tokens:21,prompt_tokens:15,completion_tokens:6}})};
 };
 try{
  const svc=createWorkService(d);
  const r=await request(svc,'/api/work/send','POST',{text:'@白鸦 测试',tool:'auto'});
  assert.equal(r.code,200);assert.equal(count,1);assert.equal(r.body.assistant.text,'白鸦测试回复');
  const history=await request(createWorkService(d),'/api/work/messages','GET');
  assert.deepEqual(history.body.data.map(m=>m.role),['user','glm']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d,'work-usage.json'))).tokens,21);
 }finally{global.fetch=original;if(old===undefined)delete process.env.ZHIPU_API_KEY;else process.env.ZHIPU_API_KEY=old;fs.rmSync(d,{recursive:true,force:true});}
});
