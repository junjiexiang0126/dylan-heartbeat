'use strict';
const {test,expect}=require('@playwright/test'),{screenshotPath}=require('./helpers/screenshot-path');
async function setup(page,{native=false,real=false}={}){
 let value={source:'ziwei',state:'在工作',updatedAt:new Date().toISOString(),stale:false,...(native?{note:'今天先把小屋整理好，再来陪你。',mood:'安静，专注'}:{})};const writes=[];
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.method()!=='GET'&&!r.url().endsWith('/api/login'))writes.push(r.url());});
 await page.route('**/api/chat/status',r=>r.fulfill({json:{enabled:true,connected:true,presence:value}}));
 // Layout/copy checks isolate rendering; actual GLB/animation is covered separately.
 if(!real)await page.route('**/raven-view.js',r=>r.fulfill({contentType:'text/javascript',body:'export class RavenView {constructor(c,o){this.c=c;queueMicrotask(o.onReady)}setMode(m){this.c.dataset.animation=m}pause(){}resume(){}dispose(){}setReduced(){}}'}));
 await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#ravenNote')).not.toBeEmpty();
 return {writes,get value(){return value},async publish(v){value=v;await page.evaluate(x=>window.ZiweiChatExtra.presence(x),v);}};
}
test('one house contains the bird and three lines; desktop side-by-side, mobile stacked, accepted dimensions retained',async({page},info)=>{
 await page.setViewportSize({width:900,height:1000});const f=await setup(page);const stage=page.locator('.raven-house .raven-stage'),copy=page.locator('.raven-house .raven-info');
 let a=await stage.boundingBox(),b=await copy.boundingBox();expect(b.x).toBeGreaterThan(a.x+a.width-1);expect(a.height).toBe(104);expect(a.width).toBeLessThanOrEqual(170);
 // The accepted formal theme has no decorative pseudo-element stripe.
 await expect(page.locator('.raven-info')).toHaveJSProperty('childElementCount',3);await expect(page.locator('#ravenNote')).toHaveAttribute('data-source','local');await expect(page.locator('#ravenCopySource')).toBeHidden();await expect(page.locator('#ravenCopySource')).toBeEmpty();
 expect(await page.locator('#todayStatus').evaluate(e=>getComputedStyle(e).fontSize)).toBe(await page.locator('#ravenMood').evaluate(e=>getComputedStyle(e).fontSize));
 expect(await page.locator('#ravenNote').evaluate(e=>getComputedStyle(e).fontSize)).toBe('15.5px');
 for(const width of [390,320]){await page.setViewportSize({width,height:844});a=await stage.boundingBox();b=await copy.boundingBox();if(width<379)expect(b.y).toBeGreaterThanOrEqual(a.y+a.height);else expect(b.x).toBeGreaterThanOrEqual(a.x+a.width);expect(a.height).toBe(width===320?96:104);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.locator('.raven-house').screenshot({path:screenshotPath(info,'raven-house-mobile-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.locator('.raven-house').screenshot({path:screenshotPath(info,'raven-house-mobile-dark.png')});expect(f.writes).toHaveLength(0);
});
test('native copy survives refresh, each state selects its mode, expiry keeps true timestamp and local scene provenance',async({page})=>{
 const f=await setup(page,{native:true});const note=page.locator('#ravenNote');await expect(note).toHaveText(f.value.note);await expect(note).toHaveAttribute('data-source','ziwei');await expect(page.locator('#ravenMood')).toHaveText('心情：安静，专注');await expect(page.locator('#ravenCopySource')).toBeHidden();await page.reload();await expect(note).toHaveText(f.value.note);
 for(const [state,mode] of Object.entries({'在工作':'Work','在休息':'Rest','在思考':'Think','在想你':'Affection'})){await f.publish({...f.value,state});await expect(page.locator('#ravenStage')).toHaveAttribute('data-mode',mode);}
 const updatedAt=new Date(Date.now()-31*60000).toISOString();await f.publish({...f.value,updatedAt});await expect(page.locator('#ravenStage')).toHaveAttribute('data-mode','Stale');await expect(page.locator('.raven-house')).toHaveAttribute('data-stale','true');await expect(note).toHaveAttribute('data-source','local');await expect(note).not.toHaveText('今天先把小屋整理好，再来陪你。');await expect(page.locator('#todayStatusTime')).toContainText('知微更新于');await expect(page.locator('#ravenCaption')).toBeHidden();await expect(page.locator('#ravenCaption')).toBeEmpty();
 await f.publish({source:'ziwei',state:'未知状态',updatedAt:new Date().toISOString()});await expect(note).toBeHidden();await expect(page.locator('#ravenStage')).toHaveAttribute('data-mode','Idle');expect(f.writes).toHaveLength(0);
});

test('real small raven remains inside the house beside its published copy',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,{native:true,real:true});await page.locator('#ravenCanvas').scrollIntoViewIfNeeded();await expect(page.locator('#ravenCanvas')).toHaveAttribute('data-ready','true',{timeout:30000});await expect(page.locator('#ravenCanvas')).toHaveAttribute('data-base-animation','Work');await page.locator('.raven-house').screenshot({path:screenshotPath(info,'raven-house-real-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.locator('.raven-house').screenshot({path:screenshotPath(info,'raven-house-real-dark.png')});
});
