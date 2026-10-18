'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {hermesEndpoint,hermesRoute}=require('../hermes_endpoint');
const {HermesClient}=require('../hermes_client');
const {ChatStore,hash}=require('../chat_store');
const {probePrivateTransport}=require('../hermes_private_probe');
const host='ziwei-hermes-test.railway.internal';
const env={NODE_ENV:'production',ZIWEI_BRIDGE_ENABLED:'true',ZIWEI_HERMES_URL:'https://existing-hermes.example/',ZIWEI_HERMES_API_KEY:'isolated-fixture-not-a-live-secret',ZIWEI_HERMES_WEB_SESSION_ID:'existing-session'};
test('private transport selects only the exact configured service and fixed port',()=>{
 const endpoint=hermesEndpoint({...env,ZIWEI_HERMES_PRIVATE_HOST:host});
 assert.equal(endpoint,'http://'+host+':8642/');
 assert.equal(hermesRoute(endpoint,'/v1/runs/run_fixture/events?last_seq=3').href,endpoint+'v1/runs/run_fixture/events?last_seq=3');
});
test('invalid private host fails closed instead of falling back to public HTTPS',()=>{
 for(const value of ['', '*','*.railway.internal','127.0.0.1','10.0.0.1','[::1]','localhost','railway.internal','other.example','a.railway.internal.evil','a.b.railway.internal','https://'+host,host+':443',host+'/',host+'.',host+'?x=1',host+'#x',host+'@evil.example',' '+host,host+'\n',host.toUpperCase(),'%7a'+host.slice(1)]){
  assert.equal(hermesEndpoint({...env,ZIWEI_HERMES_PRIVATE_HOST:value}),null,value);
  assert.equal(new HermesClient({...env,ZIWEI_HERMES_PRIVATE_HOST:value}).configured(),false,value);
 }
});
test('public compatibility and test HTTP remain separate from private authorization',()=>{
 assert.equal(hermesEndpoint(env),env.ZIWEI_HERMES_URL);
 for(const url of ['http://example.com/','http://'+host+':8642/','http://127.0.0.1:3187/','https://u:p@example.com/','https://example.com/path','https://example.com/?x=1'])assert.equal(hermesEndpoint({...env,ZIWEI_HERMES_URL:url}),null,url);
 assert.equal(hermesEndpoint({...env,NODE_ENV:'test',ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS:'true',ZIWEI_HERMES_URL:'http://127.0.0.1:3187'}),'http://127.0.0.1:3187/');
 assert.equal(hermesEndpoint({...env,ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS:'true',ZIWEI_HERMES_URL:'http://127.0.0.1:3187/'}),null);
});
test('routes cannot escape the selected origin or carry URL credentials',()=>{
 const endpoint='http://'+host+':8642/';
 for(const route of ['https://evil.example/','//evil.example/','/\\evil.example/','\\evil.example','/v1/models#fragment','/v1/models\r\nX: y'])assert.throws(()=>hermesRoute(endpoint,route),/hermes_route_rejected/);
});
test('private fetch retains bearer/session, blocks redirects and never retries publicly',async t=>{
 const prior=global.fetch;t.after(()=>{global.fetch=prior;});const seen=[];
 global.fetch=async(url,options)=>{seen.push({url:String(url),options});throw Error('private_connection_refused');};
 const client=new HermesClient({...env,ZIWEI_HERMES_PRIVATE_HOST:host});
 await assert.rejects(client.fetch('/ziwei/web/work/turn',{method:'POST',headers:{authorization:'untrusted', 'X-Hermes-Session-Key':'other','Content-Type':'application/json'},body:'{}'}),/private_connection_refused/);
 assert.equal(seen.length,1);assert.equal(seen[0].url,'http://'+host+':8642/ziwei/web/work/turn');
 assert.equal(seen[0].options.headers.get('Authorization'),'Bearer '+env.ZIWEI_HERMES_API_KEY);
 assert.equal(seen[0].options.headers.get('X-Hermes-Session-Key'),client.sessionKey);
 assert.equal(seen[0].options.redirect,'error');assert.equal(seen[0].options.headers.get('Content-Type'),'application/json');
 await assert.rejects(client.fetch('https://evil.example/'),/hermes_route_rejected/);assert.equal(seen.length,1);
});
test('transport migration preserves the existing persistent chat identity and rows',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-private-identity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const before=new HermesClient(env),after=new HermesClient({...env,ZIWEI_HERMES_PRIVATE_HOST:host});
 const scope=c=>hash(c.base+'|'+c.session+'|'+c.key);
 assert.equal(scope(before),scope(after));assert.notEqual(before.endpoint,after.endpoint);
 let store=new ChatStore(dir,scope(before));store.db.prepare("INSERT INTO requests(id,hash,payload,state,created_at) VALUES('fixture-request','fixture','{}','completed','2026-10-18T00:00:00Z')").run();store.db.prepare("INSERT INTO meta VALUES('private_migration_fixture','preserve')").run();store.close();
 store=new ChatStore(dir,scope(after));assert.equal(store.db.prepare("SELECT value FROM meta WHERE key='private_migration_fixture'").get().value,'preserve');assert.equal(store.request('fixture-request').state,'completed');store.close();
});
test('rollout canary reads capabilities privately without switching normal traffic',async t=>{
 const prior=global.fetch;t.after(()=>{global.fetch=prior;});const seen=[];
 global.fetch=async(url,options)=>{seen.push({url:String(url),options});return Response.json({features:{runs_idempotency:{durable:true,retention_seconds:3600},run_events_sse:true}});};
 const config={...env,ZIWEI_HERMES_PRIVATE_PROBE_HOST:host};
 assert.equal(new HermesClient(config).endpoint,env.ZIWEI_HERMES_URL);
 assert.deepEqual(await probePrivateTransport(config),{verified:true,network:'railway-private',upstream:host+':8642',modelCalls:0});
 assert.equal(seen.length,1);assert.equal(seen[0].url,'http://'+host+':8642/v1/capabilities');
 assert.equal(seen[0].options.headers.get('Authorization'),'Bearer '+env.ZIWEI_HERMES_API_KEY);
 await assert.rejects(probePrivateTransport({...config,ZIWEI_HERMES_PRIVATE_PROBE_HOST:'bad.example'}),/private_probe_configuration_invalid/);
 assert.equal(seen.length,1);
});
