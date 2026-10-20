'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createVoiceTokenHandler}=require('../realtime_voice/token_route');
function invoke(env,method='POST'){
 let response;const json=(_res,status,body)=>{response={status,body};};
 createVoiceTokenHandler(env)({method},{},json);return response;
}
test('no credentials fails closed without issuing tokens',()=>{
 assert.deepEqual(invoke({}),{status:503,body:{error:'realtime_voice_not_configured'}});
});
test('token endpoint rejects unsupported methods',()=>{
 assert.equal(invoke({},'GET').status,405);
});
test('valid config issues short-lived unique room-scoped tokens',()=>{
 const env={LIVEKIT_URL:'wss://example.livekit.cloud',LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'test-only-secret-123456789'};
 const a=invoke(env),b=invoke(env);
 assert.equal(a.status,200);assert.equal(a.body.expiresIn,300);
 assert.notEqual(a.body.room,b.body.room);
 assert.equal(a.body.token.split('.').length,3);
 assert.equal(a.body.url,env.LIVEKIT_URL);
});
test('invalid LiveKit URL rejected',()=>{
 const env={LIVEKIT_URL:'http://localhost:7880',LIVEKIT_API_KEY:'key',LIVEKIT_API_SECRET:'test-only-secret-123456789'};
 assert.equal(invoke(env).status,503);
});
