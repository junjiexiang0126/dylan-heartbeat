'use strict';
const {test,expect}=require('@playwright/test');
async function open(page){await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();}
const record={id:'token-diary',title:'样式变量验收',date:'2026-10-15',at:'2026-10-15T15:00:00Z',savedAt:'2026-10-15T15:00:00Z',source:'protocol-fixture',document:true,preview:'真实原文由后端提供；此处是隔离的样式测试。'};
function diary(page){return page.route('**/api/records/diary?*',r=>r.fulfill({json:{data:[record],source:'hermes_native',total:1,nextOffset:null,errors:[],checkedAt:'2026-10-15T15:00:00Z'}}));}
async function measure(page){return page.locator('.diary-card').evaluate(n=>{const card=getComputedStyle(n),body=getComputedStyle(n.querySelector('.record-body'));return {font:parseFloat(body.fontSize),padding:parseFloat(getComputedStyle(document.querySelector('.shell')).paddingLeft),radius:parseFloat(card.borderTopRightRadius)};});}
test('shared font/spacing/radius controls change real diary rendering without editing component rules',async({page})=>{
 await diary(page);await open(page);await page.locator('[data-tab=logs]').click();await page.locator('[data-log-kind=diary]').click();await expect(page.locator('.diary-card')).toBeVisible();const before=await measure(page);
 await page.evaluate(()=>{const s=document.documentElement.style;s.setProperty('--ui-font-scale','1.1');s.setProperty('--ui-spacing-scale','1.2');s.setProperty('--ui-radius-scale','1.3');});
 const after=await measure(page);expect(after.font/before.font).toBeCloseTo(1.1,2);expect(after.padding/before.padding).toBeCloseTo(1.2,2);expect(after.radius/before.radius).toBeCloseTo(1.3,2);
 await page.locator('#logs').evaluate(n=>{n.style.setProperty('--records-diary-size','21px');document.documentElement.style.setProperty('--record-page-inline','31px');n.style.setProperty('--record-reading-radius','7px');});
 expect(await measure(page)).toEqual({font:21,padding:31,radius:7});
 await page.setViewportSize({width:900,height:900});expect(await measure(page)).toEqual({font:21,padding:31,radius:7});
});
test('Moments component color/typography/radius overrides work in both themes',async({page})=>{
 await page.route('**/api/moments?*',r=>r.fulfill({json:{data:[{id:'38fba572-d1f5-446c-962e-8d43a84be0ad',seq:1,author:'ziwei',text:'样式协议测试',at:'2026-10-15T15:00:00Z',images:[],likes:[],comments:[],interactions:[]}],sync:{available:true},cover:null,hasMore:false,before:1,approvals:[]}}));
 await open(page);await page.locator('[data-tab=moments]').click();await expect(page.locator('.moment-author')).toBeVisible();
 await page.locator('#moments').evaluate(n=>{n.style.setProperty('--moments-cover-radius','31px');n.style.setProperty('--moments-body-size','18px');n.style.setProperty('--moments-name-color','rgb(12, 65, 98)');});
 for(const theme of ['light','dark']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await expect(page.locator('#momentsCover')).toHaveCSS('border-top-left-radius','31px');await expect(page.locator('.moment-text')).toHaveCSS('font-size','18px');await expect(page.locator('.moment-author')).toHaveCSS('color','rgb(12, 65, 98)');}
});
test('workbench component tokens are adjustable without changing its behavior',async({page})=>{
 await page.route('**/api/workbench',r=>r.fulfill({json:{checkedAt:'2026-10-15T15:00:00Z',web:{status:'online'},native:{checkedAt:'2026-10-15T15:00:00Z',services:{hermes:'online',gateway:'online',guardian:'unknown'},deployment:{},memoryStorage:[],usage:{},wakes:[],tasks:[]},moments:{}}}));
 await open(page);await page.locator('#settingsButton').click();await page.locator('#openWorkbench').click();await expect(page.locator('#workbenchOverview>div').first()).toBeVisible();
 await page.locator('#workbench').evaluate(n=>{n.style.setProperty('--workbench-text-size','17px');n.style.setProperty('--workbench-heading-size','22px');n.style.setProperty('--workbench-dialog-radius','12px');});
 await expect(page.locator('#workbenchOverview>div').first()).toHaveCSS('font-size','17px');await expect(page.locator('#workbench h3').first()).toHaveCSS('font-size','22px');await expect(page.locator('#workbench')).toHaveCSS('border-top-left-radius','12px');
});
