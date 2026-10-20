'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LiveKitCallTransport}=require('../public/livekit-call-transport');
test('connect obtains server-issued token and mute toggles published microphone',async()=>{
 const calls=[],states=[];
 class Room{
  constructor(){this.localParticipant={setMicrophoneEnabled:async v=>calls.push(['microphone',v])};}
  on(event,fn){calls.push(['listener',event]);}
  async connect(url,token){calls.push(['connect',url,token]);}
  async disconnect(){calls.push(['disconnect']);}
 }
 const transport=new LiveKitCallTransport({
  sdk:{Room,RoomEvent:{TrackSubscribed:'track',Disconnected:'disconnect'}},
  request:async(url,method)=>{calls.push(['token',url,method]);return {url:'wss://example.livekit.cloud',token:'test.jwt.token'};},
  onState:s=>states.push(s)
 });
 await transport.connect();await transport.setMuted(true);await transport.setMuted(false);await transport.disconnect();
 assert.deepEqual(calls.filter(c=>c[0]==='microphone'),[['microphone',true],['microphone',false],['microphone',true]]);
 assert.deepEqual(states,['connected','muted','unmuted','ended']);
 assert.equal(calls.filter(c=>c[0]==='token').length,1);
});
test('no browser SDK fails without making requests',()=>{
 assert.throws(()=>new LiveKitCallTransport({request:async()=>{}}),/livekit_client_required/);
});
test('disconnect before token response cannot open room',async()=>{
 let resolve;const token=new Promise(r=>resolve=r);let created=0;
 class Room{constructor(){created++;}}
 const t=new LiveKitCallTransport({sdk:{Room,RoomEvent:{}},request:()=>token});
 const pending=t.connect();await t.disconnect();
 resolve({url:'wss://example.livekit.cloud',token:'test'});
 assert.equal(await pending,false);assert.equal(created,0);
});
