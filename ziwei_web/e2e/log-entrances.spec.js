'use strict';
const {test,expect}=require('@playwright/test');
const now='2026-10-16T03:00:00Z';
const result=data=>({data,total:data.length,nextOffset:null,source:'hermes_native',checkedAt:now,errors:[]});
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=logs]').click();}

test('four log entrances preserve private boundaries, including a late shared response',async({page})=>{
 const calls=[];let hold=false,release;
 await page.route('**/api/records/**',async route=>{const url=new URL(route.request().url());calls.push(url.pathname);if(hold)await new Promise(resolve=>release=resolve);await route.fulfill({json:result([{id:'work-entry',title:'可分享的工作记录',at:now,preview:'已保存的工作原文',basis:'agent_briefing',state:'recorded'}])});});
 await open(page);await expect(page.locator('.log-entry')).toHaveCount(4);await expect(page.locator('#logRecords')).toContainText('已保存的工作原文');
 hold=true;await page.locator('#logRefresh').click();await expect.poll(()=>typeof release).toBe('function');
 await page.locator('[data-log-kind=private]').click();await expect(page.locator('#logUnavailable')).toContainText('只写给知微自己');await expect(page.locator('#logReader')).toBeHidden();await expect(page.locator('#logRefresh')).toBeHidden();await expect(page.locator('#logRecords')).toBeEmpty();await expect(page.locator('#logStatus')).toBeEmpty();
 const count=calls.length;release();await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));document.querySelector('#logRefresh').click();});await page.waitForTimeout(150);
 expect(calls).toHaveLength(count);expect(calls.every(path=>path==='/api/records/work')).toBe(true);await expect(page.locator('#logRecords')).toBeEmpty();await expect(page.locator('#logStatus')).toBeEmpty();await expect(page.locator('[data-log-kind=private]')).not.toContainText(/\d/);
 await page.locator('[data-log-kind=photos]').click();await expect(page.locator('#logUnavailable')).toContainText('尚未接入');await expect(page.locator('#logReader')).toBeHidden();await expect(page.locator('#logs input[type=file]')).toHaveCount(0);expect(calls).toHaveLength(count);
 hold=false;await page.locator('[data-log-kind=work]').click();await expect(page.locator('#logRecords')).toContainText('已保存的工作原文');await expect(page.locator('#logReader')).toBeVisible();
});

test('shared diary uses native title, and log card tokens work at mobile widths and in both themes',async({page})=>{
 await page.route('**/api/records/**',route=>route.fulfill({json:result(new URL(route.request().url()).pathname.endsWith('/diary')?[{id:'diary-0000000000000001',title:'窗边的小标题',date:'2026-10-16',at:now,preview:'给她看的原文',document:true}]:[])}));
 await open(page);await page.locator('[data-log-kind=diary]').click();await expect(page.locator('.diary-card .record-title')).toHaveText('窗边的小标题');
 await page.locator('#logs').evaluate(node=>{node.style.setProperty('--log-entry-radius','9px');node.style.setProperty('--log-entry-title-size','21px');node.style.setProperty('--log-entry-padding','17px');node.style.setProperty('--log-entry-accent','rgb(12, 65, 98)');});
 for(const theme of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);for(const width of [320,390,900]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('.log-entry').first()).toHaveCSS('border-top-left-radius','9px');await expect(page.locator('.log-entry strong').first()).toHaveCSS('font-size','21px');await expect(page.locator('.log-entry').first()).toHaveCSS('padding-left','17px');await expect(page.locator('.log-entry-label').first()).toHaveCSS('color','rgb(12, 65, 98)');}}
 await expect(page.locator('nav [data-tab]')).toHaveCount(5);
});
