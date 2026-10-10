'use strict';
const {test,expect}=require('@playwright/test');
async function login(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#home')).toBeVisible();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chat')).toBeVisible();await expect.poll(()=>page.evaluate(()=>!!window.ZiweiChat&&!!document.querySelector('#chatForm')?.onsubmit)).toBe(true);}
test('chat, attachments, quotations, favorites, searching, history, reload and lock on mobile',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
 const video=require('../test/helpers/video_fixture.json');
 await page.locator('#chatFiles').setInputFiles([{name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('浏览器附件验收')},{name:'sticker.gif',mimeType:'image/gif',buffer:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')},{name:'video.webm',mimeType:'video/webm',buffer:Buffer.from(video.base64,'base64')}]);await expect(page.locator('#chatAttachments')).toContainText('notes.txt');await expect(page.locator('#chatAttachments')).toContainText('video.webm');
 const message='浏览器真实界面测试 '+Date.now();await page.locator('#chatInput').fill(message);await page.locator('#chatSend').click();
 const first=page.locator('.message.user').filter({hasText:message});await expect(first).toHaveCount(1);const originalId=await first.getAttribute('data-id');await expect(page.locator('#chatMessages')).toContainText('协议测试回复');await expect(first.locator('a').filter({hasText:'notes.txt'})).toBeVisible();await expect(first.locator('img')).toBeVisible();await expect.poll(()=>first.locator('img').evaluate(img=>img.naturalWidth)).toBe(1);await expect.poll(()=>first.locator('video').evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(1);await expect.poll(()=>first.locator('video').evaluate(v=>v.videoWidth)).toBe(32);
 await first.locator('video').evaluate(async v=>{v.muted=true;await v.play()});await expect.poll(()=>first.locator('video').evaluate(v=>({ready:v.readyState,width:v.videoWidth,paused:v.paused}))).toMatchObject({width:32,paused:false});
 await first.getByRole('button',{name:'复制',exact:true}).click();await expect(page.locator('#chatError')).toHaveText('已复制。');await first.getByRole('button',{name:'收藏',exact:true}).click();await page.locator('#chatSearchToggle').click();await expect(page.locator('#chatToolbar')).toBeVisible();await page.locator('#chatFavorites').click();await expect(page.locator('#chatMessages .message')).toHaveCount(1);
 await first.getByRole('button',{name:'引用',exact:true}).click();await expect(page.locator('#chatQuote')).toBeVisible();await page.locator('#chatFavorites').click();await page.locator('#chatInput').fill('带引用的第二条消息');await page.locator('#chatSend').click();await expect(page.locator('.message-quote').filter({hasText:message})).toHaveCount(1);
 await page.locator('#chatSearch').fill(message);await expect(page.locator('#chatMessages .message')).toHaveCount(1);await page.locator('#chatSearch').fill('');
 await page.reload();await page.locator('[data-tab=chat]').click();await page.locator('#chatSearchToggle').click();await expect(page.locator('#chatMessages')).toContainText(message);
 await page.locator('#chatSource').selectOption('archive');await expect(page.locator('#archiveNotice')).toContainText('不代表已成为知微的长期记忆');await expect(page.locator('#chatMessages')).toContainText('历史档案验收样本');await expect(page.locator('#chatForm')).toBeHidden();await page.locator('#chatSource').selectOption('live');
 for(const size of [{width:320,height:568},{width:390,height:844},{width:430,height:932}]){await page.setViewportSize(size);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 page.once('dialog',d=>d.accept());await page.locator('[data-id="'+originalId+'"]').getByRole('button',{name:'删除',exact:true}).click();await expect(page.locator('[data-id="'+originalId+'"]')).toHaveCount(0);await page.locator('#chatTrash').click();await expect(page.locator('[data-id="'+originalId+'"]')).toBeVisible();await page.locator('[data-id="'+originalId+'"]').getByRole('button',{name:'恢复',exact:true}).click();await page.locator('#chatTrash').click();await expect(page.locator('[data-id="'+originalId+'"]')).toBeVisible();await page.locator('[data-id="'+originalId+'"]').getByRole('button',{name:'取消收藏',exact:true}).click();
 await page.locator('#settingsButton').click();await page.locator('#logout').click();await expect(page.locator('#chatMessages')).toBeEmpty();expect(errors).toEqual([]);
});
test('network interruption after acceptance recovers the saved reply and avoids a second user message',async({page,context})=>{
 await login(page);const message='断线恢复界面测试 '+Date.now();await page.locator('#chatInput').fill(message);
 const sendResponses=[];const sendFailures=[];const pageErrors=[];
 await page.evaluate(()=>{window.__sendEvents=[];const form=document.querySelector('#chatForm'),button=document.querySelector('#chatSend');button.addEventListener('click',()=>window.__sendEvents.push('button-click'));form.addEventListener('submit',()=>window.__sendEvents.push('form-submit'));});
 page.on('response',async response=>{if(new URL(response.url()).pathname==='/api/chat/send'){let body='';try{body=(await response.text()).slice(0,1200);}catch(e){body='unreadable: '+e.message;}sendResponses.push({status:response.status(),body});}});
 page.on('requestfailed',request=>{if(new URL(request.url()).pathname.startsWith('/api/chat/'))sendFailures.push({url:new URL(request.url()).pathname,error:request.failure()?.errorText});});
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.locator('#chatSend').click();
 try{await expect(page.locator('.message.user').filter({hasText:message})).toHaveCount(1);}catch(error){
  const ui=await page.evaluate(()=>({chatError:document.querySelector('#chatError')?.textContent,chatWork:document.querySelector('#chatWork')?.textContent,connection:document.querySelector('#chatConnection')?.textContent,sendDisabled:document.querySelector('#chatSend')?.disabled,inputValue:document.querySelector('#chatInput')?.value,visibleMessages:document.querySelector('#chatMessages')?.textContent?.slice(0,800),sendEvents:window.__sendEvents,formConnected:document.querySelector('#chatForm')?.isConnected,buttonForm:document.querySelector('#chatSend')?.form?.id,formHasSubmitHandler:!!document.querySelector('#chatForm')?.onsubmit,buttonHasClickHandler:!!document.querySelector('#chatSend')?.onclick}));
  throw new Error('Send diagnostic: '+JSON.stringify({sendResponses,sendFailures,pageErrors,ui})+'; '+error.message);
 }
 await context.setOffline(true);await expect(page.locator('#chatConnection')).toContainText('已离线');
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
   const c=getComputedStyle(el).color.match(/[0-9.]+/g).map(Number);
   const bg=[33,27,38];
   const luminance=rgb=>{const v=rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
   const a=luminance(c),b=luminance(bg);
   return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 });
 expect(contrast).toBeGreaterThan(4.5);
 await check();
});

test('all five panels clear the floating nav on compact, portrait and landscape screens',async({page})=>{
 await login(page);
 const sizes=[{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:440,height:956},{width:956,height:440}];
 for(const size of sizes){
   await page.setViewportSize(size);
   for(const name of ['chat','moments','home','memory','logs']){
     await page.locator('[data-tab="'+name+'"]').click();
     const metrics=await page.evaluate(name=>{
       const panel=document.getElementById(name),nav=document.querySelector('nav');
       const items=[...panel.children].filter(el=>!el.hidden&&getComputedStyle(el).display!=='none');
       const last=items[items.length-1];
       const tokens=getComputedStyle(document.documentElement);
       const reserve=parseFloat(getComputedStyle(panel).paddingBottom);
       const expected=parseFloat(tokens.getPropertyValue('--nav-h'))+parseFloat(tokens.getPropertyValue('--nav-offset'))+parseFloat(tokens.getPropertyValue('--nav-clear'));
       return {width:document.documentElement.scrollWidth,viewport:innerWidth,
         reserve,expected,lastBottom:last.getBoundingClientRect().bottom,navTop:nav.getBoundingClientRect().top};
     },name);
     expect(metrics.width,JSON.stringify({size,name,metrics})).toBeLessThanOrEqual(metrics.viewport);
     expect(metrics.reserve).toBeGreaterThanOrEqual(metrics.expected);
     await page.evaluate(name=>document.getElementById(name).scrollIntoView({block:'end'}),name);
     await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
     const gap=await page.evaluate(name=>{
       const panel=document.getElementById(name),nav=document.querySelector('nav');
       const visible=[...panel.children].filter(el=>!el.hidden&&getComputedStyle(el).display!=='none');
       return nav.getBoundingClientRect().top-visible[visible.length-1].getBoundingClientRect().bottom;
     },name);
     expect(gap,JSON.stringify({size,name,gap})).toBeGreaterThanOrEqual(0);
   }
 }
 expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('viewport-fit=cover');
});


test('glass blur changes real pixels relative to a no-blur control in Chromium',async({page,browserName})=>{
 // Playwright WebKit on Linux reports backdrop-filter support but does not render blur in screenshots,
 // including on a standalone page without application CSS (isolated probe #91).
 // Keep WebKit layout, computed-style, contrast and no-blur fallback checks in the other tests.
 test.skip(browserName === 'webkit', 'Linux Playwright WebKit backdrop-filter pixel rendering is unreliable; verify visually on real Safari.');
 await page.setViewportSize({width:640,height:360});
 await page.goto('/');
 await page.evaluate(()=>{
  const css=[...document.styleSheets].find(x=>x.href&&x.href.includes('/style.css'));
  const rules=[
   '.ambient,.shell{display:none!important}',
   '#glass-test-backdrop{position:fixed;inset:0;background:linear-gradient(to right,#000 0 50%,#fff 50% 100%);z-index:0}',
   '#glass-pixel-fixture{position:fixed!important;left:220px;top:110px;width:200px;height:100px;border-radius:0!important;z-index:1}',
   '#glass-pixel-fixture::before{border-radius:0!important}'
  ];
  for(const rule of rules)css.insertRule(rule,css.cssRules.length);
  const backdrop=document.createElement('div');backdrop.id='glass-test-backdrop';document.body.append(backdrop);
  const glass=document.createElement('div');glass.id='glass-pixel-fixture';glass.className='glass';document.body.append(glass);
 });
 const takeRow=async()=>{
  const png=await page.screenshot({scale:'css'});
  return page.evaluate(async base64=>{
   const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();
   const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
   const row=y=>Array.from({length:51},(_,i)=>ctx.getImageData(295+i,y,1,1).data[0]);
   return {inside:row(160),outside:row(90)};
  },png.toString('base64'));
 };
 const blurred=await takeRow();
 await page.evaluate(()=>{
  const css=[...document.styleSheets].find(x=>x.href&&x.href.includes('/style.css'));
  css.insertRule('#glass-pixel-fixture::before{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',css.cssRules.length);
 });
 const sharp=await takeRow();
 const jumps=a=>Math.max(...a.slice(1).map((n,i)=>Math.abs(n-a[i])));
 const delta=(a,b)=>a.reduce((sum,n,i)=>sum+Math.abs(n-b[i]),0)/a.length;
 expect(jumps(blurred.outside)).toBeGreaterThan(200);
 expect(jumps(sharp.inside)).toBeGreaterThan(70);
 const measuredDelta=delta(blurred.inside,sharp.inside);
 console.log('Glass pixel comparison',JSON.stringify({blurredJump:jumps(blurred.inside),sharpJump:jumps(sharp.inside),meanDelta:measuredDelta,blurred:blurred.inside,sharp:sharp.inside}));
 expect(measuredDelta).toBeGreaterThan(4);
});

test('dark glass secondary text remains readable on all background themes',async({page})=>{
 await login(page);
 await page.locator('[data-tab=home]').click();
 await page.locator('#settingsButton').click();
 await page.locator('#theme').selectOption('dark');
 await page.locator('#saveProfile').click();
 await page.locator('#closeSettings').click();
 for(const background of ['rose','sage','sky']){
  await page.locator('#settingsButton').click();
  await page.locator('#background').selectOption(background);
  await page.locator('#saveProfile').click();
  await page.locator('#closeSettings').click();
  await expect(page.locator('html')).toHaveAttribute('data-background',background);
  for(const selector of ['.today p','.status-tag','.footnote']){
   const info=await page.locator(selector).first().evaluate(el=>{
    const rgb=getComputedStyle(el).color.match(/[0-9.]+/g).slice(0,3).map(Number);
    const root=getComputedStyle(document.documentElement);
    const background=root.getPropertyValue('--bg').trim();
    const hex=background.match(/^#([0-9a-f]{6})$/i);
    if(!hex)throw Error('Unknown background token: '+background);
    const bg=[1,3,5].map(i=>parseInt(hex[1].slice(i-1,i+1),16));
    const lum=a=>{const c=a.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};
    const x=lum(rgb),y=lum(bg);
    return {contrast:(Math.max(x,y)+.05)/(Math.min(x,y)+.05),opacity:getComputedStyle(el).opacity};
   });
   expect(info.opacity,selector+' '+background).toBe('1');
   expect(info.contrast,selector+' '+background).toBeGreaterThan(4.5);
  }
 }
});

test('glass fallback remains opaque when blur is disabled',async({page})=>{
 await page.route('**/style.css',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\\n.glass::before{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:var(--bg)!important}'})});
 await page.goto('/');
 await page.evaluate(()=>{const css=[...document.styleSheets].find(x=>x.href&&x.href.includes('/style.css'));css.insertRule('.glass::before{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:var(--bg)!important}',css.cssRules.length)});
 const info=await page.locator('#login').evaluate(el=>({
  background:getComputedStyle(el,'::before').backgroundColor,
  blur:getComputedStyle(el,'::before').backdropFilter||getComputedStyle(el,'::before').webkitBackdropFilter
 }));
 expect(info.blur).toBe('none');
 expect(info.background).not.toBe('rgba(0, 0, 0, 0)');
});
