'use strict';
const {test,expect}=require('@playwright/test');
const now='2026-10-15T15:00:00Z';
async function login(page){await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();}
function response(data){return {data,source:'hermes_native',readOnly:true,total:data.length,nextOffset:null,checkedAt:now,errors:[]};}
test('personal diaries expand actual original text, respond through a draft, and private records clear on lock',async({page})=>{
 const body='知微保存的原文。\n'+('今天的想法。\n'.repeat(20))+'END OF ACTUAL DIARY';
 await page.route('**/api/records/**',r=>{const u=new URL(r.request().url()),kind=u.pathname.split('/').at(-1);if(kind==='diary')return r.fulfill({json:u.searchParams.has('id')?{content:body,revision:'native-rev'}:response([{id:'native-diary',title:'今天的日记',date:'2026-10-15',savedAt:now,at:now,source:'workspace/diary/2026-10-15.md',document:true,revision:'native-rev',preview:body.slice(0,80)}])});return r.fulfill({json:response([])});});
 await login(page);await page.locator('[data-tab=logs]').click();await page.locator('[data-log-kind=diary]').click();await expect(page.locator('.diary-card')).toHaveCount(1);await expect(page.locator('.diary-card')).toContainText('2026.10.15');await page.locator('.diary-card button').filter({hasText:'展开'}).click();await expect(page.locator('.record-body')).toContainText('END OF ACTUAL DIARY');await expect(page.locator('.record-body')).not.toHaveClass(/collapsed/);
 await page.screenshot({path:'/workspace/scratch/6f1f56c5216f/diary-preview.png',fullPage:true});
 await page.locator('.diary-card button').filter({hasText:'和知微聊这篇'}).click();await expect(page.locator('#chat')).toBeVisible();await expect(page.locator('#chatInput')).toHaveValue(/知微保存的原文/);
 await page.locator('[data-tab=home]').click();await page.locator('#settingsButton').click();await page.locator('#logout').click();await expect(page.locator('#logRecords')).toBeEmpty();await expect(page.locator('#memoryRecords')).toBeEmpty();
});
test('memory is live, searchable, read-only, and source text is never executed as HTML',async({page})=>{
 let content='# 原生长期记忆\n真实内容 FIRST\n<script>window.RECORD_XSS=true</script>';
 await page.route('**/api/records/memory?*',r=>r.fulfill({json:response([{id:'native-memory',source:'memories/MEMORY.md',title:'知微的身份',categories:['self'],classificationBasis:'后台分类标记',content,at:now,savedAt:now,revision:content}])}));
 await login(page);await page.locator('[data-tab=memory]').click();await page.locator('[data-memory-category=self]').click();await expect(page.locator('#memoryRecords')).toContainText('FIRST');expect(await page.evaluate(()=>window.RECORD_XSS)).toBeUndefined();expect(await page.locator('#memoryRecords textarea,#memoryRecords input').count()).toBe(0);
 await page.locator('#memoryRecords button').filter({hasText:'展开'}).click();await expect(page.locator('#memoryRecords .record-body')).not.toHaveClass(/collapsed/);
 content='后台真实修改 SECOND';await page.locator('#memoryRefresh').click();await expect(page.locator('#memoryRecords')).toContainText('SECOND');await expect(page.locator('#memoryRecords')).not.toContainText('FIRST');
 const search=page.waitForRequest(r=>r.url().includes('/api/records/memory?')&&new URL(r.url()).searchParams.get('q')==='SECOND');await page.locator('#memorySearch').fill('SECOND');await search;
 await page.screenshot({path:'/workspace/scratch/6f1f56c5216f/memory-preview.png',fullPage:true});
});
test('work logs display native briefings and pending memory audit, with visible errors on backend failure',async({page})=>{
 let unavailable=false;await page.route('**/api/records/work?*',r=>r.fulfill(unavailable?{status:503,json:{error:'unavailable'}}:{json:response([{id:'briefing',title:'rest',state:'recorded',basis:'agent_briefing',source:'workspace/briefings.jsonl',at:now,preview:'实际选择休息',opportunity:2},{id:'audit',title:'记忆维护',state:'pending',basis:'memory_audit',source:'workspace/memory_operations.jsonl',at:now,preview:'原生待核验记录'}])}));
 await login(page);await page.locator('[data-tab=logs]').click();await expect(page.locator('#logRecords')).toContainText('实际选择休息');await expect(page.locator('#logRecords')).toContainText('第 2 次自主机会');await expect(page.locator('#logRecords')).toContainText('等待核验');await expect(page.locator('#logRecords')).not.toContainText('执行成功');await page.screenshot({path:'/workspace/scratch/6f1f56c5216f/worklog-preview.png',fullPage:true});unavailable=true;await page.locator('#logRefresh').click();await expect(page.locator('#logError')).toContainText('暂时无法读取');await expect(page.locator('#logStatus')).toContainText('上次读取结果');
});
test('chat keeps its reading position and older loaded messages when returning from home and ignores archive-only events',async({page})=>{
 let reads=0;await page.addInitScript(()=>{const Real=window.EventSource;window.EventSource=function(url,...args){window.__sseUrl=String(url);return window.__recordEvents=new Real(url,...args);};});
 const rows=Array.from({length:60},(_,i)=>({id:'position-'+i,seq:i+1,role:i%2?'assistant':'user',content:'真实消息位置 '+i+'。'.repeat(50),attachments:[],created_at:new Date(1700000000000+i*1000).toISOString(),status:'completed',source:'live'}));
 await page.route('**/api/chat/messages?*',r=>{reads++;const older=new URL(r.request().url()).searchParams.has('before');return r.fulfill({json:{data:older?rows.slice(0,10):rows.slice(10),before:older?1:11,hasMore:!older,eventCursor:100}});});
 await login(page);await page.locator('[data-tab=chat]').click();await expect(page.locator('.message')).toHaveCount(50);await page.locator('#chatOlder').click();await expect(page.locator('.message')).toHaveCount(60);await page.locator('#chatTimeline').evaluate(n=>{n.scrollTop=200;});const top=await page.locator('#chatTimeline').evaluate(n=>n.scrollTop);
 await page.locator('[data-tab=home]').click();await page.locator('[data-tab=chat]').click();await expect(page.locator('.message')).toHaveCount(60);await expect.poll(()=>page.locator('#chatTimeline').evaluate(n=>n.scrollTop)).toBe(top);
 await expect.poll(()=>page.evaluate(()=>window.__sseUrl)).toContain('after=100');const prior=reads;await page.evaluate(()=>window.__recordEvents.dispatchEvent(new MessageEvent('timeline.changed',{data:JSON.stringify({source:'archive'})})));await page.waitForTimeout(400);expect(reads).toBe(prior);await page.screenshot({path:'/workspace/scratch/6f1f56c5216f/chat-position-preview.png'});
});
