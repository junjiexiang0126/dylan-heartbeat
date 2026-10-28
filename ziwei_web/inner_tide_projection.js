'use strict';
// Read-only projection for the existing single-owner, authenticated web app.
// Never forward raw state, thought pools, memory buckets, awareness or credentials.
const fs=require('node:fs/promises'),path=require('node:path');
const KEYS=['possess','monitor','share','libido','curiosity','boredom','duty','reflection','grieve','anger','favored'];
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
const unit=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)?v.trim():null;
function projectState(state,{observedAt}={}){
 if(!state||typeof state!=='object'||Array.isArray(state)||!date(observedAt))throw Error('invalid_state');
 const drives=KEYS.filter(key=>unit(state.drives?.[key])).map(key=>({key,value:state.drives[key]}));
 const trend=(Array.isArray(state.emotionJournal)?state.emotionJournal:[]).slice(-96).filter(x=>date(x?.at)&&unit(x.valence)).map(x=>({at:x.at,valence:2*x.valence-1,originalValence:x.valence,label:text(x.label,32)}));
 const e=state.emotion||{};
 return {source:'xinchao_public_projection',observedAt,revision:Number.isSafeInteger(state.revision)?state.revision:null,
  drives,emotion:{label:text(e.label,32),...(unit(e.valence)?{valence:e.valence}:{}),...(unit(e.arousal)?{arousal:e.arousal}:{}),updatedAt:date(e.updatedAt)},
  trend,valenceScale:'centered_from_zero_to_one',recordSource:'xinchao_state.emotionJournal'};
}
function projectOwnerDreams(state,{observedAt}={}){
 if(!date(observedAt))throw Error('invalid_state');
 const seen=new Set(),items=[];
 for(const d of (Array.isArray(state?.recentDreams)?state.recentDreams:[]).slice(-80)){
  if(!d||d.private===true||d.shared===false||['private','internal','never_share'].includes(d.visibility)||!text(d.id,120)||!date(d.createdAt)||seen.has(d.id))continue;
  const dream=text(d.dream,4000),summary=text(d.summary,600),residue=text(d.residue,1200);
  if(!dream&&!summary&&!residue)continue;
  seen.add(d.id);items.push({id:d.id,createdAt:d.createdAt,visibility:'owner',source:['model','rules'].includes(d.source)?d.source:'unknown',...(text(d.title,80)?{title:text(d.title,80)}:{}),...(dream?{dream}:{}),...(summary?{summary}:{}),...(residue?{residue}:{})});
 }
 return {source:'xinchao_owner_dream_projection',audience:'authenticated_owner',available:true,observedAt,items:items.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,20)};
}
function createInnerTideProjection({stateDir=process.env.ZIWEI_XINCHAO_STATE_DIR||'/xinchao-state'}={}){
 async function read(){
  const file=await fs.open(path.join(stateDir,'state.json'),'r');
  try{const stat=await file.stat();if(stat.size>2*1024*1024)throw Error('state_too_large');return {state:JSON.parse(await file.readFile('utf8')),observedAt:stat.mtime.toISOString()};}finally{await file.close();}
 }
 return {async get(kind){const {state,observedAt}=await read();if(kind==='snapshot')return projectState(state,{observedAt});if(kind==='dreams')return projectOwnerDreams(state,{observedAt});throw Error('unknown_projection');}};
}
module.exports={projectState,projectOwnerDreams,createInnerTideProjection};
