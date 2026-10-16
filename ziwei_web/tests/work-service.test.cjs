'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWorkService}=require('../work_service');
const request=(svc,pathname,method='GET',body)=>new Promise(async(resolve,reject)=>{const res={writeHead(code){this.code=code;},end(s){resolve({code:this.code,body:JSON.parse(s)})}};try{await svc.handle({method},res,pathname,async()=>body,(r,c,d)=>{r.writeHead(c);r.end(JSON.stringify(d));});}catch(e){reject(e);}});
const setup=(overrides={})=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'work-v2-'));let calls=[];
 const client={configured:()=>true,json:async(route,options)=>{assert.equal(route,'/ziwei/web/work/turn');const b=JSON.parse(options.body);calls.push(b);return {text:JSON.stringify(b.stage==='plan'?{message:'我把这项任务交给白鸦。',toolCall:{name:'work_delegate',arguments:{instruction:'写出工作结果',tool:b.tool}}}:{approved:true,message:'审核通过。',toolCall:{name:'work_document_deliver',arguments:{}}}),model:'hermes-fixture',usage:{prompt_tokens:5,completion_tokens:5}};}};
 const svc=createWorkService(dir,{client,fetch:async(url,opts)=>{calls.push(JSON.parse(opts.body));assert.match(url,/^https:\/\/open.bigmodel.cn/);return {ok:true,json:async()=>({choices:[{message:JSON.parse(opts.body).tools?{content:null,tool_calls:[{id:'fixture-call',type:'function',function:{name:'work_document_create',arguments:JSON.stringify({text:'工作结果\n\n第二段'})}}]}:{content:'工作结果\n\n第二段'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:5}})};},...overrides});
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
test('failed native review never delivers files or claims completion',async()=>{const x=setup({client:{configured:()=>true,json:async(_,o)=>{const b=JSON.parse(o.body);return {text:JSON.stringify(b.stage==='plan'?{message:'委派',toolCall:{name:'work_delegate',arguments:{instruction:'执行',tool:b.tool}}}:{approved:false,message:'资料不足，未通过审核'}),model:'fixture',usage:{prompt_tokens:5,completion_tokens:5}};}}});try{
 await request(x.svc,'/api/work/send','POST',body());const d=await settled(x.svc);assert.equal(d.tasks[0].state,'needs_revision');assert.ok(!d.data.some(m=>m.stage==='delivered'));
 }finally{x.cleanup();}});
test('unknown failed requests retain reservations and stop at the daily budget',async()=>{const x=setup({client:{configured:()=>true,json:async()=>{throw Error('transport_uncertain');}}});try{for(let n=0;n<5;n++){await request(x.svc,'/api/work/send','POST',body('task-'+n));await settled(x.svc,'task-'+n);}const r=await request(x.svc,'/api/work/send','POST',body('sixth'));assert.equal(r.code,429);assert.equal(r.body.error,'work_daily_limit');}finally{x.cleanup();}});
test('message actions persist favorite, quote targets and Work-only poke without model calls',async()=>{const x=setup();try{await request(x.svc,'/api/work/action','POST',{action:'poke',target:'glm'});const first=(await request(x.svc,'/api/work/messages')).body.data[0];await request(x.svc,'/api/work/action','POST',{action:'favorite',id:first.id});assert.equal((await request(x.svc,'/api/work/messages')).body.data[0].favorite,true);assert.equal(x.calls.length,0);}finally{x.cleanup();}});
test('one reviewed task can deliver four genuine formats with three model transports total',async()=>{const x=setup();try{
 await request(x.svc,'/api/work/tools/configure','POST',{id:'bundle',revision:0,authorized:true,title:'四格式验收'});
 await request(x.svc,'/api/work/send','POST',body('bundle-task',{tool:'bundle'}));const d=await settled(x.svc,'bundle-task');assert.equal(d.tasks[0].state,'completed');assert.equal(d.data.at(-1).attachments.length,4);assert.equal(x.calls.length,3);assert.deepEqual(d.files.map(f=>path.extname(f.name)).sort(),['.docx','.pdf','.pptx','.xlsx']);
 }finally{x.cleanup();}});
test('native diagnostic failures preserve safe phase codes and redact arbitrary provider errors',async()=>{
 for(const [error,want] of [['work_initialization_TypeError','work_initialization_TypeError'],['secret-provider-key','hermes_http_502']]){
  const x=setup({client:{configured:()=>true,fetch:async()=>new Response(JSON.stringify({error}),{status:502})}});
  try{await request(x.svc,'/api/work/send','POST',body());const d=await settled(x.svc);assert.equal(d.tasks[0].error,want);assert.equal(d.usage.length,1);assert.equal(d.usage[0].status,'unknown');}finally{x.cleanup();}
 }
});
test('runtime readiness uses a zero-model native check and reports GLM configuration separately',async()=>{
 const x=setup({client:{configured:()=>true,fetch:async route=>{assert.equal(route,'/ziwei/web/work/status');return new Response(JSON.stringify({ready:true,model:'deepseek-flash',calls:0}));}}});
 try{const r=await request(x.svc,'/api/work/runtime');assert.equal(r.code,200);assert.equal(r.body.native.calls,0);assert.equal(r.body.glmConfigured,true);assert.equal((await request(x.svc,'/api/work/messages')).body.tasks.length,0);}finally{x.cleanup();}
});
test('document tool schema is sent to GLM and actual execution receipts survive reopening',async()=>{
 const x=setup();try{
  await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:0,authorized:true});
  await request(x.svc,'/api/work/send','POST',body('tools',{tool:'word'}));const d=await settled(x.svc,'tools');
  assert.equal(x.calls[1].tools[0].function.name,'work_document_create');
  assert.deepEqual(d.toolRuns.map(r=>[r.agent,r.name]),[['ziwei','work_delegate'],['glm','work_document_create'],['system','work_document_inspect'],['ziwei','work_document_deliver']]);
  assert.equal(d.toolRuns[1].result.files[0].containerChecked,true);assert.equal(d.toolRuns[1].result.files[0].visualChecked,false);
  const second=createWorkService(x.dir);try{assert.equal((await request(second,'/api/work/messages')).body.toolRuns.length,4);}finally{second.close();}
 }finally{x.cleanup();}
});
test('GLM cannot substitute shell tools or claim a document without a function call',async()=>{
 for(const message of [{content:'已经做好文件了'},{tool_calls:[{type:'function',function:{name:'shell',arguments:'{"command":"env"}'}}]}]){
  const x=setup({fetch:async()=>({ok:true,json:async()=>({choices:[{message,finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}})})});try{
   await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:0,authorized:true});
   await request(x.svc,'/api/work/send','POST',body('bad-tool',{tool:'word'}));const d=await settled(x.svc,'bad-tool');
   assert.equal(d.tasks[0].error,'work_document_tool_call_required');assert.equal(d.files.length,0);assert.equal(d.usage.length,2);assert.equal(d.tasks[0].calls,2);
  }finally{x.cleanup();}
 }
});
test('native rejection leaves generated drafts unpublished and inaccessible',async()=>{
 const x=setup({client:{configured:()=>true,json:async(_,o)=>{const b=JSON.parse(o.body);return {text:JSON.stringify(b.stage==='plan'?{message:'委派',toolCall:{name:'work_delegate',arguments:{instruction:'执行'}}}:{approved:false,message:'需要修改'}),model:'fixture',usage:{prompt_tokens:5,completion_tokens:5}};}}});try{
  await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:0,authorized:true});
  await request(x.svc,'/api/work/send','POST',body('reject-doc',{tool:'word'}));const d=await settled(x.svc,'reject-doc');
  assert.equal(d.tasks[0].state,'needs_revision');assert.equal(d.files.length,0);const aid=d.toolRuns.find(r=>r.name==='work_document_create').result.files[0].id;
  assert.equal((await request(x.svc,'/api/work/attachments/'+aid)).code,404);assert.ok(!d.toolRuns.some(r=>r.name==='work_document_deliver'));
 }finally{x.cleanup();}
});
test('revoking a document permission during native review prevents delivery',async()=>{
 let release,entered;const hold=new Promise(r=>release=r),reviewStarted=new Promise(r=>entered=r);
 const x=setup({client:{configured:()=>true,json:async(_,o)=>{const b=JSON.parse(o.body);if(b.stage==='review'){entered();await hold;return {text:JSON.stringify({approved:true,message:'通过',toolCall:{name:'work_document_deliver',arguments:{}}})};}return {text:JSON.stringify({message:'委派',toolCall:{name:'work_delegate',arguments:{instruction:'执行'}}})};}}});try{
  await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:0,authorized:true});
  await request(x.svc,'/api/work/send','POST',body('revoke-doc',{tool:'word'}));await reviewStarted;
  await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:1,authorized:false});release();const d=await settled(x.svc,'revoke-doc');
  assert.equal(d.tasks[0].error,'tool_permission_denied');assert.equal(d.files.length,0);assert.ok(!d.data.some(m=>m.stage==='delivered'));
 }finally{release();x.cleanup();}
});
test('native coordinator can directly regenerate the final document through its own Work tool',async()=>{
 const x=setup({client:{configured:()=>true,json:async(_,o)=>{const b=JSON.parse(o.body);return {text:JSON.stringify(b.stage==='plan'?{message:'委派',toolCall:{name:'work_delegate',arguments:{instruction:'执行'}}}:{approved:true,message:'由我修订后交付',toolCall:{name:'work_document_create',arguments:{text:'知微亲自修订的最终正文'}}})};}}});try{
  await request(x.svc,'/api/work/tools/configure','POST',{id:'word',revision:0,authorized:true});
  await request(x.svc,'/api/work/send','POST',body('native-create',{tool:'word'}));const d=await settled(x.svc,'native-create');assert.equal(d.tasks[0].state,'completed');assert.equal(d.files.length,1);
  const r=d.toolRuns.find(r=>r.agent==='ziwei'&&r.name==='work_document_create');assert.ok(r);assert.equal(d.tasks[0].calls,3);
  const zip=await require('jszip').loadAsync(fs.readFileSync(path.join(x.dir,'work','attachments',d.files[0].id)));assert.match(await zip.file('word/document.xml').async('string'),/知微亲自修订的最终正文/);
 }finally{x.cleanup();}
});
test('four daily deliverables fit independently and do not consume one task for every file format',async()=>{
 const x=setup();try{
  await request(x.svc,'/api/work/tools/configure','POST',{id:'bundle',revision:0,authorized:true});
  for(let n=0;n<4;n++){assert.equal((await request(x.svc,'/api/work/send','POST',body('day-'+n,{tool:'bundle'}))).code,202);const d=await settled(x.svc,'day-'+n);assert.equal(d.tasks.find(t=>t.id==='day-'+n).state,'completed');}
  const d=(await request(x.svc,'/api/work/messages')).body;assert.equal(d.tasks.length,4);assert.equal(d.files.length,16);assert.equal(d.usage.length,12);assert.equal(d.budget.limit,10);assert.ok(d.budget.remaining>9);assert.equal(d.limits.maxOutputTokens,10000);
 }finally{x.cleanup();}
});
test('review feedback triggers a bounded second draft and never reuses a native review id',async()=>{
 let reviews=0;const ids=[],feedback=[];
 const x=setup({client:{configured:()=>true,json:async(_,o)=>{const b=JSON.parse(o.body);if(b.stage==='review'){ids.push(b.taskId);reviews++;return {text:JSON.stringify(reviews===1?{approved:false,message:'补充具体时间段'}:{approved:true,message:'已通过',toolCall:{name:'work_document_deliver',arguments:{}}}),usage:{prompt_tokens:10,completion_tokens:10}};}return {text:JSON.stringify({message:'委派',toolCall:{name:'work_delegate',arguments:{instruction:'执行',tool:'auto'}}}),usage:{prompt_tokens:10,completion_tokens:10}};}} ,fetch:async(_,o)=>{feedback.push(JSON.parse(JSON.parse(o.body).messages[1].content).feedback);return {ok:true,json:async()=>({choices:[{message:{content:'修订后的工作正文'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10}})};}});try{
  await request(x.svc,'/api/work/send','POST',body('revision'));const d=await settled(x.svc,'revision');assert.equal(d.tasks[0].state,'completed');assert.equal(d.tasks[0].calls,5);assert.equal(new Set(ids).size,2);assert.deepEqual(feedback,['','补充具体时间段']);
 }finally{x.cleanup();}
});
test('unknown usage retains the full call reservation rather than inventing zero cost',async()=>{
 const x=setup({client:{configured:()=>true,json:async()=>({text:JSON.stringify({message:'委派',toolCall:{name:'work_delegate',arguments:{instruction:'执行'}}}),usage:{}})}});try{
  await request(x.svc,'/api/work/send','POST',body('unknown'));const d=await settled(x.svc,'unknown');assert.equal(d.usage[0].status,'unknown');assert.equal(d.usage[0].cost,2);assert.ok(d.budget.remaining<8);assert.equal(d.usage[0].billedCny,null);
 }finally{x.cleanup();}
});
