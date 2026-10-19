'use strict';
const {test,expect}=require('./helpers/isolated-app');
const fs=require('node:fs');
const path=require('node:path');
const stamp='2026-10-19T08:00:00Z';
const envelope=data=>({data,source:'hermes_native',readOnly:true,total:data.length,nextOffset:null,checkedAt:stamp,errors:[]});
test('full application glass and sticker HTTP preview',async({page},info)=>{
 test.setTimeout(120000);
 // These are the handed-off background strengths; glass edits must not change them.
 const css=fs.readFileSync(path.join(__dirname,'../public/flow-glow.css'),'utf8');
 expect([...css.matchAll(/--glow-strength:(\.[0-9]+)/g)].map(m=>m[1])).toEqual(['.62','.34','.60','.60']);
 const failed=[];page.on('response',r=>{if(r.url().match(/\.(css|js|svg|png)(\?|$)/)&&r.status()>=400)failed.push({url:r.url(),status:r.status()});});
 await page.route('**/api/records/**',r=>{const u=new URL(r.request().url()),kind=u.pathname.split('/').at(-1);const payload=envelope(kind==='memory'?[{id:'preview-memory',source:'memories/MEMORY.md',title:'预览样本',categories:['self'],content:'这是隔离测试内容，用于核对真实页面的排版与材质。',at:stamp,savedAt:stamp,revision:'preview'}]:[]);if(kind==='memory'){payload.data=['user','user','work','work','self'].map((category,i)=>({...payload.data[0],id:'preview-memory-'+i,categories:[category]}));payload.total=payload.data.length;payload.counts={user:2,work:2,self:1,protected:0,uncategorized:0};}return r.fulfill({json:payload});});
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();
 for(const asset of ['small-flower.png','petals.png','ribbon-bow.png']){const res=await page.request.get('/stickers/'+asset);expect(res.status()).toBe(200);expect(res.headers()['content-type']).toContain('image/png');}
 for(const name of ['sakura','rose','bow']){const res=await page.request.get('/stickers/sticker-'+name+'.svg');expect(res.status()).toBe(200);expect(res.headers()['content-type']).toContain('image/svg+xml');}
 expect((await page.request.get('/stickers/not-whitelisted.svg')).status()).toBe(404);
 const results=[];expect(await page.locator('link[rel=stylesheet]').evaluateAll(es=>es.every(e=>!!e.sheet))).toBe(true);
 for(const width of [320,390,430,440]){
  await page.setViewportSize({width,height:844});
  for(const section of ['logs','memory']){
   await page.locator('[data-tab='+section+']').click();await expect(page.locator('#'+section)).toBeVisible();
   await expect.poll(()=>page.locator('#'+section+' .card-sticker').evaluateAll(es=>es.every(e=>e.complete&&e.naturalWidth>0))).toBe(true);
   const metrics=await page.locator('#'+section+' .card-sticker').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect(),s=getComputedStyle(e),c=getComputedStyle(e.parentElement),old=getComputedStyle(e.parentElement,'::before');return {src:e.getAttribute('src'),position:s.position,top:b.top-p.top,right:b.right-p.right,opacity:s.opacity,background:c.backgroundImage,fill:c.backgroundColor,blur:c.backdropFilter||c.webkitBackdropFilter,border:c.borderRadius,oldSticker:old.backgroundImage,oldDisplay:old.display,active:e.parentElement.classList.contains('active')};}));
   results.push({width,section,metrics});
   expect(metrics.length).toBeGreaterThan(0);for(const m of metrics){expect(m.position).toBe('absolute');expect(m.top).toBeLessThan(0);expect(m.right).toBeGreaterThan(0);expect(m.background).toBe('none');expect(m.fill).toBe(m.active?'rgba(255, 255, 255, 0.18)':'rgba(255, 255, 255, 0.12)');expect(m.blur).toBe('blur(14px) saturate(1.5)');if(section==='logs')expect(m.oldDisplay).toBe('none');}
   await page.screenshot({path:info.outputPath(section+'-'+width+'.png'),fullPage:true});
  }
 }
 await page.locator('[data-tab=memory]').click();await page.locator('#memoryOverviewRefresh').click();await expect(page.locator('#memory .card-sticker')).toHaveCount(3);await expect(page.locator('.memory-primary > .card-sticker')).toHaveCount(0);
 await page.locator('.memory-primary').click();await expect(page.locator('#memoryRecords')).toContainText('隔离测试内容');await page.locator('#memoryBack').click();await expect(page.locator('#memoryOverview')).toBeVisible();
 await page.locator('[data-tab=logs]').click();await expect(page.locator('[data-log-kind=impressions] > .card-sticker')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-tab=home]').click();await page.locator('#settingsButton').click();await page.locator('#theme').selectOption('dark');await page.locator('#saveProfile').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.locator('#closeSettings').click();
 for(const section of ['logs','memory']){await page.locator('[data-tab='+section+']').click();await page.screenshot({path:info.outputPath(section+'-dark-390.png'),fullPage:true});const fill=await page.locator(section==='logs'?'#logs .log-entry:not(.active) > .card-sticker':'#memory .card-sticker').first().evaluate(e=>getComputedStyle(e.parentElement).backgroundColor);expect(fill).toBe('rgba(255, 255, 255, 0.06)');}
 results.push({styles:await page.locator('link[rel=stylesheet]').evaluateAll(es=>es.map(e=>({href:e.getAttribute('href'),loaded:!!e.sheet}))),failed});
 fs.writeFileSync(info.outputPath('audit.json'),JSON.stringify(results,null,2));expect(failed).toEqual([]);
});
