'use strict';
const crypto=require('node:crypto');
// Minimal LiveKit HS256 join-token signer. Call ONLY behind existing web authentication.
// API secret never leaves the server; production should prefer official livekit-server-sdk.
function issueRoomToken({apiKey,apiSecret,room,identity,ttlSeconds=300,now=Math.floor(Date.now()/1000)}){
 if(!apiKey||!apiSecret||apiSecret.length<16)throw Error('livekit_not_configured');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(room)||!/^[a-zA-Z0-9_-]{1,100}$/.test(identity))throw Error('invalid_livekit_identity');
 if(!Number.isInteger(ttlSeconds)||ttlSeconds<30||ttlSeconds>600)throw Error('invalid_livekit_ttl');
 const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
 const head=encode({alg:'HS256',typ:'JWT'});
 const body=encode({iss:apiKey,sub:identity,iat:now,nbf:now,exp:now+ttlSeconds,jti:crypto.randomUUID(),
  video:{roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true}});
 const unsigned=head+'.'+body;
 return unsigned+'.'+crypto.createHmac('sha256',apiSecret).update(unsigned).digest('base64url');
}
function createRoomIdentity(){return {room:'ziwei-'+crypto.randomUUID().replaceAll('-',''),identity:'user-'+crypto.randomUUID().replaceAll('-','')};}
module.exports={issueRoomToken,createRoomIdentity};
