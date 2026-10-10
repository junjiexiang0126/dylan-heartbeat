'use strict';
const {test,expect}=require('@playwright/test');
async function login(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#home')).toBeVisible();await page.locator('[data-tab=chat]').click();}
test('chat, attachments, quotations, favorites, searching, history, reload and lock on mobile',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
 const video=require('../test/helpers/video_fixture.json');
 await page.locator('#chatFiles').setInputFiles([{name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('浏览器附件验收')},{name:'sticker.gif',mimeType:'image/gif',buffer:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')},{name:'video.webm',mimeType:'video/webm',buffer:Buffer.from(video.base64,'base64')}]);await expect(page.locator('#chatAttachments')).toContainText('notes.txt');await expect(page.locator('#chatAttachments')).toContainText('video.webm');
 const message='浏览器真实界面测试 '+Date.now();await page.locator('#chatInput').fill(message);await page.locator('#chatSend').click();
 const first=page.locator('.message.user').filter({hasText:message});await expect(first).toHaveCount(1);const originalId=await first.getAttribute('data-id');await expect(page.locator('#chatMessages')).toContainText('协议测试回复');await expect(first.locator('a').filter({hasText:'notes.txt'})).toBeVisible();await expect(first.locator('img')).toBeVisible();await expect.poll(()=>first.locator('img').evaluate(img=>img.naturalWidth)).toBe(1);await expect.poll(()=>first.locator('video').evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(1);await expect.poll(()=>first.locator('video').evaluate(v=>v.videoWidth)).toBe(32);
 await first.locator('video').evaluate(v=>v.play());await expect.poll(()=>first.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(0);
 await first.getByRole('button',{name:'复制',exact:true}).click();await expect(page.locator('#chatError')).toHaveText('已复制。');await first.getByRole('button',{name:'收藏',exact:true}).click();await page.locator('#chatFavorites').click();await expect(page.locator('#chatMessages .message')).toHaveCount(1);
 await first.getByRole('button',{name:'引用',exact:true}).click();await expect(page.locator('#chatQuote')).toBeVisible();await page.locator('#chatFavorites').click();await page.locator('#chatInput').fill('带引用的第二条消息');await page.locator('#chatSend').click();await expect(page.locator('.message-quote').filter({hasText:message})).toHaveCount(1);
 await page.locator('#chatSearch').fill(message);await expect(page.locator('#chatMessages .message')).toHaveCount(1);await page.locator('#chatSearch').fill('');
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatMessages')).toContainText(message);
 await page.locator('#chatSource').selectOption('archive');await expect(page.locator('#archiveNotice')).toContainText('不代表已成为知微的长期记忆');await expect(page.locator('#chatMessages')).toContainText('历史档案验收样本');await expect(page.locator('#chatForm')).toBeHidden();await page.locator('#chatSource').selectOption('live');
 for(const size of [{width:320,height:568},{width:390,height:844},{width:430,height:932}]){await page.setViewportSize(size);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 page.once('dialog',d=>d.accept());await page.locator('[data-id="'+originalId+'"]').getByRole('button',{name:'删除',exact:true}).click();await expect(page.locator('[data-id="'+originalId+'"]')).toHaveCount(0);await page.locator('#chatTrash').click();await expect(page.locator('[data-id="'+originalId+'"]')).toBeVisible();await page.locator('[data-id="'+originalId+'"]').getByRole('button',{name:'恢复',exact:true}).click();await page.locator('#chatTrash').click();await expect(page.locator('[data-id="'+originalId+'"]')).toBeVisible();await page.locator('[data-id="'+originalId+'"]').getByRole('button',{name:'取消收藏',exact:true}).click();
 await page.locator('#settingsButton').click();await page.locator('#logout').click();await expect(page.locator('#chatMessages')).toBeEmpty();expect(errors).toEqual([]);
});
test('network interruption after acceptance recovers the saved reply and avoids a second user message',async({page,context})=>{
 await login(page);const message='断线恢复界面测试 '+Date.now();await page.locator('#chatInput').fill(message);
 const accepted=page.waitForResponse(r=>r.url().endsWith('/api/chat/send')&&r.status()===202);await page.locator('#chatSend').click();await accepted;await context.setOffline(true);await expect(page.locator('#chatConnection')).toContainText('已离线');
 await new Promise(r=>setTimeout(r,900));await context.setOffline(false);await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.message.user').filter({hasText:message})).toHaveCount(1);await expect(page.locator('#chatMessages')).toContainText('协议测试回复');
});


test('440px mobile glass, dark text and navigation safe-area regression',async({page})=>{
 await page.setViewportSize({width:440,height:956});
 await login(page);
 await page.locator('[data-tab=home]').click();
 const check=async()=>{
   const layout=await page.evaluate(()=>{
     const nav=document.querySelector('nav');
     const panel=document.querySelector('#home');
     const glass=document.querySelector('.together');
     const style=getComputedStyle(glass,'::before');
     const panelStyle=getComputedStyle(panel);
     const navHeight=nav.getBoundingClientRect().height;
     const bottomGap=parseFloat(panelStyle.paddingBottom);
     return {scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,
       navHeight,bottomGap,blur:style.backdropFilter||style.webkitBackdropFilter,
       layer:style.content,glassPosition:getComputedStyle(glass).position};
   });
   expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
   expect(layout.bottomGap).toBeGreaterThan(layout.navHeight+35);
   expect(layout.glassPosition).toBe('relative');
   expect(layout.layer).not.toBe('none');
   expect(layout.blur).toContain('blur(');
 };
 await check();
 await page.locator('#settingsButton').click();
 await page.locator('#theme').selectOption('dark');
 await page.locator('#saveProfile').click();
 await page.locator('#closeSettings').click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 const contrast=await page.locator('.today p').evaluate(el=>{
   const c=getComputedStyle(el).color.match(/[\d.]+/g).map(Number);
   const bg=[33,27,38];
   const luminance=rgb=>{const v=rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
   const a=luminance(c),b=luminance(bg);
   return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 });
 expect(contrast).toBeGreaterThan(4.5);
 await check();
});
