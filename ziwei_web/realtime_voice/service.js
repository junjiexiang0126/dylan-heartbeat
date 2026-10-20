'use strict';
const crypto=require('node:crypto');
const {HermesClient}=require('../hermes_client');
const {LiveKitParticipant}=require('./livekit_participant');
const {HermesVoiceAdapter}=require('./hermes_adapter');
const {VoiceRoomWorker}=require('./room_worker');
const {ZhipuASR,MiniMaxTTS,VoiceQuota}=require('./providers');
const {atomicWrite,load}=require('../home_store');
const path=require('node:path');
function livekitURL(env){
 try{const u=new URL(env.LIVEKIT_URL);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
  if(u.protocol==='wss:'||(env.NODE_ENV!=='production'&&env.ZIWEI_VOICE_LOCAL_TEST==='true'&&u.protocol==='ws:'&&['localhost','127.0.0.1'].includes(u.hostname)))return u.origin;
 }catch{}return null;
}
class RealtimeVoiceService {
 constructor({env=process.env,client=new HermesClient(env),dataDir,createWorker,now=Date.now}={}){
  this.env=env;this.client=client;this.createWorker=createWorker;this.now=now;this.calls=new Map();this.url=livekitURL(env);
  this.rateFile=dataDir?path.join(dataDir,'voice-admission.json'):null;
  this.admissions=this.rateFile?load(this.rateFile,[]):[];
  this.timer=setInterval(()=>{for(const c of this.calls.values())if(this.now()-c.touched>35000||this.now()-c.started>15*60000||!c.authorized())void this.end(c.id,c.owner).catch(()=>{});},1000);this.timer.unref();
 }
 ready(){return !this.blocked&&this.env.ZIWEI_REALTIME_VOICE_ENABLED==='true'&&!!this.url&&!!this.env.LIVEKIT_API_KEY&&this.env.LIVEKIT_API_SECRET?.length>=16&&!!this.env.ZHIPU_API_KEY&&!!this.env.MINIMAX_API_KEY&&!!this.env.MINIMAX_VOICE_ID&&this.client.configured();}
 async start(owner,authorized=()=>true){
  if(!this.ready())throw Error('realtime_voice_not_configured');if(this.calls.size)throw Error('voice_busy');
  this.admissions=this.admissions.filter(t=>Number.isFinite(t)&&t>this.now()-3600000);if(this.admissions.length>=12)throw Error('voice_admission_limit');
  const id=crypto.randomUUID(),room='ziwei-'+id,user='user-'+id;
  const c={id,room,owner,authorized,started:this.now(),touched:this.now(),closed:false};this.calls.set(id,c);
  try{
   this.admissions.push(this.now());if(this.rateFile)atomicWrite(this.rateFile,this.admissions);
   const {AccessToken,TrackSource}=require('livekit-server-sdk');
   const tokenFor=async(identity,isAgent)=>{const t=new AccessToken(this.env.LIVEKIT_API_KEY,this.env.LIVEKIT_API_SECRET,{identity,ttl:300});
    t.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:isAgent,canPublishSources:[TrackSource.MICROPHONE]});return t.toJwt();};
   const token=await tokenFor(user,false),agentToken=await tokenFor('ziwei-'+id,true);
   if(c.closed)throw Error('voice_start_cancelled');
   const onEvent=e=>{if(e.code==='voice_stop_unconfirmed')this.blocked=true;void c.participant?.sendEvent(e).catch(()=>{});if(e.type==='call.error'||e.type==='call.ended')void this.end(id,owner).catch(()=>{});};
   if(this.createWorker)c.worker=await this.createWorker({onEvent,room,user});
   else{
    const quota=new VoiceQuota();
    c.participant=new LiveKitParticipant({url:this.url,token:agentToken,userIdentity:user,onFailure:()=>{void this.end(id,owner).catch(()=>{});},onControl:(kind,value)=>{
     if(kind==='mute')c.worker?.setMuted(value);
     if(kind==='hangup')void this.end(id,owner).catch(()=>{});
     if(kind==='reconnecting'){c.worker?.setMuted(true);c.worker?.interrupt();}
     if(kind==='reconnected'){/* browser heartbeat restores the actual mute state */}
    }});
    c.worker=new VoiceRoomWorker({participant:c.participant,pcmFrames:true,onEvent,asr:new ZhipuASR({apiKey:this.env.ZHIPU_API_KEY,quota}),tts:new MiniMaxTTS({apiKey:this.env.MINIMAX_API_KEY,voiceId:this.env.MINIMAX_VOICE_ID,quota,endpoint:this.env.MINIMAX_TTS_ENDPOINT||undefined}),hermes:new HermesVoiceAdapter({client:this.client,onEvent})});
   }
   let timeout;const joining=Promise.resolve().then(()=>c.worker.start());
   try{await Promise.race([joining,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('voice_join_timeout')),15000);})]);}
   catch(e){if(e.message==='voice_join_timeout'){
    c.closed=true;void joining.then(()=>c.worker?.close()).catch(()=>{});
   }throw e;}finally{clearTimeout(timeout);}
   if(c.closed||!authorized())throw Error('voice_start_cancelled');
   return {url:this.url,token,room,identity:user,agentIdentity:'ziwei-'+id,callId:id,expiresIn:300};
  }catch(e){await this.end(id,owner);throw e;}
 }
 get(id,owner){const c=this.calls.get(id);if(!c||c.owner!==owner||c.closed)throw Error('voice_call_not_found');return c;}
 control(id,owner,{muted}){const c=this.get(id,owner);if(typeof muted!=='boolean')throw Error('voice_invalid_control');c.touched=this.now();c.worker.setMuted(muted);return {ok:true};}
 async end(id,owner){
  const c=this.calls.get(id);if(!c||c.owner!==owner)return;if(c.ending)return c.ending;c.closed=true;
  c.ending=Promise.resolve().then(async()=>{try{await c.worker?.close();await Promise.allSettled([...(c.worker?.inflight||[])]);}finally{this.calls.delete(id);}});return c.ending;
 }
 async close(){clearInterval(this.timer);await Promise.allSettled([...this.calls.values()].map(c=>this.end(c.id,c.owner)));}
}
module.exports={RealtimeVoiceService,livekitURL};
