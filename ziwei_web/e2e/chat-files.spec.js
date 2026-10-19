'use strict';
const {test,expect}=require('./helpers/isolated-app'),fs=require('node:fs');
const fileId='a42ce262-b8cb-4c0b-837e-ad33f4c7ee35',audioId='a42ce262-b8cb-4c0b-837e-ad33f4c7ee36',bytes=Buffer.from('真实文件验收 ZW-FILE-729\n第二行：中文。\n');
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
function reply(extra={}){return {id:'reply-file-fixture',role:'assistant',source:'live',status:'completed',created_at:'2026-10-15T05:12:00Z',content:'给你发了张小纸条\nMEDIA:/data/hermes_native/workspace/outbox/给小语-20261015.txt\n路径备份：/data/hermes_native/workspace/outbox/给小语-20261015.txt',attachments:[],...extra};}
test('missing file remains visible beside audio; targeted retry produces a downloadable file card with exact bytes',async({page},info)=>{
 let complete=false,attempts=0,sends=0,deliveredId=fileId;page.on('request',r=>{if(r.url().endsWith('/api/chat/send'))sends++;});
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[reply({attachments:complete?[deliveredId]:[audioId],mediaDelivery:{state:complete?'complete':'failed',count:complete?1:0,error:complete?null:'media_file_missing'}})],hasMore:false}}));
 await page.route('**/api/chat/attachments/'+audioId+'/metadata',r=>r.fulfill({json:{id:audioId,name:'reading.mp3',mime:'audio/mpeg',size:100}}));await page.route('**/api/chat/attachments/'+audioId,r=>r.fulfill({status:404}));
 await page.route('**/api/chat/media/sync',r=>{expect(r.request().postDataJSON()).toEqual({messageId:'reply-file-fixture'});complete=++attempts>1;return r.fulfill({json:{ok:complete,data:[{state:complete?'complete':'failed'}]}});});
 await open(page);await expect(page.locator('.voice-play')).toBeVisible();await expect(page.locator('.file-delivery-status')).toContainText('原文件暂时找不到');
 const session=await(await page.request.get('/api/session')).json(),origin=new URL(page.url()).origin;
 const uploaded=await page.request.post('/api/chat/attachments',{headers:{Origin:origin,'X-Ziwei-CSRF':session.csrf,'X-Filename':encodeURIComponent('给小语-20261015.txt'),'Content-Type':'application/octet-stream'},data:bytes});expect(uploaded.status()).toBe(201);deliveredId=(await uploaded.json()).id;
 await page.getByRole('button',{name:'重试接收附件'}).click();await expect(page.locator('.file-delivery-status')).toContainText('原文件暂时找不到');expect(attempts).toBe(1);
 await page.getByRole('button',{name:'重试接收附件'}).click();await expect(page.locator('.file-card-name')).toHaveText('给小语-20261015.txt');await expect(page.locator('.file-delivery')).toHaveCount(0);expect(sends).toBe(0);
 for(const width of [320,390]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.locator('.file-card').click();await expect(page.locator('#fileViewer')).toBeVisible();await expect(page.locator('#fileClose')).toBeVisible();await expect(page.locator('#filePreview')).toContainText('真实文件验收 ZW-FILE-729');const waiting=page.waitForEvent('download');await page.locator('#fileSave').click();const download=await waiting;expect(download.suggestedFilename()).toBe('给小语-20261015.txt');const target=info.outputPath('received-note.txt');await download.saveAs(target);expect(fs.readFileSync(target).equals(bytes)).toBe(true);await page.locator('#fileBack').click();await expect(page.locator('#fileViewer')).toBeHidden();await expect(page.locator('#chat')).toBeVisible();
});
test('legacy MEDIA with an unrelated audio attachment still offers recovery; global sync never claims success after failure',async({page})=>{
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[reply({attachments:[audioId]})],hasMore:false}}));
 await page.route('**/api/chat/attachments/'+audioId+'/metadata',r=>r.fulfill({json:{id:audioId,name:'reading.mp3',mime:'audio/mpeg',size:100}}));await page.route('**/api/chat/attachments/'+audioId,r=>r.fulfill({status:404}));
 await page.route('**/api/chat/media/sync',r=>r.fulfill({json:{ok:false,data:[{state:'failed'}]}}));await open(page);await expect(page.getByRole('button',{name:'重试接收附件'})).toBeVisible();
 await page.locator('#chatSearchToggle').click();await page.locator('#chatMediaSync').click();await expect(page.locator('#chatHistoryStatus')).toContainText('部分附件尚未收到');
});
