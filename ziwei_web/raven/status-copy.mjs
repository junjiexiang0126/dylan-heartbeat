import lines from './state-lines.json' with {type:'json'};
import {resolvePresence} from './presence.mjs';
export function plainText(value,max){
 return typeof value==='string'?[...value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()].slice(0,max).join(''):'';
}
// Four fixed six-hour slots: stable across refreshes, no repeat within a Bangkok day.
// Local copy describes a scene; it is never presented as a quote published by Ziwei.
export function resolveStatusCopy(value,now=Date.now(),library=lines){
 const presence=resolvePresence(value,now);
 if(!presence.state)return {mood:'',note:'',moodSource:'none',noteSource:'none',slot:null};
 const key=presence.stale?'过期':presence.state,group=Object.hasOwn(library,key)?library[key]:null;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
 const date=Object.fromEntries(parts.map(p=>[p.type,p.value])),day=date.year+'-'+date.month+'-'+date.day,slot=Math.floor(Number(date.hour)/6);
 const notes=Array.isArray(group)?group:group?.notes;
 const offset=[...day].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
 const localNote=Array.isArray(notes)&&notes.length?plainText(notes[(offset+slot)%notes.length],60):'';
 const nativeNote=presence.stale?'':plainText(value?.note,60),nativeMood=presence.stale?'':plainText(value?.mood,24);
 return {note:nativeNote||localNote,mood:nativeMood||plainText(group?.mood,24),noteSource:nativeNote?'ziwei':localNote?'local':'none',moodSource:nativeMood?'ziwei':group?.mood?'local':'none',slot:day+':'+slot};
}
