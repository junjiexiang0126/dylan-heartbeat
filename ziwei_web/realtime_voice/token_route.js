'use strict';
const {issueRoomToken,createRoomIdentity}=require('./livekit_token');
// Must be invoked only after Web session authentication and CSRF/origin checks.
function createVoiceTokenHandler(env=process.env){
 return function voiceToken(req,res,json){
  if(req.method!=='POST')return json(res,405,{error:'method_not_allowed'});
  const url=env.LIVEKIT_URL||'',key=env.LIVEKIT_API_KEY||'',secret=env.LIVEKIT_API_SECRET||'';
  if(!/^wss:\/\/[^\s/?#]+(?:\:\d+)?\/?$/.test(url)||!key||!secret)
   return json(res,503,{error:'realtime_voice_not_configured'});
  const {room,identity}=createRoomIdentity();
  try{
   const token=issueRoomToken({apiKey:key,apiSecret:secret,room,identity});
   return json(res,200,{url,token,room,identity,expiresIn:300});
  }catch{return json(res,503,{error:'realtime_voice_unavailable'});}
 };
}
module.exports={createVoiceTokenHandler};
