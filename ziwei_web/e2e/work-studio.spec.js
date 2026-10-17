'use strict';
const {test,expect}=require('@playwright/test');
const fixture={data:[{id:'user1',role:'user',text:'请制作四人中文课堂的活动计划。',at:'2026-10-17T01:00:00+07:00'},{id:'ziwei1',role:'ziwei',text:'我把活动安排交给白鸦，完成后由我核对。',stage:'delegated',at:'2026-10-17T01:00:01+07:00'},{id:'glm1',role:'glm',text:'四人轮流读汉字。\n\n每位学生完成一道二十内加减题。',stage:'draft',at:'2026-10-17T01:00:02+07:00'}],tasks:[],tools:[{id:'word',kind:'word',name:'Word 文档',enabled:true,authorized:false,revision:0,config:{title:'课堂计划'}}],usage:[]};
async function open(page,state=fixture){await page.setViewportSize({width:390,height:844});await page.route('**/api/work/messages',r=>r.fulfill({json:state}));await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=work]').click();await expect(page.locator('#work .message')).toHaveCount(3);}
test('three-person mobile chat reuses formal bubble geometry, actions and wallpaper',async({page},testInfo)=>{
 await open(page);await expect(page.locator('#work .message-avatar')).toHaveCount(3);const faces=await page.locator('.work-members button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));for(const width of faces)expect(width).toBeCloseTo(36,0);await expect(page.locator('#work .message-action-icon')).not.toHaveCount(0);
 const measure=async selector=>page.locator(selector).first().evaluate(n=>{const s=getComputedStyle(n);return {background:s.backgroundImage,radius:s.borderRadius,padding:s.padding,font:getComputedStyle(n.querySelector('.message-content')).fontFamily};});
 const work=await measure('#work .message.assistant .message-bubble');await page.locator('[data-tab=chat]').click();await page.locator('#chatInput').fill('样式验收');await page.locator('#chatSend').click();await expect(page.locator('#chat .message.assistant[data-kind=final] .message-bubble').first()).toBeVisible();const privateStyle=await measure('#chat .message.assistant[data-kind=final] .message-bubble');expect(work).toEqual(privateStyle);
 await page.locator('[data-tab=work]').click();await expect(page.locator('#work')).toBeVisible();
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:testInfo.outputPath('work-'+theme+'.png'),fullPage:true});}
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});const geometry=await page.locator('#workSend').evaluate(n=>{const r=n.getBoundingClientRect(),nav=document.querySelector('nav').getBoundingClientRect();return {right:r.right,bottom:r.bottom,navTop:nav.top,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};});expect(geometry.right).toBeLessThanOrEqual(width);expect(geometry.bottom).toBeLessThan(geometry.navTop);expect(geometry.scrollWidth).toBeLessThanOrEqual(width);}
});
test('Work search, quote, mention and independent tool center are usable',async({page})=>{
 await open(page);await page.locator('#workSearchToggle').click();await page.locator('#workSearchInput').fill('四人');await expect(page.locator('#work .message')).toHaveCount(2);await page.locator('#workSearchInput').fill('');await page.locator('#work .message-action-icon[aria-label="引用"]').first().click();await expect(page.locator('#workQuote')).toBeVisible();await page.locator('#workQuoteCancel').click();await page.locator('.work-members [data-work-mention="知微"]').click();await expect(page.locator('#workInput')).toHaveValue('@知微 ');
 await page.locator('#workToolsOpen').click();await expect(page.locator('#workToolCatalog')).toContainText('未授权');await page.locator('#workToolAdd').click();await expect(page.locator('#workRegister')).toBeVisible();await page.locator('#workToolsClose').click();await page.locator('[data-tab=home]').click();await expect(page.locator('#home')).toBeVisible();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatInput')).toBeVisible();
});

test('saved-draft recovery button submits once and remains inside mobile viewport',async({page})=>{
 const state={...fixture,tasks:[{id:'saved-draft',state:'failed',error:'invalid_work_tool_arguments',canResumeReview:true}],usage:[]};let resumes=0;
 await page.route('**/api/work/resume-review',async r=>{expect(r.request().method()).toBe('POST');expect(r.request().postDataJSON()).toEqual({taskId:'saved-draft'});expect(r.request().headers()['x-ziwei-csrf']).toBeTruthy();resumes++;state.tasks=[{id:'saved-draft',state:'reviewing',canResumeReview:false}];await r.fulfill({status:202,json:{task:state.tasks[0]}});});
 await open(page,state);const button=page.getByRole('button',{name:'继续审核已保存的草稿',exact:true});await expect(button).toBeVisible();
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});const g=await button.evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,navTop:document.querySelector('nav').getBoundingClientRect().top};});expect(g.left).toBeGreaterThanOrEqual(0);expect(g.right).toBeLessThanOrEqual(width);expect(g.bottom).toBeLessThan(g.navTop);}
 await button.click();await expect(button).toBeHidden();await expect(page.locator('#workTaskStatus')).toContainText('知微正在审核');await expect(page.locator('#workSend')).toBeDisabled();expect(resumes).toBe(1);
});

test('completed-delivery check submits once with CSRF and hides during repair',async({page})=>{
 const state={...fixture,tasks:[{id:'completed-task',state:'completed',canRepairDelivery:true}],usage:[]};let calls=0;
 await page.route('**/api/work/repair-delivery',async r=>{expect(r.request().postDataJSON()).toEqual({taskId:'completed-task'});expect(r.request().headers()['x-ziwei-csrf']).toBeTruthy();calls++;state.tasks=[{id:'completed-task',state:'reviewing',canRepairDelivery:false}];await r.fulfill({status:202,json:{task:state.tasks[0]}});});
 await open(page,state);const b=page.getByRole('button',{name:'检查并修订交付文件',exact:true});await expect(b).toBeVisible();
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});const r=await b.boundingBox();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(width);}
 await b.click();await expect(b).toBeHidden();await expect(page.locator('#workTaskStatus')).toContainText('知微正在审核');expect(calls).toBe(1);
});
