'use strict';
const {test,expect}=require('@playwright/test');
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=','base64');
test('call and search align with settings and stay exclusive to chat',async({page})=>{
 await open(page);
 for(const size of [{width:320,height:568},{width:390,height:844},{width:440,height:956}]){
  await page.setViewportSize(size);
  const m=await page.evaluate(()=>['chatCall','chatSearchToggle','settingsButton'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {y:r.top+r.height/2,left:r.left,right:r.right};}));
  expect(Math.max(...m.map(x=>x.y))-Math.min(...m.map(x=>x.y))).toBeLessThan(1);
  const title=await page.locator('#chatPeer').boundingBox();expect(Math.abs(title.y+title.height/2-m[0].y)).toBeLessThan(1);expect(Math.abs(title.x+title.width/2-size.width/2)).toBeLessThan(2);await expect(page.locator('.brand')).toBeHidden();await expect(page.locator('#chatAvatar')).toBeVisible();
  expect(m[0].right).toBeLessThanOrEqual(m[1].left);expect(m[1].right).toBeLessThanOrEqual(m[2].left);
  expect(Math.abs((m[1].left-m[0].right)-(m[2].left-m[1].right))).toBeLessThan(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 }
 await page.locator('#chatSearchToggle').click();await expect(page.locator('#chatToolbar')).toBeVisible();
 await page.locator('[data-tab=home]').click();await expect(page.locator('#chatTopActions')).toBeHidden();
 await expect(page.locator('#settingsButton')).toBeVisible();await expect(page.locator('[data-tab]')).toHaveCount(5);
});
test('wallpaper can be selected, retained on reload and reset to theme',async({page})=>{
 await open(page);await expect(page.locator('#chatWallpaper')).toBeHidden();
 await page.locator('#settingsButton').click();await page.locator('#chatBackgroundFile').setInputFiles({name:'wallpaper.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('#chatBackgroundMessage')).toHaveText('聊天背景已保存到当前设备。');await page.locator('#closeSettings').click();
 await expect(page.locator('#chatWallpaper')).toBeVisible();
 const info=await page.locator('#chatWallpaperImage').evaluate(img=>({loaded:img.complete&&img.naturalWidth>0,blur:getComputedStyle(img).filter}));expect(info.loaded).toBe(true);expect(info.blur).toBe('none');
 await page.locator('[data-tab=home]').click();await expect(page.locator('#chatWallpaper')).toBeHidden();
 await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatWallpaper')).toBeVisible();
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatWallpaper')).toBeVisible();
 await page.locator('#settingsButton').click();await page.locator('#resetChatBackground').click();await expect(page.locator('#chatBackgroundMessage')).toContainText('恢复跟随整体主题');
 await page.locator('#closeSettings').click();await expect(page.locator('#chatWallpaper')).toBeHidden();
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatWallpaper')).toBeHidden();
});
test('background has no glass while bubbles, status and composer retain glass',async({page})=>{
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[{id:'appearance-1',role:'assistant',content:'聊天外观验收',attachments:[],created_at:'2026-10-14T00:00:00Z',status:'completed',source:'live'}],before:1,hasMore:false}}));
 await open(page);await expect(page.locator('.message-bubble')).toBeVisible();
 for(const colorScheme of ['light','dark']){
  await page.emulateMedia({colorScheme});await expect(page.locator('html')).toHaveAttribute('data-theme',colorScheme);
  const m=await page.evaluate(()=>{
   const css=(el,pseudo)=>getComputedStyle(el,pseudo);
   const blur=style=>style.backdropFilter||style.webkitBackdropFilter;
   return {backgroundBlur:blur(css(document.querySelector('#chat'))),backgroundLayer:css(document.querySelector('#chat'),'::before').content,
    surfaces:['#chatForm','#chatConnection','.message-bubble'].map(s=>{const e=document.querySelector(s),g=css(e,'::before');return {blur:blur(g),glassHeight:parseFloat(g.height),height:e.getBoundingClientRect().height};})};
  });
  expect(m.backgroundBlur).toBe('none');expect(m.backgroundLayer).toBe('none');
  for(const s of m.surfaces){expect(s.blur).toContain('blur(');expect(s.glassHeight).toBeLessThanOrEqual(s.height+1);}
 }
});
test('invalid background upload is rejected and logout hides the selected image',async({page})=>{
 await open(page);await page.locator('#settingsButton').click();
 await page.locator('#chatBackgroundFile').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
 await expect(page.locator('#chatBackgroundMessage')).toContainText('请选择');await expect(page.locator('#chatWallpaper')).toBeHidden();
 await page.locator('#chatBackgroundFile').setInputFiles({name:'wallpaper.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('#chatBackgroundMessage')).toContainText('已保存');await page.locator('#logout').click();
 await expect(page.locator('#chatWallpaper')).toBeHidden();await expect(page.locator('#chatTopActions')).toBeHidden();
});
