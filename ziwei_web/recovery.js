'use strict';
const crypto=require('node:crypto');
function textOf(m){return typeof m.content==='string'?m.content:null}
function classify(record,messages){
 if(record.state==='completed')return {state:'completed',retrySafe:false};
 if(!Number.isSafeInteger(record.baseline))return {state:'uncertain',reason:'missing_baseline',retrySafe:false};
 const rows=messages.filter(m=>Number.isSafeInteger(m.id)&&m.id>record.baseline).sort((a,b)=>a.id-b.id);
 const users=rows.filter(m=>m.role==='user'&&textOf(m)!==null&&crypto.createHash('sha256').update(textOf(m)).digest('hex')===record.hash);
 if(users.length!==1)return {state:'uncertain',reason:'user_not_unique',retrySafe:false};
 const next=rows.find(m=>m.id>users[0].id&&m.role==='user');
 const replies=rows.filter(m=>m.id>users[0].id&&(!next||m.id<next.id)&&m.role==='assistant'&&textOf(m));
 if(replies.length!==1)return {state:'uncertain',reason:'reply_not_unique',retrySafe:false};
 return {state:'history_confirmed',userMessageId:users[0].id,assistantMessageId:replies[0].id,retrySafe:false};
}
module.exports={classify};
