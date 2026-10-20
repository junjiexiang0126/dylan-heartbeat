'use strict';
// Browser-side LiveKit transport, dependency-injected to keep the existing PWA untouched.
// A locally bundled livekit-client SDK must be passed as sdk. No CDN or remote script.
class LiveKitCallTransport {
 constructor({sdk,request,onRemoteAudio=()=>{},onState=()=>{}}={}){
  if(!sdk?.Room||!sdk?.RoomEvent||typeof request!=='function')throw Error('livekit_client_required');
  this.sdk=sdk;this.request=request;this.onRemoteAudio=onRemoteAudio;this.onState=onState;
  this.room=null;this.closed=false;this.connected=false;this.muted=false;
 }
 async connect(){
  if(this.closed||this.room)throw Error('call_already_started');
  const details=await this.request('/api/voice/livekit-token','POST',{});
  if(this.closed)return false;
  if(!/^wss:\/\//.test(details.url)||!details.token)throw Error('invalid_livekit_configuration');
  const room=new this.sdk.Room({adaptiveStream:true,dynacast:true});
  this.room=room;
  room.on(this.sdk.RoomEvent.TrackSubscribed,(track,publication,participant)=>{
   if(track.kind==='audio')this.onRemoteAudio({track,publication,participant});
  });
  room.on(this.sdk.RoomEvent.Disconnected,()=>{this.connected=false;this.onState('disconnected');});
  try{
   await room.connect(details.url,details.token,{autoSubscribe:true});
   if(this.closed){await room.disconnect();return false;}
   this.connected=true;this.onState('connected');
   await room.localParticipant.setMicrophoneEnabled(!this.muted);
   return true;
  }catch(e){await room.disconnect();if(this.room===room)this.room=null;this.connected=false;throw e;}
 }
 async setMuted(value){
  if(this.closed)return false;
  this.muted=Boolean(value);
  if(this.connected)await this.room.localParticipant.setMicrophoneEnabled(!this.muted);
  this.onState(this.muted?'muted':'unmuted');return true;
 }
 async disconnect(){
  if(this.closed)return;
  this.closed=true;this.connected=false;
  const room=this.room;this.room=null;
  if(room)await room.disconnect();
  this.onState('ended');
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={LiveKitCallTransport};
if(typeof window!=='undefined')window.ZiweiLiveKitCallTransport=LiveKitCallTransport;
