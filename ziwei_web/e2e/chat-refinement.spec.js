'use strict';
const {test,expect}=require('@playwright/test');
const {screenshotPath}=require('./helpers/screenshot-path');
const row=(id,content,kind='final')=>({id,seq:1,role:'assistant',kind,content,attachments:[],created_at:'2026-10-16T05:00:00Z',status:'completed',source:'live'});
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
test('Agent messages stay independent, code stays intact, and the summary toggle persists',async({page},info)=>{
 await page.addInitScript(()=>{window.EventSource=class extends EventTarget{constructor(){super();window.__replyEvents=this;}close(){}};});
 const code='这是完整工作说明。\n```js\nconst text = "<script>unsafe()</script>";\nconsole.log(text);\n```';
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[row('summary','先核对范围，再执行。','summary'),row('one','我在。'),row('two','把今天慢慢讲给我听。'),row('work',code)],before:1,hasMore:false,requests:[{id:'wire',state:'running'}]}}));
 await open(page);await expect(page.locator('[data-id=one] .message-content')).toHaveText('我在。');await expect(page.locator('[data-id=two]')).toBeVisible();await expect(page.locator('[data-id=work] .chat-code code')).toHaveText('const text = "<script>unsafe()</script>";\nconsole.log(text);\n');await expect(page.locator('[data-id=work] .message-content script')).toHaveCount(0);await expect(page.locator('[data-id=summary]')).toBeHidden();
 await page.evaluate(()=>window.__replyEvents.dispatchEvent(new MessageEvent('message.delta',{data:JSON.stringify({requestId:'wire',delta:'{\"summary\":\"未完成的展示封包'})})));await expect(page.locator('#chatStreaming')).toBeEmpty();
 await page.locator('#showThoughts').check();await expect(page.locator('[data-id=summary]')).toBeVisible();await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('#showThoughts')).toBeChecked();await expect(page.locator('[data-id=summary]')).toBeVisible();await page.locator('#showThoughts').uncheck();await expect(page.locator('[data-id=summary]')).toBeHidden();
 for(const width of [320,390,844]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('#chatInput')).toBeInViewport();}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:screenshotPath(info,'chat-refined.png')});
});
test('prepared file sharing keeps a usable close and return path in an iPhone PWA',async({page})=>{
 const id='a42ce262-b8cb-4c0b-837e-ad33f4c7ee35';let popups=0;page.on('popup',()=>popups++);
 await page.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{value:true});Object.defineProperty(navigator,'userAgent',{value:'iPhone'});navigator.canShare=()=>true;navigator.share=async value=>{window.__sharedText=await value.files[0].text();throw new DOMException('cancelled','AbortError');};});
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[{...row('file','给你的小纸条'),attachments:[id]}],hasMore:false}}));await page.route('**/api/chat/attachments/'+id+'/metadata',r=>r.fulfill({json:{id,name:'小纸条.txt',mime:'text/plain',size:12}}));await page.route('**/api/chat/attachments/'+id,r=>r.fulfill({body:'只属于这份文件的原文',contentType:'text/plain'}));
 await open(page);const url=page.url();await page.locator('.file-card').click();await expect(page.locator('#filePreview')).toContainText('只属于这份文件的原文');await page.locator('#fileSave').click();await expect(page.locator('#fileViewerStatus')).toContainText('已取消分享');expect(await page.evaluate(()=>window.__sharedText)).toBe('只属于这份文件的原文');await expect(page.locator('#fileClose')).toBeInViewport();await expect(page.locator('#fileBack')).toBeInViewport();
 await page.evaluate(()=>navigator.canShare=()=>false);await page.locator('#fileSave').click();await expect(page.locator('#fileViewerStatus')).toContainText('Safari');expect(page.url()).toBe(url);expect(popups).toBe(0);await page.locator('#fileClose').click();await expect(page.locator('#filePreview')).toBeEmpty();await expect(page.locator('#chat')).toBeVisible();
});
test('glass preferences are adjustable and all five panels retain their entrances',async({page},info)=>{
 await page.emulateMedia({reducedMotion:'reduce'});await open(page);await page.locator('#settingsButton').click();await page.locator('#glassLevel').fill('45');await page.locator('#glassLevel').dispatchEvent('input');await page.locator('#reduceGlass').check();await page.locator('#closeSettings').click();await expect(page.locator('html')).toHaveAttribute('data-reduce-glass','true');
 await page.reload();await page.locator('#settingsButton').click();await expect(page.locator('#glassLevel')).toHaveValue('45');await expect(page.locator('#reduceGlass')).toBeChecked();await page.locator('#reduceGlass').uncheck();await page.locator('#closeSettings').click();
 await page.setViewportSize({width:390,height:844});for(const theme of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);for(const panel of ['home','moments','memory','logs','chat']){await page.locator('[data-tab='+panel+']').click();await expect(page.locator('#'+panel)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(panel==='memory')await expect(page.locator('.memory-entry')).toHaveCount(4);if(panel==='logs')await expect(page.locator('.log-entry')).toHaveCount(4);await page.screenshot({path:screenshotPath(info,'refined-'+panel+'-'+theme+'.png'),fullPage:true});}}
 await expect(page.locator('nav [data-tab]')).toHaveCount(5);
});

test('space wallpaper persists locally, stays sharp, and clears from locked UI',async({page})=>{
 await open(page);await page.locator('#settingsButton').click();
 const bytes=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=24;const ctx=canvas.getContext('2d');ctx.fillStyle='#e8b2c8';ctx.fillRect(0,0,24,24);return canvas.toDataURL('image/png').split(',')[1];});
 await page.locator('#spaceBackgroundFile').setInputFiles({name:'space.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});await expect(page.locator('#spaceBackgroundStatus')).toContainText('空间壁纸已保存');await page.locator('#closeSettings').click();await expect(page.locator('#spaceWallpaper')).toBeVisible();await expect(page.locator('#spaceWallpaper img')).toHaveCSS('filter','none');
 await page.reload();await expect(page.locator('#spaceWallpaper')).toBeVisible();await page.locator('#settingsButton').click();await page.locator('#logout').click();await expect(page.locator('#spaceWallpaper')).toBeHidden();await expect(page.locator('#spaceWallpaper img')).not.toHaveAttribute('src',/./);
});
