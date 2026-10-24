'use strict';
// Web-only adapter for Ziwei's native APIs. Never edits or scans native files.
const {HermesClient}=require('./hermes_client'),{createHash}=require('node:crypto');
const digest=x=>createHash('sha256').update(x).digest('hex');
const {memoryView}=require('./memory_view');
const date=value=>{if(typeof value==='number')value=value<1e12?value*1000:value;return value!==null&&value!==undefined&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():null;};
function createRecords(){
 const client=new HermesClient();let cachedWork=null,pendingWork=null;
 async function work(){
  if(cachedWork&&Date.now()-cachedWork.at<5000)return cachedWork.value;
  if(pendingWork)return pendingWork;
  pendingWork=(async()=>{
   const data=[],errors=[],cursors=new Set(),started=Date.now();let cursor=null,more=false;
   for(let page=0;page<20;page++){if(Date.now()-started>9000){errors.push({source:'原生日志接口',code:'read_window_timeout'});break;}
    const value=await client.json('/ziwei/web/logs?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{signal:AbortSignal.timeout(Math.max(1,10000-(Date.now()-started)))});
    if(!Array.isArray(value.data)||value.data.length>100)throw Error('invalid_native_records');
    data.push(...value.data);for(const e of value.errors||[])errors.push({source:e.file||e.source||'原生日志接口',code:e.code||'source_unavailable'});
    more=value.has_more===true;if(!more)break;
    if(typeof value.next_cursor!=='string'||cursors.has(value.next_cursor)){errors.push({source:'原生日志接口',code:'pagination_incomplete'});break;}
    cursors.add(value.next_cursor);cursor=value.next_cursor;
   }
   if(more)errors.push({source:'原生日志接口',code:'window_limit'});
   return {data,errors};
  })().then(value=>{cachedWork={at:Date.now(),value};return value;}).finally(()=>pendingWork=null);
  return pendingWork;
 }
 return async(req,res,url)=>{
  function json(status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
  if(req.method!=='GET')return json(405,{error:'read_only'});
  const kind=url.pathname.slice('/api/records/'.length),q=url.searchParams.get('q')||'',category=url.searchParams.get('category')||'all',offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20),id=url.searchParams.get('id');
  if(!['diary','work','memory','artifact','impressions'].includes(kind))return json(404,{error:'not_found'});
  if([...url.searchParams.keys()].some(k=>!(kind==='impressions'?['limit','cursor','since']:['q','category','offset','limit','id']).includes(k))||url.search.length>2400||q.length>200||!Number.isSafeInteger(offset)||offset<0||offset>10000||!Number.isSafeInteger(limit)||limit<1||limit>50||!['all','user','self','protected','work','uncategorized','memory'].includes(category))return json(400,{error:'invalid_query'});
  try{
   if(kind==='impressions'){
    const qs=new URLSearchParams({limit:String(limit)});for(const key of ['cursor','since'])if(url.searchParams.has(key))qs.set(key,url.searchParams.get(key));
    const value=await client.json('/ziwei/web/impressions?'+qs,{signal:AbortSignal.timeout(15000)});
    if(!Array.isArray(value.data))throw Error('invalid_native_records');
    return json(200,{data:value.data,total:value.total,nextCursor:value.nextCursor??null,wake:value.wake??null,automatic:value.automatic===true,source:'hermes_native',readOnly:true,checkedAt:value.checkedAt||new Date().toISOString(),errors:value.errors||[]});
   }
   if(kind==='artifact'){
    // Only a future explicit, authenticated native artifact endpoint may serve
    // a download. No arbitrary path proxy and no inferred filesystem access.
    if(!id||id.length>1400)return json(400,{error:'invalid_id'});
    const r=await client.fetch('/ziwei/web/logs/artifact?id='+encodeURIComponent(id),{signal:AbortSignal.timeout(15000)});
    if(!r.ok)return json(r.status===404?404:503,{error:r.status===404?'record_not_found':'records_unavailable'});
    let size=0;const chunks=[];for await(const c of r.body){size+=c.length;if(size>20*1024*1024)throw Error('artifact_limit');chunks.push(c);}
    const disposition=r.headers.get('content-disposition')||'';
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':/^attachment; filename\*=UTF-8''[a-zA-Z0-9%_.!~*'()-]+$/.test(disposition)?disposition:'attachment; filename="artifact"'});return res.end(Buffer.concat(chunks));
   }
   if(kind==='diary'){
    // Native owns this contract and implementation. Missing endpoint remains
    // visibly unavailable; Web never manufactures diaries from chat replies.
    const value=await client.json('/ziwei/web/diary'+url.search,{signal:AbortSignal.timeout(15000)});
    if(id){if(typeof value.content!=='string')throw Error('invalid_native_records');return json(200,{...value,readOnly:true});}
    if(!Array.isArray(value.data))throw Error('invalid_native_records');
    return json(200,{...value,source:'hermes_native',readOnly:true,checkedAt:value.checkedAt||new Date().toISOString(),errors:value.errors||[],nextOffset:value.nextOffset??null});
   }
   let rows=[],errors=[];
   if(kind==='memory'){
    const value=await client.json('/ziwei/web/memory',{signal:AbortSignal.timeout(10000)});
    const view=memoryView(value);rows=view.rows;errors=view.errors;
    // 人格底稿（SOUL.md）以只读条目并列展示：读网页数据目录里的同步副本，不碰记忆、不可编辑。
    try{
     const fs=require("node:fs"),path=require("node:path");
     const personaPath=path.join(process.env.ZIWEI_WEB_DATA_DIR||"/webdata","persona.md");
     if(fs.existsSync(personaPath)){
      const text=fs.readFileSync(personaPath,"utf8"),st=fs.statSync(personaPath);
      const shadow=memoryView({files:[{name:"SOUL.md",entries:[{index:0,heading:"人格底稿",text}],protected:true,categories:["self","protected"],updated_at:st.mtime.toISOString()}],protected_files:["SOUL.md"]});
      for(const row of shadow.rows){row.title="人格底稿";row.source="SOUL.md（只读）";rows.push(row);}
      view.counts.self+=shadow.rows.length;view.counts.protected+=shadow.rows.length;
     }
    }catch(e){errors.push({source:"SOUL.md",code:"persona_unavailable"});}
    if(id){const row=rows.find(r=>r.id===id);return row?json(200,row):json(404,{error:'record_not_found'});}
    const counts=view.counts,protectedSources=view.protectedSources;
    const overview={files:value.files.map(f=>({name:f.name,chars:Number.isSafeInteger(f.chars)?f.chars:null,budget:Number.isSafeInteger(f.budget)?f.budget:null,updatedAt:date(f.updated_at)})),excerpt:view.rows.find(r=>r.sourceFile==='MEMORY.md')||null};
    rows=rows.filter(row=>category==='all'||category==='memory'&&row.sourceFile==='MEMORY.md'||row.categories.includes(category));
    if(q)rows=rows.filter(row=>[row.title,row.source,row.content].some(x=>x.toLocaleLowerCase().includes(q.toLocaleLowerCase())));
    rows.sort((a,b)=>(b.at||'').localeCompare(a.at||'')||a.sourceFile.localeCompare(b.sourceFile)||a.entryIndex-b.entryIndex);
    return json(200,{data:rows.slice(offset,offset+limit),total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,counts,protectedSources,overview,source:'hermes_native',readOnly:true,checkedAt:new Date().toISOString(),errors,unit:'entries'});
   }else{
    if(id)return json(404,{error:'record_not_found'});
    const value=await work();errors=value.errors;
    rows=value.data.map((row,index)=>{const briefing=row.kind==='briefing',audit=row.kind==='memory_audit';if(typeof row.body!=='string')throw Error('invalid_native_records');return {id:row.id||digest(JSON.stringify(row)+':'+index),title:row.title||(briefing?'自主简报':audit?'记忆维护':'工作记录'),source:row.source||(briefing?'workspace/briefings.jsonl':audit?'workspace/memory_operations.jsonl':'原生日志接口'),at:date(row.at),state:audit?(row.failed?'pending':'recorded'):row.failed?'failed':'recorded',basis:briefing?'agent_briefing':audit?'memory_audit':'agent_activity_record',preview:row.body,references:Array.isArray(row.refs)?row.refs.filter(x=>typeof x==='string'):[],opportunity:Number.isSafeInteger(row.opportunity)?row.opportunity:null,document:false};});
   }
   if(q)rows=rows.filter(row=>[row.title,row.source,row.content,row.preview].some(x=>typeof x==='string'&&x.toLocaleLowerCase().includes(q.toLocaleLowerCase())));
   rows.sort((a,b)=>(b.at||'').localeCompare(a.at||'')||a.id.localeCompare(b.id));
   return json(200,{data:rows.slice(offset,offset+limit),total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,source:'hermes_native',readOnly:true,checkedAt:new Date().toISOString(),errors,workLogWindow:kind==='work'?'Native API records; up to 20 pages of 100 records per refresh':null});
  }catch(e){const status=e.message==='hermes_http_404'?404:e.message==='hermes_http_409'?409:e.message==='hermes_http_400'?400:e.message==='hermes_http_413'?413:503;return json(status,{error:status===404?'record_not_found':status===409?'source_changing':status===413?'document_too_large':'records_unavailable'});}
 };
}
module.exports={createRecords};
