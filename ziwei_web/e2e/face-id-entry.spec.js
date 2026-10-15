'use strict';
const {test,expect}=require('@playwright/test');
const password='isolated-e2e-password-123456';
async function login(page){await page.goto('/');await page.locator('#password').fill(password);await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();}
async function settings(page){await page.locator('#settingsButton').click();await expect(page.locator('#settings')).toBeVisible();}
test('Face ID entry is above profile settings and visible without scrolling at phone sizes',async({page})=>{
 await login(page);
 for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);await settings(page);
  await expect(page.locator('#deviceSecurity legend')).toHaveText('Face ID / 设备解锁');
  expect(await page.locator('#deviceSecurity').evaluate(e=>!!(e.compareDocumentPosition(document.querySelector('#profileForm'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  if(size.height>400)await expect(page.locator('#registerPasskey')).toBeInViewport();
  expect(await page.locator('#settings').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.locator('#closeSettings').click();
 }
 await page.setViewportSize({width:390,height:844});await settings(page);await page.screenshot({path:require('node:path').resolve('../../face-id-settings.png')});
});
test('platform capability probe returning false does not conceal the Face ID entry',async({page})=>{
 await page.addInitScript(()=>{PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable=async()=>false;Object.defineProperty(navigator,'standalone',{value:true});});
 await page.goto('/');await expect(page.locator('#unlockButton')).toBeVisible();await expect(page.locator('#unlockButton')).toBeEnabled();
 await login(page);await settings(page);await expect(page.locator('#registerPasskey')).toBeEnabled();await expect(page.locator('#passkeyMessage')).toContainText('尚未开启');
});
test('unsupported browser keeps a visible entry and a specific explanation',async({page})=>{
 await page.addInitScript(()=>{window.PublicKeyCredential=undefined;});
 await page.goto('/');await expect(page.locator('#unlockButton')).toBeVisible();await expect(page.locator('#unlockButton')).toBeDisabled();await expect(page.locator('#unlockHint')).toContainText('当前浏览器不支持');
 await login(page);await settings(page);await expect(page.locator('#registerPasskey')).toBeDisabled();await expect(page.locator('#passkeyMessage')).toContainText('Safari');
});
test('server unavailable reason remains visible',async({page})=>{
 await page.route('**/api/session',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),passkeyAvailable:false}});});
 await login(page);await settings(page);await expect(page.locator('#registerPasskey')).toBeDisabled();await expect(page.locator('#passkeyMessage')).toContainText('服务端尚未启用');
});
test('empty password stays local and cancellation keeps password login available',async({page})=>{
 await login(page);await settings(page);let requests=0;page.on('request',r=>{if(r.url().includes('/api/passkey/register/options'))requests++;});
 await page.locator('#registerPasskey').click();await expect(page.locator('#passkeyMessage')).toContainText('请先输入访问密码');expect(requests).toBe(0);
 await page.evaluate(()=>{navigator.credentials.create=async()=>{throw new DOMException('Cancelled','NotAllowedError');};});
 await page.locator('#verifyPassword').fill(password);await page.locator('#registerPasskey').click();await expect(page.locator('#passkeyMessage')).toContainText('已取消或超时');await expect(page.locator('#verifyPassword')).toHaveValue('');await expect(page.locator('#registerPasskey')).toBeEnabled();
 await page.locator('#logout').click();await expect(page.locator('#loginForm')).toBeVisible();
});
