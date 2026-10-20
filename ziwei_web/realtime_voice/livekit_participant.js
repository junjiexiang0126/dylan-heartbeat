'use strict';
const {PcmFrames}=require('./pcm');
class LiveKitParticipant {
 constructor({url,token,userIdentity,sdk,onControl=()=>{},onFailure=()=>{}}={}){
  this.url=url;this.token=token;this.userIdentity=userIdentity;this.sdk=sdk;this.control=onControl;this.failure=onFailure;
  this.listeners=new Set();this.readers=new Map();this.closed=false;this.playbackEpoch=0;this.tail=Promise.resolve();
 }
 onAudio(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
 async join(){
  const s=this.sdk||require('@livekit/rtc-node');this.sdk=s;const room=this.room=new s.Room();
  room.on(s.RoomEvent.TrackSubscribed,(track,pub,user)=>{
   if(this.closed||user.identity!==this.userIdentity||track.kind!==s.TrackKind.KIND_AUDIO||pub.source!==s.TrackSource.SOURCE_MICROPHONE)return;
   this.consume(track).catch(()=>{if(!this.closed)this.failure('voice_receive_failed');});
  });
  room.on(s.RoomEvent.TrackUnsubscribed,track=>{void this.readers.get(track)?.cancel().catch(()=>{});});
  room.on(s.RoomEvent.TrackMuted,(pub,user)=>{if(user.identity===this.userIdentity&&pub.source===s.TrackSource.SOURCE_MICROPHONE)this.control('mute',true);});
  room.on(s.RoomEvent.TrackUnmuted,(pub,user)=>{if(user.identity===this.userIdentity&&pub.source===s.TrackSource.SOURCE_MICROPHONE)this.control('mute',false);});
  room.on(s.RoomEvent.ParticipantDisconnected,user=>{if(user.identity===this.userIdentity)this.control('hangup');});
  room.on(s.RoomEvent.Reconnecting,()=>this.control('reconnecting'));
  room.on(s.RoomEvent.Reconnected,()=>this.control('reconnected'));
  room.on(s.RoomEvent.Disconnected,()=>{if(!this.closed)this.failure('voice_disconnected');});
  await room.connect(this.url,this.token,{autoSubscribe:true,dynacast:true});
  if(this.closed){await room.disconnect();return;}
  this.source=new s.AudioSource(16000,1,100);
  this.track=s.LocalAudioTrack.createAudioTrack('ziwei-voice',this.source);
  await room.localParticipant.publishTrack(this.track,new s.TrackPublishOptions({source:s.TrackSource.SOURCE_MICROPHONE}));
 }
 async consume(track){
  if(this.readers.has(track)||this.readers.size) return; // one authorized microphone only
  // WebRTC's native decoder performs band-limited resampling and stereo downmix.
  const reader=new this.sdk.AudioStream(track,{sampleRate:16000,numChannels:1,frameSizeMs:20}).getReader();
  const framing=new PcmFrames();this.readers.set(track,reader);
  try{while(!this.closed){const {value,done}=await reader.read();if(done)break;
   if(value.sampleRate!==16000||value.channels!==1)throw Error('voice_receive_format');
   for(const pcm of framing.push(value.data))for(const fn of this.listeners)fn(pcm);
  }}finally{this.readers.delete(track);await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 async publishAudio({pcm,sampleRate,channels}){
  if(this.closed)return;
  if(!(pcm instanceof Int16Array)||sampleRate!==16000||channels!==1||pcm.length!==320)throw Error('voice_publish_format');
  const epoch=this.playbackEpoch;
  const next=this.tail.then(async()=>{if(!this.closed&&epoch===this.playbackEpoch){await this.source.captureFrame(new this.sdk.AudioFrame(pcm,16000,1,pcm.length));if(epoch!==this.playbackEpoch)this.source.clearQueue();}});
  this.tail=next.catch(()=>{});return next;
 }
 async drain(){await this.tail;if(!this.closed)await this.source?.waitForPlayout();}
 async clearPlayback(){this.playbackEpoch++;this.source?.clearQueue();}
 async sendEvent(event){
  if(this.closed||!this.room?.localParticipant)return;
  const data=Buffer.from(JSON.stringify(event));if(data.length>12000)return;
  await this.room.localParticipant.publishData(data,{reliable:true,topic:'ziwei.voice',destinationIdentities:[this.userIdentity]});
 }
 async leave(){
  if(this.closing)return this.closing;this.closed=true;
  this.closing=(async()=>{await this.clearPlayback();await Promise.allSettled([...this.readers.values()].map(r=>r.cancel()));
   await this.room?.disconnect();await this.tail;await this.source?.close();this.listeners.clear();})();return this.closing;
 }
}
module.exports={LiveKitParticipant};
