'use strict';
const {test,expect}=require('./helpers/isolated-app');
const {screenshotPath}=require('./helpers/screenshot-path');
const at='2026-10-21T15:00:00+07:00';
const envelope=data=>({data,total:data.length,nextOffset:null,source:'hermes_native',checkedAt:at,errors:[]});
async function login(page){await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();}
test('diary reads as paragraphs with safe formatting; original stays available on demand',async({page},info)=>{
 const body='**排版预览样例。** 今天把一段对话留了下来。\n\n不是所有片段都要马上有结论，有些话可以再想一会儿。\n\n### 后来想到\n\n> 一句话，也可以成为一页的开头。\n\n- 留住具体的片段\n- 以后还可以接着聊\n\n```python\nprint("only shown on request")\n```';
 const original='心情：安静\n\n## 留一页给以后\n\n'+body;
 await page.route('**/api/records/diary?*',r=>r.fulfill({json:new URL(r.request().url()).searchParams.has('id')?{id:'one',title:'留一页给以后',content:body,originalContent:original,revision:'rev',date:'2026-10-21',source:'fixture/diary.md'}:envelope([{id:'one',title:'留一页给以后',preview:body.slice(0,180),date:'2026-10-21',at,source:'fixture/diary.md',mood:'安静',document:true,revision:'rev'}])}));
 await login(page);await page.locator('[data-tab=logs]').click();await page.locator('[data-log-kind=diary]').click();await expect(page.locator('.diary-card')).not.toContainText('未记录');await expect(page.locator('.diary-card .record-body')).not.toContainText('**');await page.locator('.diary-open').click();
 const reader=page.locator('.diary-card .record-body');await expect(reader.locator('strong')).toHaveText('排版预览样例。');await expect(reader.locator('h3')).toHaveText('后来想到');await expect(reader.locator('blockquote')).toContainText('一句话');await expect(reader.locator('li')).toHaveCount(2);
 await expect(reader.locator('.record-code pre')).toBeHidden();await page.screenshot({path:screenshotPath(info,'diary-reading.png'),fullPage:true});
 await reader.locator('.record-code summary').click();await expect(reader.locator('code').last()).toContainText('only shown on request');
 await page.locator('.record-provenance summary').click();await expect(page.locator('.record-original')).toHaveText(original);
 for(const width of [320,390,900]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
test('work choices and JSON prose read naturally while raw fields remain in original',async({page},info)=>{
 const raw=JSON.stringify({choice:'self_directed_task',did:'把今天卡住的一点理顺了。\n\n**还留着一件事**，下次继续。',evidence:['workspace/private-code.py']});
 await page.route('**/api/records/work?*',r=>r.fulfill({json:envelope([{id:'work',title:'self_directed_task',basis:'agent_briefing',state:'recorded',preview:raw,source:'workspace/briefings.jsonl',at,opportunity:3}])}));
 await login(page);await page.locator('[data-tab=logs]').click();await page.locator('[data-log-kind=work]').click();await expect(page.locator('.work-timeline-title')).toHaveText('做了一点自己的事');await expect(page.locator('.work-timeline-summary')).not.toContainText('choice');await page.locator('.work-timeline-entry').click();
 await expect(page.locator('.record-body strong')).toHaveText('还留着一件事');await expect(page.locator('.record-body')).not.toContainText('self_directed_task');await expect(page.locator('.record-body')).not.toContainText('private-code');await page.screenshot({path:screenshotPath(info,'work-reading.png'),fullPage:true});
 await page.locator('.record-provenance summary').click();await expect(page.locator('.record-original')).toHaveText(raw);
});
test('memory markup and malicious links never execute or load external images',async({page},info)=>{
 const content='### 记住的一句话\n\n真实内容 FIRST，**原来的意思**。\n\n<img src="https://example.invalid/pixel" onerror="window.RECORD_XSS=1">\n\n[不要执行](javascript:alert(1))\n\n| 片段 | 备注 |\n| --- | --- |\n| 一句话 | 以后再聊 |';let external=0;
 page.on('request',r=>{if(r.url().includes('example.invalid'))external++;});
 await page.route('**/api/records/memory?*',r=>r.fulfill({json:envelope([{id:'memory',title:'知微记住的事',categories:['self'],content,at,source:'memories/MEMORY.md',revision:'rev'}])}));
 await login(page);await page.locator('[data-tab=memory]').click();await page.locator('[data-memory-category=self]').click();await page.locator('#memoryRecords button').filter({hasText:'展开'}).click();await expect(page.locator('.record-body strong')).toHaveText('原来的意思');await expect(page.locator('.record-body table')).toBeVisible();await expect(page.locator('.record-body img,.record-body script,.record-body a')).toHaveCount(0);expect(await page.evaluate(()=>window.RECORD_XSS)).toBeUndefined();expect(external).toBe(0);
 await page.screenshot({path:screenshotPath(info,'memory-reading.png'),fullPage:true});await expect(page.locator('#memoryRecords input,#memoryRecords textarea')).toHaveCount(0);
});
test('code disclosure remains open when refreshed; logout removes both reading and original',async({page})=>{
 let reads=0;const content='一段记忆。\n\n```json\n{"saved":true}\n```';
 await page.route('**/api/records/memory?*',r=>r.fulfill({json:envelope([{id:'memory',title:'记下的一件事',categories:['self'],content:content+'\n\n更新 '+(++reads),at,source:'memories/MEMORY.md',revision:'rev'}])}));
 await login(page);await page.locator('[data-tab=memory]').click();await page.locator('[data-memory-category=self]').click();await page.locator('#memoryRecords button').filter({hasText:'展开'}).click();await page.locator('.record-code summary').click();const before=reads;await page.locator('#memoryRefresh').click();await expect.poll(()=>reads).toBeGreaterThan(before);await expect(page.locator('.record-body')).toContainText('更新 '+reads);await expect(page.locator('.record-code')).toHaveAttribute('open','');
 await page.evaluate(()=>window.ZiweiRecords.stop());await expect(page.locator('#memoryRecords')).toBeEmpty();
});
