'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{HermesClient}=require('./hermes_client');
const {Attachments}=require('./attachments'),{extract}=require('./document_text');
const {load}=require('./home_store');
const {documentTool,parseDocumentCall,createDocuments,coordinatorCall}=require('./work_tools');
const {parse}=require('./chat_presentation');
const requirements=require('./work_requirements');
const day=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const LIMITS={callsPerTask:7,concurrency:1,timeoutMs:600000,dailyCalls:48,dailyTasks:8,dailyCny:10,maxRevisionRounds:2,maxOutputTokens:10000};
function parseJSON(text){try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw Error('invalid_hermes_json');}}
function reviewProblem(review,selected){
 if(!review||typeof review.approved!=='boolean'||typeof review.message!=='string'||!review.message.trim())return 'invalid_hermes_review';
 if(review.messages!==undefined&&(!Array.isArray(review.messages)||!review.messages.length||review.messages.length>8||review.messages.some(t=>typeof t!=='string'||!t.trim()||t.length>48000)))return 'invalid_hermes_review';
 if(!review.approved)return null;
 const c=review.toolCall,a=c?.arguments;
 if(!a||typeof a!=='object'||Array.isArray(a))return 'work_coordinator_tool_call_required';
 if(c.name==='work_document_create')return selected==='auto'||typeof a.text!=='string'||!a.text.trim()||a.text.length>48000||Object.keys(a).some(k=>k!=='text')?'invalid_work_tool_arguments':null;
 return c.name!=='work_document_deliver'?'work_coordinator_tool_call_required':Object.keys(a).length?'invalid_work_tool_arguments':null;
}
const safeNativeError=value=>typeof value==='string'&&(/^work_(?:bootstrap|imports|runtime|initialization|conversation)_(?:ImportError|ModuleNotFoundError|TypeError|ValueError|RuntimeError|AttributeError|AuthenticationError|APIConnectionError|APITimeoutError|BadRequestError|RateLimitError|Error)$/.test(value)||/^work_(?:pricing_model_not_allowed|isolation_unsupported|tool_isolation_failed|call_guard_unsupported|model_call_limit|tools_forbidden|context_limit|request_override_forbidden|agent_failed|empty_response|output_limit|response_invalid|provider_refusal|timeout|busy|daily_limit|admission_uncertain)$/.test(value))?value:null;
function createWorkService(dataDir,options={}){
 const db=new DatabaseSync(path.join(dataDir,'work.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
 db.exec(`CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,role TEXT,text TEXT,at TEXT,extra TEXT);CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,digest TEXT,state TEXT,created TEXT,updated TEXT,day TEXT,reserved REAL,calls INTEGER DEFAULT 0,error TEXT,result TEXT);CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,task TEXT,stage TEXT,model TEXT,usage TEXT,at TEXT,cost REAL);CREATE TABLE IF NOT EXISTS tools(id TEXT PRIMARY KEY,kind TEXT,name TEXT,enabled INTEGER,authorized INTEGER,revision INTEGER,config TEXT);CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,data TEXT);`);
 db.exec('CREATE TABLE IF NOT EXISTS tool_runs(id TEXT PRIMARY KEY,task TEXT,agent TEXT,name TEXT,status TEXT,at TEXT,result TEXT)');
 db.exec("UPDATE tool_runs SET status='interrupted' WHERE status='running'");
 const columns=db.prepare('PRAGMA table_info(usage)').all().map(x=>x.name);
 if(!columns.includes('status'))db.exec("ALTER TABLE usage ADD COLUMN status TEXT DEFAULT 'reported'");
 db.exec("UPDATE usage SET status='unknown' WHERE status='reserved'");
 db.exec("UPDATE tasks SET state='interrupted',error='server_restarted_no_automatic_retry' WHERE state IN ('queued','planning','executing','reviewing','generating')");
 for(const [kind,name] of Object.entries({word:'Word 文档',ppt:'PPT 演示',pdf:'PDF 文档',excel:'Excel 表格',bundle:'文档套件（四种格式）'}))db.prepare('INSERT OR IGNORE INTO tools VALUES(?,?,?,1,0,0,?)').run(kind,kind,name,JSON.stringify({title:'工作成果'}));
 // Import the old isolated Work messages exactly once, never private chat.
 if(!db.prepare('SELECT 1 FROM messages LIMIT 1').get())for(const m of load(path.join(dataDir,'work-messages.json'),[]))db.prepare('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?)').run(m.id,m.role,m.text,m.at,JSON.stringify(m));
 const fileStore={attachment:id=>{const x=db.prepare('SELECT data FROM files WHERE id=?').get(id);return x?JSON.parse(x.data):null;},attachmentBytes:()=>db.prepare('SELECT data FROM files').all().reduce((n,x)=>n+JSON.parse(x.data).size,0),addAttachment:a=>db.prepare('INSERT INTO files VALUES(?,?)').run(a.id,JSON.stringify(a))};
 const files=new Attachments(path.join(dataDir,'work'),fileStore),client=options.client||new HermesClient();
 const fetcher=options.fetch||fetch;
 const nativeJSON=async(route,options={})=>{
  if(!client.fetch)return client.json(route,options); // Dependency-injected test transport.
  const response=await client.fetch(route,options),chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>64000)throw Error('work_native_response_limit');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('work_native_invalid_response');}
  if(!response.ok)throw Error(safeNativeError(value.error)||'hermes_http_'+response.status);
  return value;
 };
 const stmt=db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)');
 const append=(role,text,extra={})=>{const m={id:crypto.randomUUID(),role,text,at:new Date().toISOString(),...extra};stmt.run(m.id,role,text,m.at,JSON.stringify(extra));return m;};
 const bubbles=(role,value,extra={})=>{const parts=Array.isArray(value)?value:parse(value).messages;if(!parts.length||parts.length>8||parts.some(t=>typeof t!=='string'||!t.trim()||t.length>48000))throw Error('invalid_work_bubbles');return parts.map(text=>append(role,text,extra));};
 const all=()=>db.prepare('SELECT * FROM messages ORDER BY rowid').all().map(x=>({...x,...JSON.parse(x.extra),extra:undefined}));
 const toolRows=()=>db.prepare('SELECT * FROM tools ORDER BY rowid').all().map(x=>({...x,enabled:!!x.enabled,authorized:!!x.authorized,config:JSON.parse(x.config)}));
 const usageRows=()=>db.prepare('SELECT * FROM usage ORDER BY rowid').all().map(x=>({...x,usage:JSON.parse(x.usage),costBasis:'configured_upper_bound_estimate',billedCny:null}));
 const budget=()=>{
  const legacy=db.prepare('SELECT COALESCE(SUM(reserved),0) cny FROM tasks WHERE day=?').get(day()).cny;
  const used=usageRows().filter(u=>new Date(new Date(u.at).getTime()+7*3600000).toISOString().slice(0,10)===day()).reduce((n,u)=>n+u.cost,0);
  return {day:day(),limit:LIMITS.dailyCny,reservedOrEstimated:legacy+used,legacyReserved:legacy,remaining:Math.max(0,LIMITS.dailyCny-legacy-used)};
 };
 // Retain legacy task counters, and also charge today's recovery calls on older tasks.
 const dailyModelCalls=()=>db.prepare('SELECT COALESCE(SUM(calls),0) n FROM tasks WHERE day=?').get(day()).n+db.prepare("SELECT COUNT(*) n FROM usage u JOIN tasks t ON t.id=u.task WHERE date(u.at,'+7 hours')=? AND t.day<>?").get(day(),day()).n;
 const task=id=>db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
 const state=(id,value,error=null)=>db.prepare('UPDATE tasks SET state=?,error=?,updated=? WHERE id=?').run(value,error,new Date().toISOString(),id);
 const catalog=id=>db.prepare('SELECT * FROM tools WHERE id=?').get(id);
 const permit=id=>{const t=catalog(id);if(!t||!t.enabled||!t.authorized)throw Error('tool_permission_denied');return t;};
 const receipt=(id,agent,name,result)=>{db.prepare('INSERT INTO tool_runs VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,agent,name,'completed',new Date().toISOString(),JSON.stringify(result));};
 const generate=async(id,agent,selected,text,started,callId=null)=>{
  const rid=crypto.randomUUID();db.prepare('INSERT INTO tool_runs VALUES(?,?,?,?,?,?,?)').run(rid,id,agent,'work_document_create','running',new Date().toISOString(),JSON.stringify({tool:selected,callId}));
  try{
   const tool=permit(selected),generated=await createDocuments(tool.kind,JSON.parse(tool.config).title,text),artifacts=[],manifest=[];
   for(const item of generated){permit(selected);if(Date.now()-started>LIMITS.timeoutMs)throw Error('work_timeout');const a=files.save(item.bytes,item.name);db.prepare('UPDATE files SET data=? WHERE id=?').run(JSON.stringify({...a,mime:item.mime,published:false,taskId:id,inspection:item.inspection}),a.id);artifacts.push(a.id);manifest.push({id:a.id,name:a.name,...item.inspection});}
   db.prepare('UPDATE tool_runs SET status=?,result=? WHERE id=?').run('completed',JSON.stringify({tool:selected,callId,files:manifest}),rid);
   return {artifacts,manifest};
  }catch(e){db.prepare('UPDATE tool_runs SET status=?,result=? WHERE id=?').run('failed',JSON.stringify({tool:selected,error:String(e.message).slice(0,160)}),rid);throw e;}
 };
 const record=(usageId,result)=>{const u=result.usage||{},input=u.prompt_tokens,output=u.completion_tokens,known=Number.isSafeInteger(input)&&Number.isSafeInteger(output)&&input>0&&output>0;
  // Conservative configured ceiling, not a claim about the provider's billed price.
  const prior=db.prepare('SELECT cost FROM usage WHERE id=?').get(usageId);
  const cost=known?(input*10+output*20)/1000000:prior.cost;
  db.prepare('UPDATE usage SET model=?,usage=?,cost=?,status=? WHERE id=?').run(result.model||'unknown',JSON.stringify(u),cost,known?'reported':'unknown',usageId);
  if(cost>prior.cost+1e-9)throw Error('work_cost_ceiling_exceeded');
 };
 const call=async(id,stage,payload,deadline)=>{
  const t=task(id);if(t.calls>=LIMITS.callsPerTask)throw Error('work_model_call_limit');
  if(Date.now()>=deadline)throw Error('work_timeout');
  const ceiling=stage==='execute'?.75:2,usageId=crypto.randomUUID();
  db.exec('BEGIN IMMEDIATE');try{
   const count=dailyModelCalls();
   if(count>=LIMITS.dailyCalls||budget().remaining+1e-9<ceiling)throw Error('work_daily_limit');
   db.prepare('UPDATE tasks SET calls=calls+1 WHERE id=?').run(id);
   db.prepare('INSERT INTO usage(id,task,stage,model,usage,at,cost,status) VALUES(?,?,?,?,?,?,?,?)').run(usageId,id,stage,stage==='execute'?'glm-4-flash-250414':'deepseek-flash','{}',new Date().toISOString(),ceiling,'reserved');db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  if(stage==='execute'){
   const needsDocument=payload.format!=='auto';
   const request={model:'glm-4-flash-250414',max_tokens:LIMITS.maxOutputTokens,temperature:.4,...(needsDocument?{tools:[documentTool()],tool_choice:'auto'}:{}),messages:[{role:'system',content:'你是执行助手白鸦。没有长期记忆，不读取私人聊天。只根据本次工作资料执行知微委派。'+(needsDocument?'本次必须调用 work_document_create，将完整正文放入 text 参数。工具会生成真实文件草稿，由知微审核后发布。不要只回复完成，也不要输出生成文件的代码。PPT 按用户页数设计，通常15至30页，用 ## 页面标题 划分各页。':'返回工作正文，不要返回代码来替代正文。')+'使用空行分段。修订时必须返回完整新版正文。'},{role:'user',content:JSON.stringify(payload)}]};
   if(Buffer.byteLength(JSON.stringify(request.messages))>50000)throw Error('work_context_limit');
   const response=await fetcher('https://open.bigmodel.cn/api/paas/v4/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.min(90000,deadline-Date.now())),headers:{Authorization:'Bearer '+process.env.ZHIPU_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(request)});
   if(!response.ok)throw Error('glm_http_'+response.status);
   const result=await response.json(),message=result?.choices?.[0]?.message;
   // Record reported usage even when the model returns an invalid tool request.
   record(usageId,{model:'glm-4-flash-250414',usage:result.usage});
   const invocation=needsDocument?parseDocumentCall(message):null,text=invocation?.text??message?.content;
   if(typeof text!=='string'||!text.trim()||text.length>48000||result.choices[0].finish_reason==='length')throw Error('glm_incomplete_response');
   if(!needsDocument&&message?.tool_calls?.length)throw Error('work_unavailable_tool_requested');
   return {text,model:'glm-4-flash-250414',usage:result.usage,invocation};
  }
  const nativeBody={taskId:stage==='review'?hash(id+':review:'+payload.round+(payload.protocolAttempt?':'+payload.protocolAttempt:'')):id,stage,...payload,timeoutMs:Math.min(90000,deadline-Date.now())};
  if(Buffer.byteLength(JSON.stringify(nativeBody))>160000)throw Error('work_context_limit');
  const value=await nativeJSON('/ziwei/web/work/turn',{method:'POST',signal:AbortSignal.timeout(Math.min(100000,deadline-Date.now())),headers:{'Content-Type':'application/json'},body:JSON.stringify(nativeBody)});
  record(usageId,value);return parseJSON(value.text);
 };
 const fail=(id,e)=>{db.prepare("UPDATE usage SET status='unknown' WHERE task=? AND status='reserved'").run(id);state(id,'failed',String(e.message).slice(0,160));append('system','任务未完成：'+String(e.message).slice(0,160),{taskId:id,stage:'failed'});};
 const correctionInstruction='上一次审核命令或正文未通过程序校验。不能将空参数当成通过，不能直接放行需要修正的旧稿。若选择 work_document_create，必须在 toolCall.arguments.text 中给出完整修订正文（非说明、摘要或代码），保留用户指定的页面结构；禁止省略 text 或返回空对象。无法可靠修正则 approved:false 并说明原因。本次只纠正审核命令和正文，不再委派白鸦。若给出了 validationError.content，必须逐页满足其页数、汉字计数范围；页内表格文字也计数，可把时间表移到另一页但必须保留总页数。不能直接交付不合格旧稿。';
 const chatReviewInstruction='本轮选择的是聊天：只审核并给出自然的纯文本回复，不生成文件，不要求用户阅读文档，不调用 work_document_create。审核通过时返回 approved:true、message 为最终回复、toolCall:{name:"work_document_deliver",arguments:{}}；可用 messages 分段。不通过则 approved:false 并给出具体修订意见。';
 const contentCheck=(c,text)=>['ppt','bundle'].includes(catalog(c.tool)?.kind)?requirements.inspect(c.context,text):{rule:null,issues:[]};
 const commandProblem=(r,c)=>reviewProblem(r,c.tool)||r.approved&&contentCheck(c,r.toolCall.name==='work_document_create'?r.toolCall.arguments.text:c.draft).issues.length&&'work_content_requirements_failed'||null;
 async function reviewDraft(id,c,deadline,recovery=false){
  const tools=[{name:'work_document_deliver',description:'仅在审核通过时发布本任务的已检查工作草稿；聊天任务交付文本。',parameters:{type:'object',properties:{},additionalProperties:false}}];
  if(c.tool!=='auto')tools.push({name:'work_document_create',description:'知微可亲自修订完整正文并生成已授权格式的最终文件。必须传 arguments:{text:完整修订正文}，不得传空参数。',parameters:documentTool().function.parameters});
  const payload={task:c.context,draft:c.draft,tool:c.tool,round:c.round,
   revisionBudget:{maxRounds:LIMITS.maxRevisionRounds,remainingRounds:recovery?0:LIMITS.maxRevisionRounds-c.round,finalReview:!!recovery||c.round===LIMITS.maxRevisionRounds},
   reviewInstruction:recovery?correctionInstruction:c.round===LIMITS.maxRevisionRounds?'这是本任务最后一次模型审核，不能再委派白鸦。若草稿有问题且能根据现有资料修正，请亲自调用 work_document_create，在 arguments.text 返回完整修订正文，不能返回空参数。逐项核对用户硬性要求；有指定PPT页数时保留相应页标题结构，不在页标题前增加独立说明段。若缺资料或无法可靠修正，仍返回 approved:false，不能放行错误草稿。':'审核用户要求及实际文件回执；可直接修订，或在剩余轮次内要求白鸦修订。直接修订时 work_document_create 的 arguments.text 必须是完整修订正文，不得省略。',
   inspection:{files:c.manifest,visualChecked:false},tools,...(recovery?{protocolAttempt:recovery==='content'?'content-repair-1':'resume-1'}:{}),...(c.contentRepair?{validationError:{content:contentCheck(c,c.draft)},reviewInstruction:correctionInstruction}:{})};
  if(c.tool==='auto')payload.reviewInstruction=chatReviewInstruction;
  let review=await call(id,'review',payload,deadline),problem=commandProblem(review,c),protocolCorrection=false;
  // One explicit protocol correction only. It consumes the SAME task's calls,
  // daily budget and deadline; transport failures are never silently retried.
  if(problem&&!recovery&&task(id).calls<LIMITS.callsPerTask){
   protocolCorrection=true;
   review=await call(id,'review',{...payload,protocolAttempt:'repair-1',draft:problem==='work_content_requirements_failed'&&review.toolCall.name==='work_document_create'?review.toolCall.arguments.text:c.draft,revisionBudget:{...payload.revisionBudget,remainingRounds:0,finalReview:true},reviewInstruction:c.tool==='auto'?chatReviewInstruction:correctionInstruction,validationError:{code:problem,content:problem==='work_content_requirements_failed'?contentCheck(c,review.toolCall.name==='work_document_create'?review.toolCall.arguments.text:c.draft):undefined,tool:review?.toolCall?.name==='work_document_create'?'work_document_create':'invalid_command',missingText:review?.toolCall?.name==='work_document_create'&&typeof review?.toolCall?.arguments?.text!=='string'}},deadline);
   problem=commandProblem(review,c);
  }
  if(problem)throw Error(problem);return {review,protocolCorrection};
 }
 async function deliver(id,c,review,started){
  let artifacts=c.artifacts,manifest=c.manifest;
  if(review.toolCall.name==='work_document_create')({artifacts,manifest}=await generate(id,'ziwei',c.tool,review.toolCall.arguments.text,started));
  if(c.tool!=='auto')permit(c.tool);
  // Publication and the delivery message commit together, or neither is visible.
  db.exec('BEGIN IMMEDIATE');try{
   for(const aid of artifacts){const a=files.get(aid);if(a.taskId!==id||a.published!==false)throw Error('work_draft_unavailable');db.prepare('UPDATE files SET data=? WHERE id=?').run(JSON.stringify({...a,published:true}),aid);}
   receipt(id,'ziwei','work_document_deliver',{files:artifacts});
   const delivered=bubbles('ziwei',review.messages||review.message,{taskId:id,stage:'delivered'}),final=delivered.at(-1);
   if(artifacts.length){const extra=JSON.parse(db.prepare('SELECT extra FROM messages WHERE id=?').get(final.id).extra);extra.attachments=artifacts;db.prepare('UPDATE messages SET extra=? WHERE id=?').run(JSON.stringify(extra),final.id);}
   const prior=JSON.parse(task(id).result||'{}');
   db.prepare('UPDATE tasks SET result=? WHERE id=?').run(JSON.stringify({messageId:final.id,attachments:artifacts,reviewRecoveryAttempts:prior.reviewRecoveryAttempts||0,contentRepairAttempts:prior.contentRepairAttempts||0,reviewCheckpoint:{...c,draft:review.toolCall.name==='work_document_create'?review.toolCall.arguments.text:c.draft,artifacts,manifest},contentInspection:contentCheck(c,review.toolCall.name==='work_document_create'?review.toolCall.arguments.text:c.draft)}),id);state(id,'completed');db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const resumeCheckpoint=t=>{
  if(!t||t.state!=='failed'||t.day!==day()||!['invalid_work_tool_arguments','invalid_hermes_review','work_coordinator_tool_call_required','work_content_requirements_failed'].includes(t.error)||t.calls>=LIMITS.callsPerTask)return null;
  const prior=JSON.parse(t.result||'{}');if(prior.reviewRecoveryAttempts)return null;
  let c=prior.reviewCheckpoint;
  // Compatibility for drafts saved before checkpoints existed: only an explicit
  // text-only Work request can be reconstructed. No private chat or inferred data.
  if(!c){
   const messages=all().filter(m=>m.taskId===t.id),u=messages.find(m=>m.role==='user'),draft=messages.filter(m=>m.role==='glm'&&m.stage==='draft').at(-1);
   const row=db.prepare("SELECT result FROM tool_runs WHERE task=? AND agent='glm' AND name='work_document_create' AND status='completed' ORDER BY rowid DESC LIMIT 1").get(t.id),r=row?JSON.parse(row.result):null;
   if(!u||u.deleted||u.replyTo||u.attachments?.length||!draft||draft.deleted||!r?.files?.length||!r.tool)return null;
   c={context:u.text,draft:draft.text,tool:r.tool,round:Math.max(0,messages.filter(m=>m.role==='glm'&&m.stage==='draft').length-1),artifacts:r.files.map(f=>f.id),manifest:r.files};
  }
  if(!c||typeof c.context!=='string'||typeof c.draft!=='string'||!Array.isArray(c.artifacts)||!c.artifacts.length||!c.artifacts.every(aid=>{const f=fileStore.attachment(aid);return f?.taskId===t.id&&f.published===false;}))return null;
  return c;
 };
 const canRepair=t=>{if(t.state!=='completed'||t.calls>=LIMITS.callsPerTask)return false;const r=JSON.parse(t.result||'{}'),u=all().find(m=>m.role==='user'&&m.taskId===t.id);return !r.contentRepairAttempts&&!!u&&!u.deleted&&['ppt','bundle'].includes(catalog(r.reviewCheckpoint?.tool||u.tool)?.kind)&&!!requirements.contract(u.text)&&!!r.attachments?.some(a=>fileStore.attachment(a)?.name.endsWith('.docx'));};
 async function resumeReview(id,c){
  // User-triggered recovery has one 90-second review window, no new plan/GLM,
  // no task-quota reset, no counter reset and no automatic retry on restart.
  const started=Date.now();try{
   state(id,'reviewing');permit(c.tool);const {review}=await reviewDraft(id,c,started+90000,c.contentRepair?'content':true);
   if(!review.approved){append('ziwei',review.message,{taskId:id,stage:'changes_requested',round:c.round});state(id,'needs_revision');return;}
   await deliver(id,c,review,started);
  }catch(e){fail(id,e);}
 }
 async function run(id,body,user){
  const started=Date.now(),deadline=started+LIMITS.timeoutMs;
  try{
   state(id,'planning');
   let context=body.text;
   if(body.replyTo){const q=all().find(x=>x.id===body.replyTo);if(q)context+='\n引用 Work 消息：'+q.text.slice(0,2000);}
   for(const aid of body.attachments||[]){const a=files.get(aid),file=path.join(files.dir,aid);const doc=await extract(file,a.name);let text=doc?.text;if(!text&&a.mime==='text/plain')text=fs.readFileSync(file,'utf8');context+='\n附件 '+a.name+'：'+(text?text.slice(0,3500):'已保存，当前模型无法读取此格式的内容。');}
   if(context.length>7000)context=context.slice(0,6900)+'\n[资料超过读取上限，附件未完整读取。]';
   const available=toolRows().filter(t=>t.enabled&&t.authorized).map(t=>({id:t.id,name:t.name,kind:t.kind}));
   const plan=await call(id,'plan',{task:context,tool:body.tool,availableTools:body.tool==='auto'?[]:available,...(body.tool==='auto'?{mode:'chat',instruction:'本轮为三人群聊，不生成文件。仍按 plan 协议返回 work_delegate，arguments.tool 必须为 auto，instruction 委派白鸦作纯文本回复；不要把聊天改成文档任务。'}:{})},deadline);
   const delegation=coordinatorCall(plan,'work_delegate');
   if(typeof plan.message!=='string'||typeof delegation.instruction!=='string'||!delegation.instruction.trim())throw Error('invalid_hermes_plan');
   // The selector labels auto as 聊天; file permission is not per-message consent.
   const selected=body.tool;
   if(selected!=='auto')permit(selected);
   receipt(id,'ziwei','work_delegate',{tool:selected});
   bubbles('ziwei',plan.messages||plan.message.slice(0,3000),{taskId:id,stage:'delegated'});state(id,'executing');
   let feedback='';
   for(let round=0;round<=LIMITS.maxRevisionRounds;round++){
   state(id,'executing');
   const executed=await call(id,'execute',{task:context,instruction:delegation.instruction.slice(0,4000),format:selected,feedback,round},deadline);
   let artifacts=[],manifest=[];
   if(selected!=='auto'){
    state(id,'generating');({artifacts,manifest}=await generate(id,'glm',selected,executed.text,started,executed.invocation.callId));
    receipt(id,'system','work_document_inspect',{files:manifest});
   }
   bubbles('glm',executed.text,{taskId:id,stage:'draft'});state(id,'reviewing');
   const checkpoint={context,draft:executed.text,tool:selected,round,artifacts,manifest};
   db.prepare('UPDATE tasks SET result=? WHERE id=?').run(JSON.stringify({reviewCheckpoint:checkpoint,reviewRecoveryAttempts:0}),id);
   const {review,protocolCorrection}=await reviewDraft(id,checkpoint,deadline);
   if(!review.approved){append('ziwei',review.message,{taskId:id,stage:'changes_requested',round});if(!protocolCorrection&&round<LIMITS.maxRevisionRounds&&review.requiresUser!==true){feedback=review.message.slice(0,3000);continue;}state(id,'needs_revision');return;}
   await deliver(id,checkpoint,review,started);return;
   }
  }catch(e){fail(id,e);}
 }
 async function handle(req,res,pathname,readBody,json){
  if(req.method==='GET'&&pathname==='/api/work/runtime'){
   try{return json(res,200,{native:await nativeJSON('/ziwei/web/work/status',{signal:AbortSignal.timeout(50000)}),glmConfigured:!!process.env.ZHIPU_API_KEY});}
   catch(e){return json(res,502,{error:e.message});}
  }
  if(req.method==='GET'&&pathname==='/api/work/messages')return json(res,200,{data:all(),files:db.prepare('SELECT data FROM files').all().map(x=>JSON.parse(x.data)).filter(x=>x.published!==false),tasks:db.prepare('SELECT * FROM tasks ORDER BY created DESC LIMIT 100').all().map(t=>({...t,canResumeReview:!!resumeCheckpoint(t),canRepairDelivery:canRepair(t)})),usage:usageRows(),budget:budget(),tools:toolRows(),toolRuns:db.prepare('SELECT * FROM tool_runs ORDER BY rowid').all().map(x=>({...x,result:JSON.parse(x.result)})),limits:LIMITS,configured:{glm:!!process.env.ZHIPU_API_KEY,hermes:client.configured()},costNotice:'费用按输入 ¥10/百万 Token、输出 ¥20/百万 Token 的配置上界估算；不是实际账单。按次预留，已报告用量按估算扣减，未知用量与中断保留预留额度。'});
  if(req.method==='GET'&&pathname==='/api/work/tools')return json(res,200,{data:toolRows()});
  if(pathname==='/api/work/attachments'&&req.method==='POST'){const a=await files.upload(req);return json(res,201,a);}
  const fileRoute=/^\/api\/work\/attachments\/([a-f0-9-]{36})$/.exec(pathname);
  if(fileRoute&&['GET','HEAD'].includes(req.method)){if(fileStore.attachment(fileRoute[1])?.published===false)return json(res,404,{error:'not_found'});return files.serve(req,res,fileRoute[1]);}
  if(pathname==='/api/work/tools/register'&&req.method==='POST'){
   const b=await readBody(req,4096);if(!b||!['word','ppt','pdf','excel','bundle'].includes(b.kind)||typeof b.name!=='string'||!b.name.trim()||b.name.length>40)return json(res,400,{error:'unsupported_tool_registration'});
   const id='tool-'+crypto.randomUUID();db.prepare('INSERT INTO tools VALUES(?,?,?,1,0,0,?)').run(id,b.kind,b.name,JSON.stringify({title:'工作成果'}));return json(res,201,{id});
  }
  if(pathname==='/api/work/tools/configure'&&req.method==='POST'){
   const b=await readBody(req,4096),t=catalog(b.id);if(!t)return json(res,404,{error:'tool_not_found'});
   if(t.revision!==b.revision)return json(res,409,{error:'tool_revision_conflict'});
   const title=b.title??JSON.parse(t.config).title;if(typeof title!=='string'||!title.trim()||title.length>80||/[\x00-\x1f/\\]/.test(title)||b.authorized!==undefined&&typeof b.authorized!=='boolean'||b.enabled!==undefined&&typeof b.enabled!=='boolean')return json(res,400,{error:'invalid_tool_configuration'});
   db.prepare('UPDATE tools SET enabled=?,authorized=?,config=?,revision=revision+1 WHERE id=? AND revision=?').run(Number(b.enabled??!!t.enabled),Number(b.authorized??!!t.authorized),JSON.stringify({title}),b.id,b.revision);return json(res,200,{data:toolRows()});
  }
  if(pathname==='/api/work/action'&&req.method==='POST'){
   const b=await readBody(req,4096);if(b.action==='poke'&&['ziwei','glm','user'].includes(b.target)){append('system','你拍了拍'+({ziwei:'知微',glm:'白鸦',user:'自己'}[b.target]),{kind:'poke'});return json(res,200,{ok:true});}
   const m=all().find(x=>x.id===b.id);if(!m)return json(res,404,{error:'message_not_found'});
   if(!['favorite','unfavorite','delete','restore'].includes(b.action))return json(res,400,{error:'invalid_action'});
   const extra=JSON.parse(db.prepare('SELECT extra FROM messages WHERE id=?').get(b.id).extra);extra[b.action.includes('favorite')?'favorite':'deleted']=['favorite','delete'].includes(b.action);db.prepare('UPDATE messages SET extra=? WHERE id=?').run(JSON.stringify(extra),b.id);return json(res,200,{ok:true});
  }
  if(pathname==='/api/work/repair-delivery'&&req.method==='POST'){
   const b=await readBody(req,1024),t=typeof b?.taskId==='string'?task(b.taskId):null;
   if(!t||!canRepair(t))return json(res,409,{error:'work_delivery_not_repairable'});
   const prior=JSON.parse(t.result),u=all().find(m=>m.role==='user'&&m.taskId===t.id),selected=prior.reviewCheckpoint?.tool||u.tool;
   try{permit(selected);}catch{return json(res,403,{error:'tool_permission_denied'});}
   let c=prior.reviewCheckpoint;
   if(!c){
    if(u.replyTo||u.attachments?.length)return json(res,409,{error:'work_review_context_unavailable'});
    const a=prior.attachments.map(id=>fileStore.attachment(id)).find(a=>a?.taskId===t.id&&a.published===true&&a.name.endsWith('.docx'));
    if(!a)return json(res,409,{error:'work_draft_unavailable'});
    const doc=await extract(path.join(files.dir,a.id),a.name);
    if(!doc?.text||doc.truncated)return json(res,409,{error:'work_review_context_unavailable'});
    // Read the delivered document, never substitute the rejected GLM draft.
    const start=doc.text.search(/^第1页[^\n]*$/m);if(start<0)return json(res,409,{error:'work_review_context_unavailable'});
    c={context:u.text,draft:doc.text.slice(start).replace(/^(第\d+页[^\n]*)$/gm,'## $1'),tool:selected,round:0,artifacts:[],manifest:prior.attachments.map(id=>{const f=fileStore.attachment(id);return {id,name:f.name,...f.inspection};})};
   }
   const check=contentCheck(c,c.draft);if(!check.issues.length)return json(res,200,{checked:true,inspection:check});
   if(!client.configured())return json(res,503,{error:'hermes_not_configured'});
   c={...c,contentRepair:true};
   db.exec('BEGIN IMMEDIATE');try{
    const current=task(t.id);if(current.state!=='completed'||JSON.parse(current.result).contentRepairAttempts)throw Error('work_delivery_not_repairable');
    if(db.prepare("SELECT 1 FROM tasks WHERE state IN ('queued','planning','executing','reviewing','generating')").get())throw Error('work_busy');
    if(budget().remaining+1e-9<2||dailyModelCalls()>=LIMITS.dailyCalls)throw Error('work_daily_limit');
    db.prepare('UPDATE tasks SET result=? WHERE id=?').run(JSON.stringify({...prior,reviewCheckpoint:c,contentRepairAttempts:1,contentInspection:check}),t.id);state(t.id,'queued');
    append('ziwei','程序检查发现已交付正文未满足明确的页数或字数要求，将由知微按检查结果修订一次。保留原稿与费用记录，不重新调用白鸦。',{taskId:t.id,stage:'content_repair'});db.exec('COMMIT');
    setImmediate(()=>void resumeReview(t.id,c));return json(res,202,{task:task(t.id),inspection:check});
   }catch(e){db.exec('ROLLBACK');return json(res,429,{error:e.message});}
  }
  if(pathname==='/api/work/resume-review'&&req.method==='POST'){
   const b=await readBody(req,1024);if(typeof b?.taskId!=='string')return json(res,400,{error:'invalid_work_task'});
   const t=task(b.taskId);if(!t)return json(res,404,{error:'work_task_not_found'});
   if(t.state==='completed')return json(res,200,{task:t,replayed:true});
   const c=resumeCheckpoint(t);if(!c)return json(res,409,{error:'work_review_not_resumable'});
   try{permit(c.tool);}catch{return json(res,403,{error:'tool_permission_denied'});}
   if(!client.configured())return json(res,503,{error:'hermes_not_configured'});
   db.exec('BEGIN IMMEDIATE');try{
    if(db.prepare("SELECT 1 FROM tasks WHERE state IN ('queued','planning','executing','reviewing','generating')").get())throw Error('work_busy');
    if(budget().remaining+1e-9<2||dailyModelCalls()>=LIMITS.dailyCalls)throw Error('work_daily_limit');
    db.prepare('UPDATE tasks SET result=? WHERE id=?').run(JSON.stringify({reviewCheckpoint:c,reviewRecoveryAttempts:1}),t.id);state(t.id,'queued');
    append('ziwei','从已保存的白鸦草稿继续审核；本次只纠正审核命令，不重新委派。原任务调用上限和今日费用限制继续生效。',{taskId:t.id,stage:'review_resumed'});db.exec('COMMIT');
    setImmediate(()=>void resumeReview(t.id,c));return json(res,202,{task:task(t.id)});
   }catch(e){db.exec('ROLLBACK');return json(res,429,{error:e.message});}
  }
  if(pathname!=='/api/work/send'||req.method!=='POST')return json(res,404,{error:'not_found'});
  const b=await readBody(req,16000);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>4000||!Array.isArray(b.attachments||[])||(b.attachments||[]).length>4||typeof b.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(b.requestId))return json(res,400,{error:'invalid_work_message'});
  if(b.tool!=='auto'){try{permit(b.tool);}catch{return json(res,403,{error:'tool_permission_denied'});}}
  for(const id of b.attachments||[])files.get(id);
  const digest=hash(JSON.stringify(b)),prior=task(b.requestId);if(prior)return json(res,prior.digest===digest?200:409,prior.digest===digest?{task:prior,replayed:true}:{error:'work_idempotency_conflict'});
  if(!process.env.ZHIPU_API_KEY||!client.configured())return json(res,503,{error:!process.env.ZHIPU_API_KEY?'glm_not_configured':'hermes_not_configured'});
  db.exec('BEGIN IMMEDIATE');
  try{
   if(db.prepare("SELECT 1 FROM tasks WHERE state IN ('queued','planning','executing','reviewing','generating')").get())throw Error('work_busy');
   const today=db.prepare('SELECT COALESCE(SUM(calls),0) calls,COUNT(*) n FROM tasks WHERE day=?').get(day());
   if(budget().remaining+1e-9<2||dailyModelCalls()>=LIMITS.dailyCalls||today.n>=LIMITS.dailyTasks)throw Error('work_daily_limit');
   const at=new Date().toISOString();db.prepare('INSERT INTO tasks(id,digest,state,created,updated,day,reserved) VALUES(?,?,?,?,?,?,?)').run(b.requestId,digest,'queued',at,at,day(),0);
   const user=append('user',b.text,{attachments:b.attachments||[],replyTo:b.replyTo||null,taskId:b.requestId,tool:b.tool});db.exec('COMMIT');
   setImmediate(()=>void run(b.requestId,b,user));return json(res,202,{task:task(b.requestId),user});
  }catch(e){db.exec('ROLLBACK');return json(res,429,{error:e.message});}
 }
 return {handle,close:()=>db.close()};
}
module.exports={createWorkService,LIMITS};
