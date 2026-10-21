'use strict';
const {test,expect}=require('./helpers/isolated-app');
const stamp='2026-10-21T09:00:00+07:00';
const item=(id,title='活动 '+id)=>({id,ts:stamp,kind:'work',title,summary:'来自实际执行记录',state:'completed',automatic:true});
const value=(data,extra={})=>({data,total:data.length,nextCursor:null,checkedAt:stamp,source:'hermes_native',errors:[],wake:{count:3,dailyLimit:10},...extra});
async function open(page){
 await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();
 await page.locator('[data-tab=logs]').click();await page.locator('[data-log-kind=impressions]').click();
}
test('live refresh, failure retention, recovery and leaving the page',async({page})=>{
 let rows=[item('a')],fail=false,calls=0;
 await page.route('**/api/records/impressions?*',r=>{calls++;return fail?r.fulfill({status:503,json:{error:'unavailable'}}):r.fulfill({json:value(rows)});});
 await page.clock.install();await open(page);await expect(page.locator('.imp-card')).toHaveCount(1);await expect(page.locator('#impressionsStatus')).toContainText('3 / 10');
 rows=[item('b'),item('a')];await page.clock.runFor(15001);await expect(page.locator('.imp-card')).toHaveCount(2);
 fail=true;await page.clock.runFor(15001);await expect(page.locator('#impressionsError')).toBeVisible();await expect(page.locator('.imp-card')).toHaveCount(2);await expect(page.locator('#impressionsEmpty')).toBeHidden();
 fail=false;rows=[item('c')];await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.locator('.imp-card')).toHaveCount(1);await expect(page.locator('.imp-card')).toContainText('活动 c');
 await page.locator('#logBack').click();const count=calls;await page.clock.runFor(30001);expect(calls).toBe(count);
});
test('history pagination and exact diary navigation',async({page})=>{
 const first=Array.from({length:50},(_,i)=>item(String(i)));first[0]={...item('diary','留下了一篇日记'),kind:'diary',target:{kind:'diary',id:'diary-exact'}};
 await page.route('**/api/records/impressions?*',r=>{const q=new URL(r.request().url()).searchParams;return r.fulfill({json:q.get('cursor')?value([item('old')],{total:51}):value(first,{total:51,nextCursor:'cursor-1'})});});
 await page.route('**/api/records/diary?id=diary-exact',r=>r.fulfill({json:{id:'diary-exact',title:'准确的这篇',date:'2026-10-21',content:'这篇日记的正文',source:'workspace/diary/example.md',revision:'one'}}));
 await open(page);await expect(page.locator('.imp-card')).toHaveCount(50);await page.locator('#impressionsMore').click();await expect(page.locator('.imp-card')).toHaveCount(51);await expect(page.locator('#impressionsMore')).toBeHidden();
 await page.locator('.imp-card').filter({hasText:'留下了一篇日记'}).click();await page.locator('[data-goto=diary]').click();await expect(page.locator('#logRecords')).toContainText('准确的这篇');await expect(page.locator('#logRecords')).toContainText('这篇日记的正文');
});
test('late response after logout cannot repopulate private impressions',async({page})=>{
 let resolve;let block=false;
 await page.route('**/api/records/impressions?*',async r=>{if(block)await new Promise(done=>resolve=done);await r.fulfill({json:value([item('private')])});});
 await open(page);await expect(page.locator('.imp-card')).toHaveCount(1);block=true;await page.locator('#impressionsRefresh').click();await expect.poll(()=>typeof resolve).toBe('function');
 await page.evaluate(()=>window.ZiweiRecords.stop());resolve();await expect(page.locator('.imp-card')).toHaveCount(0);
});
test('Bangkok dates, escaped text and partial source failures',async({page})=>{
 await page.route('**/api/records/impressions?*',r=>r.fulfill({json:value([{...item('utc','<script>bad()</script>'),ts:'2026-10-20T18:10:00Z'}],{errors:[{code:'source_unavailable'}]})}));
 await open(page);await expect(page.locator('.imp-day')).toContainText('10.21');await expect(page.locator('.imp-time')).toHaveText('01:10');await expect(page.locator('.imp-card strong')).toHaveText('<script>bad()</script>');await expect(page.locator('#impressionsError')).toContainText('可能不完整');
});
