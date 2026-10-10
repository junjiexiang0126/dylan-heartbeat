'use strict';
const {spawn}=require('node:child_process'),{fakeHermes}=require('../test/helpers/fake_hermes'),{ChatStore,hash}=require('../chat_store');
const fake=fakeHermes({delay:600});fake.server.listen(0,'127.0.0.1',()=>{
 const base='http://127.0.0.1:'+fake.server.address().port,session='browser-protocol-fixture',key='protocol-fixture-key';
 const store=new ChatStore(process.env.ZIWEI_WEB_DATA_DIR,hash(base+'|'+session+'|'+key));
 store.importArchive({sha256:hash('e2e-archive'),records:[{ref:'fixture/old/message:1',role:'user',content:'历史档案验收样本',at:'2026-10-01T00:00:00Z'}]},'e2e-fixture.zip');store.close();
 const child=spawn(process.execPath,['server.js'],{stdio:'inherit',env:{...process.env,ZIWEI_BRIDGE_ENABLED:'true',ZIWEI_BRIDGE_ALLOW_HTTP_FOR_TESTS:'true',ZIWEI_HERMES_URL:base,ZIWEI_HERMES_WEB_SESSION_ID:session,ZIWEI_HERMES_API_KEY:key,ZIWEI_HERMES_API_KEY_FILE:''}});
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{child.kill(signal);fake.server.close();});child.on('exit',code=>process.exit(code||0));
});
