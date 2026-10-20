'use strict';
const crypto=require('node:crypto');
const {SSEParser}=require('../sse_parser');
// Uses the existing client's configured session and native identity/memory.
// No system prompt, alternate model, profile, or separate memory store is created.
class HermesVoiceAdapter {
 constructor({client,onEvent=()=>{},timeoutMs=90000}={}){this.client=client;this.onEvent=onEvent;this.timeoutMs=timeoutMs;this.busy=false;}
 async reply(text,{signal,onDelta}){
  if(this.busy)throw Error('voice_hermes_busy');this.busy=true;let runId,submitted=false,completed=false,sequence=-1,output='';
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]);
  try{
   deadline.throwIfAborted();
   // Keep submission alive long enough to learn run_id even when the user interrupts.
   // Once known, finally stops that exact run; never stop another chat run.
   submitted=true;runId=await this.client.submit('voice-'+crypto.randomUUID(),text);
   deadline.throwIfAborted();
   const r=await this.client.fetch('/v1/runs/'+runId+'/events?last_seq=0',{signal:deadline,headers:{Accept:'text/event-stream'}});
   if(!r.ok||!r.headers.get('content-type')?.includes('text/event-stream'))throw Error('voice_hermes_stream');
   let terminal=null,bytes=0;
   const parser=new SSEParser(({event:named,data})=>{
    if(!data||typeof data!=='object')return;
    if(Number.isInteger(data.seq)){if(data.seq<=sequence)return;sequence=data.seq;}
    const event=data.event||data.type||named;
    if(['message.delta','assistant.delta'].includes(event)&&typeof data.delta==='string'){
     output+=data.delta;if(output.length>8000)throw Error('voice_reply_limit');onDelta(data.delta);
    }else if(event==='approval.request')throw Error('voice_approval_required');
    else if(/^run\.(completed|cancelled|failed|interrupted)$/.test(event))terminal={...data,status:event.slice(4)};
   });
   for await(const c of r.body){deadline.throwIfAborted();bytes+=c.length;if(bytes>2*1024*1024)throw Error('voice_hermes_stream_limit');parser.feed(c);if(parser.buffer.length>128*1024)throw Error('voice_hermes_event_limit');if(terminal)break;}
   if(!terminal)terminal=await this.client.json('/v1/runs/'+runId,{signal:deadline});
   if(terminal.status!=='completed')throw Error('voice_hermes_incomplete');
   completed=true;
   if(typeof terminal.output==='string'&&terminal.output.startsWith(output)&&terminal.output.length>output.length){if(terminal.output.length>8000)throw Error('voice_reply_limit');onDelta(terminal.output.slice(output.length));}
  }finally{
   if(runId&&!completed){
    try{
     const stopSignal=AbortSignal.timeout(10000);
     await this.client.json('/v1/runs/'+runId+'/stop',{method:'POST',signal:stopSignal,headers:{'Content-Type':'application/json'},body:'{}'});
     for(;;){const state=await this.client.json('/v1/runs/'+runId,{signal:stopSignal});if(['completed','cancelled','failed','interrupted'].includes(state.status))break;await require('node:timers/promises').setTimeout(200,undefined,{signal:stopSignal});}
    }
    catch{this.onEvent({type:'call.error',code:'voice_stop_unconfirmed'});}
   }
   if(submitted&&!runId)this.onEvent({type:'call.error',code:'voice_stop_unconfirmed'});
   this.busy=false;
  }
 }
}
module.exports={HermesVoiceAdapter};
