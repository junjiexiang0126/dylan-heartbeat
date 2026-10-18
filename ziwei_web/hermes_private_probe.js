'use strict';
const {HermesClient}=require('./hermes_client');
// A rollout canary: one authenticated, model-free capabilities read. Existing
// traffic keeps its configured transport until PRIVATE_HOST is explicitly set.
async function probePrivateTransport(env=process.env,Client=HermesClient){
 const host=env.ZIWEI_HERMES_PRIVATE_PROBE_HOST;
 if(host===undefined)return null;
 const client=new Client({...env,ZIWEI_HERMES_PRIVATE_HOST:host});
 if(!client.configured())throw Error('private_probe_configuration_invalid');
 await client.check();
 return {verified:true,network:'railway-private',upstream:new URL(client.endpoint).host,modelCalls:0};
}
module.exports={probePrivateTransport};
