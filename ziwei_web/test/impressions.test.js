'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {HermesClient}=require('../hermes_client');
const {createRecords}=require('../records');
test('impressions adapter forwards cursor/range and preserves native total and diagnostics',async()=>{
 const original=HermesClient.prototype.json,calls=[];
 HermesClient.prototype.json=async route=>{calls.push(route);return {data:[{id:'one'}],total:125,nextCursor:'next',automatic:true,wake:{count:4,dailyLimit:10},checkedAt:'2026-10-21T10:00:00+07:00',errors:[{code:'source_unavailable'}]};};
 try{
  const handler=createRecords();let status,result;
  const res={writeHead:s=>status=s,end:s=>result=JSON.parse(s)};
  await handler({method:'GET'},res,new URL('http://local/api/records/impressions?limit=50&cursor=before&since=2026-10-21T00%3A00%3A00%2B07%3A00'));
  assert.equal(status,200);assert.equal(result.total,125);assert.equal(result.nextCursor,'next');assert.deepEqual(result.wake,{count:4,dailyLimit:10});assert.equal(result.errors.length,1);
  const query=new URL(calls[0],'http://native').searchParams;assert.equal(query.get('cursor'),'before');assert.equal(query.get('since'),'2026-10-21T00:00:00+07:00');
  await handler({method:'GET'},res,new URL('http://local/api/records/impressions?offset=50'));assert.equal(status,400);
 }finally{HermesClient.prototype.json=original;}
});
test('native failures remain failures and never a successful empty page',async()=>{
 const original=HermesClient.prototype.json;HermesClient.prototype.json=async()=>{throw Error('hermes_http_503');};
 try{let status,result;await createRecords()({method:'GET'},{writeHead:s=>status=s,end:s=>result=JSON.parse(s)},new URL('http://local/api/records/impressions'));assert.equal(status,503);assert.equal(result.error,'records_unavailable');}finally{HermesClient.prototype.json=original;}
});
