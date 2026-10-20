'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {issueRoomToken,createRoomIdentity}=require('../realtime_voice/livekit_token');
test('signed LiveKit join token is short-lived and room scoped',()=>{
 const secret='test-only-secret-123456789',pair=createRoomIdentity();
 const jwt=issueRoomToken({apiKey:'test-key',apiSecret:secret,...pair,now:1000});
 const [header,body,signature]=jwt.split('.');
 const claims=JSON.parse(Buffer.from(body,'base64url').toString());
 assert.equal(claims.iss,'test-key');assert.equal(claims.sub,pair.identity);
 assert.equal(claims.video.room,pair.room);assert.equal(claims.video.roomJoin,true);
 assert.equal(claims.exp-claims.iat,300);
 assert.equal(signature,crypto.createHmac('sha256',secret).update(header+'.'+body).digest('base64url'));
});
test('token requires server-side credentials and safe room identity',()=>{
 assert.throws(()=>issueRoomToken({room:'test',identity:'user'}),/not_configured/);
 assert.throws(()=>issueRoomToken({apiKey:'key',apiSecret:'secret-secret-secret',room:'../x',identity:'u'}),/invalid_livekit_identity/);
});
