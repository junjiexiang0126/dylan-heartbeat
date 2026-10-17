'use strict';
// Presentation only. Preserve native text/protection; never move or edit memory.
const {createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
const groups={user:['user','about_user','关于你','关于我','关于用户','个人资料'],self:['self','ziwei','about_ziwei','关于知微','自我记忆','自我认知'],protected:['protected','long_term','long-term','longterm','permanent','长期记忆','受保护记忆','核心记忆'],work:['work','working','work_memory','technical','工作记忆','技术记忆']};
const aliases=new Map(Object.entries(groups).flatMap(([group,names])=>names.map(n=>[n,group])));
function categories(value){return (Array.isArray(value)?value:[value]).flatMap(v=>typeof v==='string'&&aliases.has(v.toLowerCase().trim())?[aliases.get(v.toLowerCase().trim())]:[]);}
function nativeDate(value){if(typeof value==='number')value=value<1e12?value*1000:value;return value!==null&&value!==undefined&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():null;}
function memoryView(snapshot){
 if(!Array.isArray(snapshot.files))throw Error('invalid_native_records');
 const protectedNames=(snapshot.protected_files||[]).filter(x=>typeof x==='string'),rows=[],present=new Set();
 for(const file of snapshot.files){
  if(typeof file.name!=='string'||file.name.length>160||/[\x00-\x1f/\\]/.test(file.name)||!Array.isArray(file.entries))throw Error('invalid_native_records');
  present.add(file.name);const protectedIndices=new Set(Array.isArray(file.protected_entries)?file.protected_entries:[]);
  for(const [position,entry] of file.entries.entries()){
   if(typeof entry.text!=='string')throw Error('invalid_native_records');
   const index=Number.isSafeInteger(entry.index)?entry.index:position,heading=typeof entry.heading==='string'?entry.heading:entry.text.split('\n').find(x=>x.trim())?.replace(/^#+\s*/,'')||'原生记忆';
   const locked=entry.protected===true||file.protected===true||protectedNames.includes(file.name)||protectedIndices.has(index);
   const explicit=categories(entry.categories||entry.category),fileGroups=categories(file.categories||file.category),members=new Set(explicit.length?explicit:fileGroups);let basis=members.size?'后台分类标记':null;
   if(!members.size&&file.name==='USER.md'){members.add('user');basis='USER 原生来源';}
   // Compatibility for entries with clear original headings. Never infer a
   // topic from arbitrary body text, or equate MEMORY.md with protected memory.
   if(!members.size){
    if(/工作记忆|代码|编码|开发|编程|技术|部署|运维|工具链|工程|仓库|接口|\bAPI\b|\bRailway\b|数据库|系统架构/iu.test(heading)){members.add('work');basis='原文标题';}
    else if(/自我记忆|关于知微|自我认知|自我认识|人格|身份|我是谁|我的性格|我的名字|知微.*(?:自己|自我)|\bself\b|\bidentity\b/iu.test(heading)){members.add('self');basis='原文标题';}
   }
   if(locked){members.add('protected');basis=basis?basis+' / 后端保护标记':'后端保护标记';}
   if(!members.size){members.add('uncategorized');basis='后台未标明分类';}
   rows.push({id:Buffer.from(file.name+':'+index).toString('base64url'),title:heading,source:'memories/'+file.name,entryIndex:index,sourceFile:file.name,
    categories:[...members],classificationBasis:basis,protected:locked,content:entry.text,chars:Number.isSafeInteger(entry.chars)?entry.chars:[...entry.text].length,lines:entry.text.split(/\r?\n/).length,
    at:nativeDate(file.updated_at),savedAt:nativeDate(file.updated_at),revision:hash(entry.text),fileRevision:/^[a-f0-9]{64}$/.test(file.sha256)?file.sha256:null,readOnly:true});
  }
 }
 const counts=Object.fromEntries(['user','self','protected','work','uncategorized'].map(k=>[k,rows.filter(row=>row.categories.includes(k)).length]));
 return {rows,counts,protectedSources:protectedNames.filter(name=>!present.has(name)),errors:(snapshot.errors||[]).map(e=>({source:e.file||'原生记忆接口',code:e.code||'source_unavailable'}))};
}
module.exports={memoryView};
