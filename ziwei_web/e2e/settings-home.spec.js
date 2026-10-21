'use strict';
const {test,expect}=require('./helpers/isolated-app');
async function open(page){await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();}
test('settings categories scroll locally and fixed save stays reachable at phone and landscape sizes',async({page})=>{
 await open(page);const url=page.url();
 for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);await page.locator('#settingsButton').click();await expect(page.locator('#settings')).toBeVisible();
  for(const id of ['ourProfiles','experienceOptions','deviceSecurity','spaceAppearance']){
   await page.locator('[data-settings-section='+id+']').click();await expect(page.locator('#'+id+' legend')).toBeInViewport();await expect.poll(()=>page.locator('#'+id).evaluate(e=>e.getBoundingClientRect().top-document.getElementById('settingsContent').getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);expect(page.url()).toBe(url);await expect(page.locator('#settings')).toBeVisible();await expect(page.locator('#saveProfile')).toBeInViewport();await expect(page.locator('#closeSettings')).toBeInViewport();
  }
  expect(await page.locator('#settings').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);expect(await page.locator('#theme').evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(42);expect(await page.locator('#glassLevel').evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(30);
  await page.locator('#closeSettings').click();
 }
});
test('shared save submits profile and external appearance controls, then reopens at the start',async({page})=>{
 await open(page);await page.locator('#settingsButton').click();await page.locator('#theme').selectOption('dark');await page.locator('#background').selectOption('sage');await page.locator('[data-settings-section=ourProfiles]').click();await page.locator('#userNickname').fill('小小的名字');await page.locator('#saveProfile').click();await expect(page.locator('#settingsMessage')).toHaveText('已保存。');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('html')).toHaveAttribute('data-background','sage');await page.locator('#closeSettings').click();await expect(page.locator('#userName')).toHaveText('小小的名字');await page.reload();await expect(page.locator('#userName')).toHaveText('小小的名字');await page.locator('#settingsButton').click();await expect(page.locator('#theme')).toHaveValue('dark');await expect(page.locator('#userNickname')).toHaveValue('小小的名字');await expect(page.locator('#settingsContent')).toHaveJSProperty('scrollTop',0);await expect(page.locator('[data-settings-section=spaceAppearance]')).toHaveAttribute('aria-pressed','true');
});
test('heartbeat trace moves over a persistent line and remains clear when animation is disabled',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await open(page);const pulse=page.locator('.home .heartbeat .pulse'),base=page.locator('.home .heartbeat .pulse-base');
 await expect(pulse).toHaveCSS('animation-name','zw-heartbeat-line');const before=await pulse.evaluate(e=>getComputedStyle(e).strokeDashoffset);await expect.poll(()=>pulse.evaluate(e=>getComputedStyle(e).strokeDashoffset)).not.toBe(before);expect(Number(await base.evaluate(e=>getComputedStyle(e).opacity))).toBeGreaterThan(.2);
 for(const width of [320,390,844]){await page.setViewportSize({width,height:844});const positions=await page.locator('.pair').evaluate(e=>{const persons=[...e.querySelectorAll('.person')].map(n=>n.getBoundingClientRect()),line=e.querySelector('.heartbeat').getBoundingClientRect();return {left:persons[0].right,lineLeft:line.left,lineRight:line.right,right:persons[1].left,lineWidth:line.width};});expect(positions.left).toBeLessThan(positions.lineLeft);expect(positions.lineRight).toBeLessThan(positions.right);expect(positions.lineWidth).toBeGreaterThanOrEqual(64);}
 await page.emulateMedia({reducedMotion:'reduce'});await expect(pulse).toHaveCSS('animation-name','none');await expect(pulse).toHaveCSS('stroke-dasharray','none');await expect(base).toBeVisible();
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#settingsButton').click();await page.locator('#experienceMotion').uncheck();await page.locator('#closeSettings').click();await expect(pulse).toHaveCSS('animation-name','none');await expect(pulse).toHaveCSS('stroke-dasharray','none');await expect(base).toBeVisible();
});
