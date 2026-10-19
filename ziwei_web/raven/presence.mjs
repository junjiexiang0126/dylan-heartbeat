export const PRESENCE_TTL=30*60*1000;
export const STATE_ACTIONS=Object.freeze({'在工作':'Work','在休息':'Rest','在思考':'Think','在想你':'Affection'});
export function resolvePresence(value,now=Date.now()){
 const at=typeof value?.updatedAt==='string'?Date.parse(value.updatedAt):NaN;
 if(value?.source!=='ziwei'||!Object.hasOwn(STATE_ACTIONS,value.state)||!Number.isFinite(at))return {mode:'Idle',state:null,updatedAt:null,stale:false};
 const stale=value.stale===true||now-at>=PRESENCE_TTL;
 return {mode:stale?'Stale':STATE_ACTIONS[value.state],state:value.state,updatedAt:value.updatedAt,stale};
}
