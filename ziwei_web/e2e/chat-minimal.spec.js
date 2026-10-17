'use strict';
const {test,expect}=require('@playwright/test');
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#home')).toBeVisible();await page.locator('[data-tab=chat]').click();}
const row=(i)=>({id:'fixture-'+i,role:i%2?'assistant':'user',content:'历史消息 '+i,attachments:[],created_at:'2026-10-14T00:00:00Z',status:'completed',source:'live'});
test('empty chat and populated history retain usable space on mobile',async({page})=>{
 let populated=false;await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:populated?Array.from({length:50},(_,i)=>row(i)):[],before:1,hasMore:false}}));await open(page);
 for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);await expect(page.locator('#chatEmpty')).toBeVisible();
  expect(await page.locator('#chatTimeline').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(80);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await expect.poll(()=>page.evaluate(()=>document.querySelector('nav').getBoundingClientRect().top-document.querySelector('#chatForm').getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0);
 }
 populated=true;await page.setViewportSize({width:320,height:568});await page.locator('[data-tab=home]').click();await page.locator('[data-tab=chat]').click();
 await expect(page.locator('#chatEmpty')).toBeHidden();await expect(page.locator('.message')).toHaveCount(50);
 const view=await page.locator('#chatTimeline').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,top:el.scrollTop}));expect(view.height).toBeGreaterThan(80);expect(view.scroll).toBeGreaterThan(view.height);expect(view.top).toBeGreaterThan(0);
 await expect(page.locator('.message').last()).toBeInViewport();
});
test('history failure is visible and re-entry retries even if status endpoint fails',async({page})=>{
 let count=0;await page.route('**/api/chat/messages?*',r=>r.fulfill(++count===1?{status:503,json:{error:'unavailable'}}:{json:{data:[row(1)],before:1,hasMore:false}}));
 await page.route('**/api/chat/status',r=>r.fulfill({status:503,json:{error:'unavailable'}}));await open(page);
 await expect(page.locator('#chatEmpty')).toContainText('加载失败');await expect(page.locator('#chatError')).not.toBeEmpty();
 await page.locator('[data-tab=home]').click();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatMessages')).toContainText('历史消息 1');await expect(page.locator('#chatEmpty')).toBeHidden();
});
test('send shows sending, accepted and completed; reload restores actual saved messages',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await expect(page.locator('#chatEmpty')).toHaveText('这里，留给我们慢慢说。');
 let release;const gate=new Promise(r=>release=r);let calls=0;await page.route('**/api/chat/send',async r=>{calls++;await gate;await r.continue();});
 const message='最小聊天验收 '+Date.now();await page.locator('#chatInput').fill(message);await page.locator('#chatSend').click();
 await expect(page.locator('#chatSendStatus')).toHaveText('正在发送…');await expect(page.locator('#chatSend')).toBeDisabled();release();
 await expect(page.locator('.message.user').filter({hasText:message})).toHaveCount(1);await expect(page.locator('#chatSendStatus')).toHaveText('已回复');await expect(page.locator('#chatMessages')).toContainText('协议测试回复');expect(calls).toBe(1);
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.message.user').filter({hasText:message})).toHaveCount(1);await expect(page.locator('#chatMessages')).toContainText('协议测试回复');expect(errors).toEqual([]);
});
test('accepted send with failed history refresh never reports an uncertain send',async({page})=>{
 await open(page);await expect(page.locator('#chatEmpty')).toHaveText('这里，留给我们慢慢说。');
 await page.route('**/api/chat/messages?*',r=>r.fulfill({status:503,json:{error:'unavailable'}}));
 await page.locator('#chatInput').fill('已接受但刷新失败 '+Date.now());await page.locator('#chatSend').click();
 await expect(page.locator('#chatInput')).toHaveValue('');await expect(page.locator('#chatError')).not.toBeEmpty();await expect(page.locator('#chatRecover')).toBeHidden();await expect(page.locator('#chatError')).not.toContainText('发送状态尚未确认');await expect(page.locator('#chatSend')).toBeEnabled();
});
test('uncertain send recovers with the same id and creates one saved user message',async({page})=>{
 await open(page);let first=true;const ids=[];await page.route('**/api/chat/send',async r=>{ids.push(r.request().postDataJSON().requestId);if(first){first=false;await r.fetch();await r.abort();}else await r.continue();});
 const message='同编号核对 '+Date.now();await page.locator('#chatInput').fill(message);await page.locator('#chatSend').click();await expect(page.locator('#chatSendStatus')).toHaveText('发送状态待确认');await page.locator('#chatRecover').click();await expect(page.locator('#chatRecover')).toBeHidden();await expect(page.locator('.message.user').filter({hasText:message})).toHaveCount(1);expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
});
test('rejected send preserves draft and session expiration clears private history',async({page})=>{
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[row(1)],before:1,hasMore:false}}));await open(page);await expect(page.locator('.message')).toHaveCount(1);
 await page.route('**/api/chat/send',r=>r.fulfill({status:503,json:{error:'hermes_not_configured'}}));await page.locator('#chatInput').fill('保留这条草稿');await page.locator('#chatSend').click();await expect(page.locator('#chatSendStatus')).toHaveText('发送失败');await expect(page.locator('#chatInput')).toHaveValue('保留这条草稿');await expect(page.locator('#chatSend')).toBeEnabled();
 await page.route('**/api/chat/messages?*',r=>r.fulfill({status:401,json:{error:'unauthorized'}}));await page.route('**/api/session',r=>r.fulfill({json:{authenticated:false,csrf:null,passkeyAvailable:false}}));await page.locator('[data-tab=home]').click();await page.locator('[data-tab=chat]').click();await expect(page.locator('#app')).toBeHidden();await expect(page.locator('#chatMessages')).toBeEmpty();await expect(page.locator('#chatInput')).toHaveValue('');
});

test('older history is prepended without losing the current reading position',async({page})=>{
 await page.route('**/api/chat/messages?*',r=>{const older=new URL(r.request().url()).searchParams.has('before');return r.fulfill({json:{data:older?[row(0)]:Array.from({length:10},(_,i)=>row(i+1)),before:older?null:1,hasMore:!older}});});
 await open(page);await expect(page.locator('.message')).toHaveCount(10);await page.locator('#chatOlder').click();await expect(page.locator('.message')).toHaveCount(11);await expect(page.locator('.message').first()).toContainText('历史消息 0');await expect(page.locator('#chatOlder')).toBeHidden();
});
