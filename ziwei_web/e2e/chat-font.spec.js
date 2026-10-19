'use strict';
const {test,expect}=require('./helpers/isolated-app');
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
test('chat font changes immediately, persists across reload, and resets without changing theme',async({page})=>{
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[{id:'font-fixture',role:'assistant',content:'聊天字号预览',attachments:[],created_at:'2026-10-15T00:00:00Z',status:'completed',source:'live'}],before:1,hasMore:false}}));
 await open(page);await expect(page.locator('.message-content')).toHaveCSS('font-size','14px');
 const theme=await page.locator('html').getAttribute('data-theme');
 await page.locator('#settingsButton').click();await page.locator('#chatFontSize').fill('12');await page.locator('#chatFontSize').dispatchEvent('change');
 await expect(page.locator('#chatFontValue')).toHaveText('12 px');await expect(page.locator('#chatFontMessage')).toContainText('已保存');
 await page.locator('#closeSettings').click();await expect(page.locator('.message-content')).toHaveCSS('font-size','12px');await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.message-content')).toHaveCSS('font-size','12px');
 await page.locator('#settingsButton').click();await expect(page.locator('#chatFontSize')).toHaveValue('12');await expect(page.locator('#chatFontValue')).toHaveText('12 px');await page.locator('#chatFontSize').fill('20');await page.locator('#chatFontSize').dispatchEvent('change');await expect(page.locator('#chatFontPreview')).toHaveCSS('font-size','20px');
 await page.locator('#resetChatFont').click();await expect(page.locator('#chatFontMessage')).toContainText('已保存');await page.locator('#closeSettings').click();
 await expect(page.locator('.message-content')).toHaveCSS('font-size','14px');await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.message-content')).toHaveCSS('font-size','14px');
 await expect(page.locator('#chatInput')).toHaveCSS('font-size','16px');
});
