'use strict';
class LiveKitCallTransport {
 constructor({sdk,request,onRemoteAudio=()=>{},onState=()=>{},onEvent=()=>{}}={}){
  if(!sdk?.Room||!sdk?.RoomEvent||typeof request!=='function')throw Error('livekit_client_required');
  Object.assign(this,{sdk,request,onRemoteAudio,onState,onEvent});this.room=null;this.closed=false;this.connected=false;this.muted=false;
 }
 async sync(){if(this.callId&&!this.closed)await this.request('/api/voice/control','POST',{callId:this.callId,muted:this.muted});}
 async connect(){
  if(this.closed||this.connecting)throw Error('call_already_started');this.connecting=true;
  try{
   const details=await this.request('/api/voice/livekit-token','POST',{});this.callId=details.callId;
   if(this.closed){await this.release();return false;}
   if(!/^wss:\/\//.test(details.url)&&!(/^ws:\/\/(localhost|127\.0\.0\.1):\d+$/.test(details.url)&&typeof location!=='undefined'&&['localhost','127.0.0.1'].includes(location.hostname)))throw Error('invalid_livekit_configuration');
   if(!details.token)throw Error('invalid_livekit_configuration');
   const room=this.room=new this.sdk.Room({adaptiveStream:true,dynacast:true,audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   room.on(this.sdk.RoomEvent.TrackSubscribed,(track,publication,participant)=>{if(!this.closed&&track.kind==='audio'&&(!details.agentIdentity||participant.identity===details.agentIdentity))this.onRemoteAudio({track,publication,participant});});
   room.on(this.sdk.RoomEvent.Disconnected,()=>{if(!this.closed){this.connected=false;this.onState('disconnected');void this.disconnect();}});
   if(this.sdk.RoomEvent.Reconnecting)room.on(this.sdk.RoomEvent.Reconnecting,()=>{this.connected=false;this.onState('reconnecting');});
   if(this.sdk.RoomEvent.Reconnected)room.on(this.sdk.RoomEvent.Reconnected,()=>{this.connected=true;void room.localParticipant.setMicrophoneEnabled(!this.muted).then(()=>this.sync()).catch(()=>this.disconnect());this.onState('connected');});
   if(this.sdk.RoomEvent.DataReceived)room.on(this.sdk.RoomEvent.DataReceived,(bytes,participant,_kind,topic)=>{
    if(topic!=='ziwei.voice'||participant?.identity!==details.agentIdentity||bytes.length>12000)return;
    try{this.onEvent(JSON.parse(new TextDecoder().decode(bytes)));}catch{}
   });
   await room.connect(details.url,details.token,{autoSubscribe:true});if(this.closed){await room.disconnect();return false;}
   this.connected=true;this.onState('connected');await room.startAudio?.();
   await room.localParticipant.setMicrophoneEnabled(!this.muted);await this.sync();
   if(this.callId)this.timer=setInterval(()=>{void this.sync().catch(()=>this.disconnect());},10000);
   return true;
  }catch(e){await this.disconnect();throw e;}
 }
 async setMuted(value){
  if(this.closed)return false;this.muted=Boolean(value);
  try{if(this.connected)await this.room.localParticipant.setMicrophoneEnabled(!this.muted);await this.sync();this.onState(this.muted?'muted':'unmuted');return true;}
  catch(e){await this.disconnect();throw e;}
 }
 async release(){const id=this.callId;this.callId=null;if(id)await this.request('/api/voice/end','POST',{callId:id}).catch(()=>{});}
 async disconnect(){
  if(this.closed)return;this.closed=true;this.connected=false;clearInterval(this.timer);
  const room=this.room;this.room=null;
  try{if(room)await room.disconnect();}finally{await this.release();this.onState('ended');}
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={LiveKitCallTransport};
if(typeof window!=='undefined')window.ZiweiLiveKitCallTransport=LiveKitCallTransport;
