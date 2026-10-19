'use strict';
const {test,expect}=require('./helpers/isolated-app');
const fs=require('node:fs');
const stamp='2026-10-19T08:00:00Z';
const envelope=data=>({data,source:'hermes_native',readOnly:true,total:data.length,nextOffset:null,checkedAt:stamp,errors:[]});
test('full application glass and sticker HTTP preview',async({page},info)=>{
 const failed=[];page.on('response',r=>{if(r.url().match(/\.(css|js|svg|png)(\?|$)/)&&r.status()>=400)failed.push({url:r.url(),status:r.status()});});
 await page.route('**/api/records/**',r=>{const u=new URL(r.request().url()),kind=u.pathname.split('/').at(-1);return r.fulfill({json:envelope(kind==='memory'?[{id:'preview-memory',source:'memories/MEMORY.md',title:'预览样本',categories:['self'],content:'这是隔离测试内容，用于核对真实页面的排版与材质。',at:stamp,savedAt:stamp,revision:'preview'}]:[])});});
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();
 for(const name of ['sakura','rose','bow']){const res=await page.request.get('/stickers/sticker-'+name+'.svg');expect(res.status()).toBe(200);expect(res.headers()['content-type']).toContain('image/svg+xml');}
 expect((await page.request.get('/stickers/not-whitelisted.svg')).status()).toBe(404);
 const results=[];
 for(const width of [320,390,430,440]){
  await page.setViewportSize({width,height:844});
  for(const section of ['logs','memory']){
   await page.locator('[data-tab='+section+']').click();await expect(page.locator('#'+section)).toBeVisible();
   await expect.poll(()=>page.locator('#'+section+' .card-sticker').evaluateAll(es=>es.every(e=>e.complete&&e.naturalWidth>0))).toBe(true);
   const metrics=await page.locator('#'+section+' .card-sticker').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect(),s=getComputedStyle(e),c=getComputedStyle(e.parentElement),old=getComputedStyle(e.parentElement,'::before');return {src:e.getAttribute('src'),position:s.position,top:b.top-p.top,right:b.right-p.right,opacity:s.opacity,background:c.backgroundImage,fill:c.backgroundColor,blur:c.backdropFilter||c.webkitBackdropFilter,border:c.borderRadius,oldSticker:old.backgroundImage,oldDisplay:old.display};}));
   results.push({width,section,metrics});
   expect(metrics.length).toBeGreaterThan(0);for(const m of metrics){expect(m.position).toBe('absolute');expect(m.top).toBeLessThan(0);expect(m.right).toBeGreaterThan(0);}
   await page.screenshot({path:info.outputPath(section+'-'+width+'.png'),fullPage:true});
  }
 }
 results.push({styles:await page.locator('link[rel=stylesheet]').evaluateAll(es=>es.map(e=>({href:e.getAttribute('href'),loaded:!!e.sheet}))),failed});
 fs.writeFileSync(info.outputPath('audit.json'),JSON.stringify(results,null,2));expect(failed).toEqual([]);
});
