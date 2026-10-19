'use strict';
const {test,expect}=require('./helpers/isolated-app');
const row=(content='历史消息',role='user',i=1)=>({id:'fixture-'+i,seq:i,role,content,created_at:'2026-10-14T00:00:00Z',status:'completed',source:'live',attachments:[]});
async function login(page){
 await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');
 await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();
 await page.locator('[data-tab=chat]').click();
}
async function noEvents(page){await page.addInitScript(()=>{window.EventSource=class extends EventTarget{close(){}};});}
async function history(page,data=[]){await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data,before:data[0]?.seq||null,hasMore:false}}));}
async function layout(page){return page.evaluate(()=>{
 const box=id=>document.getElementById(id).getBoundingClientRect();
 return {timeline:box('chatTimeline').height,messages:box('chatMessages').height,
  composeBottom:box('chatForm').bottom,navTop:document.querySelector('nav').getBoundingClientRect().top,
  width:document.documentElement.scrollWidth,viewport:innerWidth};
});}
test('composer glass stays inside its own box and cannot cover the chat header',async({page})=>{
 await page.setViewportSize({width:390,height:844});await noEvents(page);await history(page);await login(page);
 await page.emulateMedia({colorScheme:'dark'});
 const metrics=await page.locator('#chatForm').evaluate(form=>({height:form.getBoundingClientRect().height,
  glassHeight:parseFloat(getComputedStyle(form,'::before').height),position:getComputedStyle(form).position}));
 if(process.env.CHAT_VISUAL_OUTPUT)await page.screenshot({path:process.env.CHAT_VISUAL_OUTPUT});
 expect(metrics.glassHeight).toBeLessThanOrEqual(metrics.height+1);
 expect(metrics.position).toBe('relative');
 await expect(page.locator('#chatPeer')).toBeInViewport();await expect(page.locator('#chatEmpty')).toBeInViewport();
});
test('empty state and history occupy visible space on compact mobile and landscape',async({page})=>{
 await noEvents(page);await history(page);await login(page);
 await expect(page.locator('#chatEmpty')).toHaveText('这里，留给我们慢慢说。');
 for(const size of [{width:320,height:568},{width:390,height:844},{width:440,height:956},{width:956,height:440}]){
  await page.setViewportSize(size);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const m=await layout(page);
  expect(m.timeline).toBeGreaterThanOrEqual(80);expect(m.composeBottom).toBeLessThanOrEqual(m.navTop);
  expect(m.width).toBeLessThanOrEqual(m.viewport);await expect(page.locator('#chatEmpty')).toBeInViewport();
 }
 await page.unroute('**/api/chat/messages?*');await history(page,[row('你的历史消息'),row('知微的历史回复','assistant',2)]);
 await page.locator('[data-tab=home]').click();await page.locator('[data-tab=chat]').click();
 await expect(page.locator('#chatMessages')).toContainText('知微的历史回复');await expect(page.locator('#chatEmpty')).toBeHidden();
 expect((await layout(page)).messages).toBeGreaterThan(0);
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatMessages')).toContainText('你的历史消息');
});
test('loading indicator, visible failure and retry work even when status service fails',async({page})=>{
 await noEvents(page);let release,ok=false;const gate=new Promise(r=>{release=r;});
 await page.route('**/api/chat/messages?*',async r=>{await gate;await r.fulfill(ok?{json:{data:[row('重试后恢复的历史')],before:1,hasMore:false}}:{status:500,json:{error:'test_failure'}});});
 await page.route('**/api/chat/status',r=>r.fulfill({status:503,json:{error:'test_status_failure'}}));
 await login(page);await expect(page.locator('#chatEmpty')).toHaveText('正在加载聊天记录…');release();
 await expect(page.locator('#chatEmpty')).toHaveText('聊天记录加载失败，请重新加载。');await expect(page.locator('#chatError')).not.toBeEmpty();
 await expect(page.locator('#chatRetry')).toBeVisible();ok=true;await page.locator('#chatRetry').click();
 await expect(page.locator('#chatMessages')).toContainText('重试后恢复的历史');await expect(page.locator('#chatRetry')).toBeHidden();
 await expect(page.locator('#chatConnection')).toHaveText('连接状态暂不可用');
});
test('POST status is visible without SSE and rapid submissions send once',async({page})=>{
 await noEvents(page);await history(page);let release,count=0;const gate=new Promise(r=>{release=r;});
 await page.route('**/api/chat/send',async r=>{count++;await gate;await r.fulfill({status:202,json:{requestId:r.request().postDataJSON().requestId,state:'queued'}});});
 await login(page);await page.locator('#chatInput').fill('发送状态验收');await page.locator('#chatSend').click();
 await expect(page.locator('#chatSend')).toHaveAttribute('data-state','sending');await expect(page.locator('#chatWork')).toHaveText('正在发送…');
 await page.evaluate(()=>{for(let i=0;i<3;i++)document.querySelector('#chatForm').dispatchEvent(new Event('submit',{cancelable:true}));});
 release();await expect(page.locator('#chatWork')).toHaveText('等待发送');expect(count).toBe(1);
 await expect(page.locator('#chatInput')).toHaveValue('');await expect(page.locator('#chatSend')).toBeEnabled();
});
test('uncertain send retries with the same request ID and retains the draft',async({page})=>{
 await noEvents(page);await history(page);const ids=[];
 await page.route('**/api/chat/send',r=>{ids.push(r.request().postDataJSON().requestId);return r.fulfill(ids.length===1?{status:500,json:{error:'test_failure'}}:{status:202,json:{state:'queued'}});});
 await login(page);await page.locator('#chatInput').fill('网络错误草稿');await page.locator('#chatSend').click();
 await expect(page.locator('#chatSend')).toHaveAttribute('data-state','uncertain');await expect(page.locator('#chatRecover')).toBeVisible();
 await expect(page.locator('#chatInput')).toHaveValue('网络错误草稿');await expect(page.locator('#chatWork')).toContainText('请勿重复发送');
 await page.locator('#chatRecover').click();await expect(page.locator('#chatInput')).toHaveValue('');expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0]);
});
test('accepted message with failed history refresh is not reported as an uncertain send',async({page})=>{
 await noEvents(page);let sent=false;
 await page.route('**/api/chat/messages?*',r=>r.fulfill(sent?{status:500,json:{error:'test_failure'}}:{json:{data:[],before:null,hasMore:false}}));
 await page.route('**/api/chat/send',r=>{sent=true;return r.fulfill({status:202,json:{state:'queued'}});});
 await login(page);await page.locator('#chatInput').fill('已被接收的消息');await page.locator('#chatSend').click();
 await expect(page.locator('#chatError')).toContainText('消息已被接收');await expect(page.locator('#chatRecover')).toBeHidden();
 await expect(page.locator('#chatRetry')).toBeVisible();await expect(page.locator('#chatSend')).toBeEnabled();
});
test('existing requests show their actual server state after entry',async({page})=>{
 await noEvents(page);
 // The current client restores request state from the authoritative messages snapshot.
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[row('恢复中的请求')],before:1,hasMore:false,requests:[{id:'restored-request',state:'recovering'}]}}));
 await login(page);await expect(page.locator('#chatWork')).toHaveText('恢复连接中');await expect(page.locator('#chatProgress')).toBeInViewport();
});
test('real isolated chat service sends, streams, persists and reloads the reply',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
 const message='聊天最小闭环 '+Date.now();await page.locator('#chatInput').fill(message);await page.locator('#chatSend').click();
 const user=page.locator('.message.user').filter({hasText:message});await expect(user).toHaveCount(1);
 await expect(page.locator('#chatMessages')).toContainText('协议测试回复');await expect(user).toContainText('已回复');
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.message.user').filter({hasText:message})).toHaveCount(1);
 await expect(page.locator('#chatMessages')).toContainText('协议测试回复');expect(errors).toEqual([]);
});
test('a late POST response after logout cannot restore private chat UI',async({page})=>{
 await noEvents(page);await history(page);let release;const gate=new Promise(r=>{release=r;});
 await page.route('**/api/chat/send',async r=>{await gate;await r.fulfill({status:202,json:{state:'queued'}});});
 await login(page);await page.locator('#chatInput').fill('登出中的消息');await page.locator('#chatSend').click();
 await page.locator('#settingsButton').click();await page.locator('#logout').click();release();
 await expect(page.locator('#app')).toBeHidden();await expect(page.locator('#chatMessages')).toBeEmpty();await expect(page.locator('#chatProgress')).toBeHidden();
});
