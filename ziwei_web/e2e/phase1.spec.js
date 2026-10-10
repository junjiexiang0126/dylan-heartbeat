'use strict';
const {test,expect}=require('@playwright/test');
const password='isolated-e2e-password-123456';
async function login(page){await page.goto('/');await page.locator('#password').fill(password);await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#home')).toBeVisible();}
test('five tabs, protected startup, profiles, avatars, themes and revocation on phone sizes',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#app')).toBeHidden();
  await login(page);await expect(page.locator('nav button')).toHaveCount(5);await expect(page.locator('nav button').nth(2)).toHaveAttribute('data-tab','home');
  await expect(page.locator('#home')).toContainText('待确认');await expect(page.locator('#home')).toContainText('2026.10.07');await expect(page.locator('#home')).toContainText('等待知微同步今日状态');
  for(const name of ['chat','moments','memory','logs','home']){await page.locator(`[data-tab="${name}"]`).click();await expect(page.locator('#'+name)).toBeVisible();await expect(page.locator(`[data-tab="${name}"]`)).toHaveAttribute('aria-current','page');}
  await page.locator('#settingsButton').click();await page.locator('#userNickname').fill('<img src=x onerror=a()>');await page.locator('#ziweiNickname').fill('测试知微');await page.locator('#theme').selectOption('dark');await page.locator('#background').selectOption('sage');
  // A raster image is resized before upload, then survives a fresh page load.
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=20;const ctx=c.getContext('2d');ctx.fillStyle='#ac667e';ctx.fillRect(0,0,20,20);return c.toDataURL('image/png').split(',')[1];});const png=Buffer.from(image,'base64');
  await page.locator('#userAvatarFile').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});await expect(page.locator('#settingsMessage')).toContainText('头像已准备好');
  await page.locator('#saveProfile').click();await expect(page.locator('#settingsMessage')).toHaveText('已保存。');await page.locator('#closeSettings').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('#userName')).toHaveText('<img src=x onerror=a()>');await expect(page.locator('#userName img')).toHaveCount(0);await expect(page.locator('#userAvatar img')).toBeVisible();
  await page.reload();await expect(page.locator('#home')).toBeVisible();await expect(page.locator('#ziweiName')).toHaveText('测试知微');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  for(const size of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:820,height:1180}]){await page.setViewportSize(size);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  const second=await context.newPage();await second.goto('/');await expect(second.locator('#app')).toBeVisible();
  await page.locator('#settingsButton').click();await page.locator('#logoutAll').click();await expect(page.locator('#login')).toBeVisible();await second.reload();await expect(second.locator('#login')).toBeVisible();expect(errors).toEqual([]);
});
test('real WebAuthn signature verification, passkey login, replay rejection and removal',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','CDP virtual authenticator is Chromium-only; real iPhone biometric verification remains pending.');
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await login(page);await page.locator('#settingsButton').click();await page.locator('#verifyPassword').fill(password);
  let registration;
  page.on('request',r=>{if(r.url().endsWith('/api/passkey/register/verify'))registration=r.postDataJSON();});
  await expect(page.locator('#registerPasskey')).toBeEnabled();await page.locator('#registerPasskey').click();await expect(page.locator('#passkeyMessage')).toContainText('设备解锁已开启');
  await page.locator('#logout').click();await expect(page.locator('#login')).toBeVisible();await page.locator('#unlockButton').click();await expect(page.locator('#home')).toBeVisible();
  const s=await page.evaluate(()=>fetch('/api/session').then(r=>r.json()));
  const replay=await context.request.post('/api/passkey/register/verify',{headers:{Origin:'http://localhost:3187','X-Ziwei-CSRF':s.csrf},data:registration});expect(replay.status()).toBe(400);
  await page.locator('#settingsButton').click();await expect(page.locator('#passkeyMessage')).toContainText('已保存 1 个');await page.locator('#verifyPassword').fill(password);await page.locator('#removePasskeys').click();await expect(page.locator('#passkeyMessage')).toContainText('已移除');
  await page.locator('#logout').click();await page.locator('#unlockButton').click();await expect(page.locator('#loginError')).toContainText('验证失败');await expect(page.locator('#app')).toBeHidden();
});
