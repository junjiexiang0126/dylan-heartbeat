'use strict';
const {test,expect}=require('@playwright/test');
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
const row=(role,content,status='completed')=>({id:'profile-'+role,role,content,status,attachments:[],created_at:'2026-10-15T00:00:00Z',source:'live'});
test('both saved avatars flank compact bubbles, scale with font, survive reload and clear on logout',async({page})=>{
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[row('user','27'),row('assistant','收到')],before:1,hasMore:false}}));
 await open(page);await page.locator('#settingsButton').click();
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=20;return c.toDataURL('image/png').split(',')[1];});
 for(const who of ['user','ziwei']){await page.locator('#'+who+'AvatarFile').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await expect(page.locator('#settingsMessage')).toContainText('头像已准备好');}
 await page.locator('#saveProfile').click();await expect(page.locator('#settingsMessage')).toHaveText('已保存。');await page.locator('#closeSettings').click();
 for(const role of ['user','assistant'])await expect(page.locator('.message.'+role+' .message-avatar img')).toBeVisible();
 const dimensions=()=>page.locator('.message.user .message-bubble').evaluate(el=>({width:el.getBoundingClientRect().width,padding:parseFloat(getComputedStyle(el).paddingLeft),radius:parseFloat(getComputedStyle(el).borderTopLeftRadius)}));
 let small,large;
 for(const font of ['12','20']){
  await page.locator('#settingsButton').click();await page.locator('#chatFontSize').fill(font);await page.locator('#chatFontSize').dispatchEvent('change');await expect(page.locator('#chatFontMessage')).toContainText('已保存');await page.locator('#closeSettings').click();
  await expect(page.locator('.message-content').first()).toHaveCSS('font-size',font+'px');if(font==='12')small=await dimensions();else large=await dimensions();
  for(const width of [320,390,440]){await page.setViewportSize({width,height:844});
   const rects=await page.locator('.message').evaluateAll(cards=>cards.map(el=>{const a=el.querySelector('.message-avatar').getBoundingClientRect(),b=el.querySelector('.message-bubble').getBoundingClientRect();return {user:el.classList.contains('user'),avatarLeft:a.left,avatarRight:a.right,bubbleLeft:b.left,bubbleRight:b.right,bubbleWidth:b.width};}));
   for(const r of rects){expect(r.user?r.avatarLeft>=r.bubbleRight:r.avatarRight<=r.bubbleLeft).toBe(true);expect(r.bubbleWidth).toBeLessThan(100);}
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
 }
 expect(large.width).toBeGreaterThan(small.width);expect(large.padding).toBeGreaterThan(small.padding);expect(large.radius).toBeGreaterThan(small.radius);
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.message-avatar img')).toHaveCount(2);await expect(page.locator('.message-content').first()).toHaveCSS('font-size','20px');
 await page.locator('#settingsButton').click();await page.locator('#logout').click();await expect(page.locator('#chatMessages')).toBeEmpty();
});
test('failed model reply is separate from connection health and a later success clears the notice',async({page})=>{
 let failed=true;
 await page.route('**/api/chat/status',r=>r.fulfill({json:{configured:true,connected:true}}));
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[row('assistant',failed?'API call failed: HTTP 503: Service is too busy.':'成功回复',failed?'failed':'completed')],before:1,hasMore:false}}));
 await open(page);await expect(page.locator('#chatConnection')).toHaveText('已连接');await expect(page.locator('#chatServiceNotice')).toContainText('模型服务暂不可用');await expect(page.locator('#chatInput')).toBeEnabled();
 failed=false;await page.locator('[data-tab=home]').click();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatServiceNotice')).toBeHidden();await expect(page.locator('#chatMessages')).toContainText('成功回复');
});
