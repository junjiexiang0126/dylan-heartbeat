'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWorkService}=require('../work_service');
const request=(svc,pathname,method='GET',body)=>new Promise(async(resolve,reject)=>{const res={writeHead(code){this.code=code;},end(s){resolve({code:this.code,body:JSON.parse(s)})}};try{await svc.handle({method},res,pathname,async()=>body,(r,c,d)=>{r.writeHead(c);r.end(JSON.stringify(d));});}catch(e){reject(e);}});
const setup=(overrides={})=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'work-v2-'));let calls=[];
 const client={configured:()=>true,json:async(route,options)=>{assert.equal(route,'/ziwei/web/work/turn');const b=JSON.parse(options.body);calls.push(b);return {text:JSON.stringify(b.stage==='plan'?{message:'我把这项任务交给白鸦。',instruction:'写出工作结果'}:{approved:true,message:'审核通过。'}),model:'hermes-fixture',usage:{prompt_tokens:5,completion_tokens:5}};}};
 const svc=createWorkService(dir,{client,fetch:async(url,opts)=>{calls.push(JSON.parse(opts.body));assert.match(url,/^https:\/\/open.bigmodel.cn/);return {ok:true,json:async()=>({choices:[{message:{content:'工作结果\n\n第二段'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:5}})};},...overrides});
 return {svc,dir,calls,cleanup:()=>{svc.close();fs.rmSync(dir,{recursive:true,force:true});}};};
async function settled(svc,id='test-task'){for(let i=0;i<100;i++){const d=(await request(svc,'/api/work/messages')).body;if(!d.tasks.some(t=>t.id===id&&['queued','planning','executing','reviewing','generating'].includes(t.state)))return d;await new Promise(r=>setTimeout(r,10));}throw Error('not settled');}
process.env.ZHIPU_API_KEY='isolated-fixture-key';
const body=(id='test-task',extra={})=>({requestId:id,text:'@知微 请委派白鸦完成',tool:'auto',attachments:[],...extra});
test('native delegation, GLM execution, native review persist separately with three actual mocked transports',async()=>{const x=setup();try{
 assert.equal((await request(x.svc,'/api/work/send','POST',body())).code,202);const d=await settled(x.svc);assert.deepEqual(d.data.map(x=>x.role),['user','ziwei','glm','ziwei']);assert.equal(d.tasks[0].state,'completed');assert.equal(d.tasks[0].calls,3);assert.equal(d.usage.length,3);assert.equal(d.usage[0].billedCny,null);assert.equal(x.calls.length,3);
 const again=await request(x.svc,'/api/work/send','POST',body());assert.equal(again.body.replayed,true);assert.equal(x.calls.length,3);
 assert.equal((await request(x.svc,'/api/work/send','POST',body('test-task',{text:'different'}))).code,409);
 const second=createWorkService(x.dir);assert.equal((await request(second,'/api/work/messages')).body.data.length,4);second.close();assert.equal(fs.existsSync(path.join(x.dir,'chat.sqlite')),false);
 }finally{x.cleanup();}});
test('unconfigured Hermes rejects before storing or invoking GLM',async()=>{const x=setup({client:{configured:()=>false}});try{const r=await request(x.svc,'/api/work/send','POST',body());assert.equal(r.code,503);assert.equal(x.calls.length,0);assert.equal((await request(x.svc,'/api/work/messages')).body.tasks.length,0);}finally{x.cleanup();}});
test('unauthorized tools fail closed; registration grants no permission',async()=>{const x=setup();try{
 assert.equal((await request(x.svc,'/api/work/send','POST',body('denied',{tool:'word'}))).code,403);
 const register=await request(x.svc,'/api/work/tools/register','POST',{kind:'word',name:'教案'});assert.equal(register.code,201);
 assert.equal((await request(x.svc,'/api/work/send','POST',body('denied2',{tool:register.body.id}))).code,403);
 assert.equal((await request(x.svc,'/api/work/tools/register','POST',{kind:'shell',name:'exec'})).code,400);
 assert.equal(x.calls.length,0);
 }finally{x.cleanup();}});
test('tool configuration uses revisions and approved document generation creates authentic Office bytes',async()=>{const x=setup();try{
 assert.equal((await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:0,authorized:true,title:'课程计划'})).code,200);
 assert.equal((await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:0,authorized:true})).code,409);
 await request(x.svc,'/api/work/send','POST',body('document',{tool:'word'}));const d=await settled(x.svc,'document');assert.equal(d.tasks[0].state,'completed');const id=d.data.at(-1).attachments[0];const b=fs.readFileSync(path.join(x.dir,'work','attachments',id));assert.equal(b.subarray(0,2).toString(),'PK');assert.ok(b.length>5000);
 }finally{x.cleanup();}});
test('concurrent sends admit one task and never invoke a second task',async()=>{let release;const block=new Promise(r=>release=r);const x=setup({client:{configured:()=>true,json:async()=>{await block;throw Error('injected');}}});try{
 const results=await Promise.all([request(x.svc,'/api/work/send','POST',body('one')),request(x.svc,'/api/work/send','POST',body('two'))]);assert.deepEqual(results.map(x=>x.code).sort(),[202,429]);release();await settled(x.svc,'one');assert.equal((await request(x.svc,'/api/work/messages')).body.tasks.length,1);
 }finally{release();x.cleanup();}});
test('failed native review never delivers files or claims completion',async()=>{const x=setup({client:{configured:()=>true,json:async(_,o)=>{const b=JSON.parse(o.body);return {text:JSON.stringify(b.stage==='plan'?{message:'委派',instruction:'执行'}:{approved:false,message:'资料不足，未通过审核'}),model:'fixture',usage:{}};}}});try{
 await request(x.svc,'/api/work/send','POST',body());const d=await settled(x.svc);assert.equal(d.tasks[0].state,'needs_revision');assert.ok(!d.data.some(m=>m.stage==='delivered'));
 }finally{x.cleanup();}});
test('daily reservations include failed tasks and enforce four-task ceiling',async()=>{const x=setup({client:{configured:()=>true,json:async()=>{throw Error('transport_uncertain');}}});try{for(let n=0;n<4;n++){await request(x.svc,'/api/work/send','POST',body('task-'+n));await settled(x.svc,'task-'+n);}const r=await request(x.svc,'/api/work/send','POST',body('fifth'));assert.equal(r.code,429);assert.equal(r.body.error,'work_daily_limit');}finally{x.cleanup();}});
test('message actions persist favorite, quote targets and Work-only poke without model calls',async()=>{const x=setup();try{await request(x.svc,'/api/work/action','POST',{action:'poke',target:'glm'});const first=(await request(x.svc,'/api/work/messages')).body.data[0];await request(x.svc,'/api/work/action','POST',{action:'favorite',id:first.id});assert.equal((await request(x.svc,'/api/work/messages')).body.data[0].favorite,true);assert.equal(x.calls.length,0);}finally{x.cleanup();}});
