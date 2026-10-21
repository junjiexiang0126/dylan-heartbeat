'use strict';
const {test,expect}=require('./helpers/isolated-app');
const at='2026-10-21T15:00:00+07:00',body='**把这一页留下。**\n\n今天整理了一段记忆，也留了一点空白。\n\n```js\nconst original = true;\n```';
async function open(page){
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/records/diary?*',r=>r.fulfill({json:new URL(r.request().url()).searchParams.has('id')?{id:'one',title:'一页日常',content:body,originalContent:body,revision:'one',date:'2026-10-21'}:{data:[{id:'one',title:'一页日常',preview:body,date:'2026-10-21',at,document:true,revision:'one'}],total:1,nextOffset:null,source:'hermes_native',checkedAt:at,errors:[]}}));
 await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.locator('#loginForm button').click();await expect(page.locator('#app')).toBeVisible();
}
test('opening is skippable, does not repeat on tab return, and writing restores the original',async({page})=>{
 await open(page);await page.locator('[data-tab=logs]').click();await expect(page.getByRole('button',{name:'跳过开书'})).toBeVisible();await page.getByRole('button',{name:'跳过开书'}).click();await expect(page.locator('.zw-book-scene')).toHaveCount(0);
 await page.locator('[data-tab=home]').click();await page.locator('[data-tab=logs]').click();await expect(page.locator('.zw-journal-hero')).toBeVisible();await expect(page.locator('.zw-book-scene')).toHaveCount(0);
 await page.getByRole('button',{name:'翻开知微的手记',exact:true}).click();await expect(page.locator('#logs')).toHaveClass(/diary-reading/);await expect(page.getByRole('button',{name:'立即读完'})).toBeVisible();await page.getByRole('button',{name:'立即读完'}).click();
 await expect(page.locator('.record-reading strong')).toHaveText('把这一页留下。');await expect(page.locator('.zw-letter,.zw-pen-tip')).toHaveCount(0);await expect(page.locator('.record-code pre')).toBeHidden();
 await page.getByRole('button',{name:'重现字迹 ↻'}).click();await expect(page.locator('.zw-pen-tip')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.zw-pen-tip')).toHaveCount(0);await expect(page.locator('.record-reading strong')).toHaveText('把这一页留下。');await page.locator('.record-provenance summary').click();await expect(page.locator('.record-original')).toHaveText(body);
 await page.locator('#logBack').click();await page.locator('#logBack').click();await page.locator('[data-tab=memory]').click();await expect(page.locator('.zw-writing-controls,.zw-book-scene,.zw-pen-tip')).toHaveCount(0);await expect(page.locator('#memory .memory-entry:visible')).toHaveCount(4);
});
test('motion and sound are local preferences; reduced motion always gives immediate reading',async({page})=>{
 await open(page);await page.locator('#settingsButton').click();await expect(page.locator('#experienceSound')).not.toBeChecked();await page.locator('#experienceSound').check();await page.locator('#experienceMotion').uncheck();await page.locator('#closeSettings').click();await page.reload();await page.locator('#settingsButton').click();await expect(page.locator('#experienceSound')).toBeChecked();await expect(page.locator('#experienceMotion')).not.toBeChecked();await page.locator('#experienceMotion').check();await page.locator('#closeSettings').click();
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-tab=logs]').click();await expect(page.locator('.zw-book-scene')).toHaveCount(0);await page.getByRole('button',{name:'翻开知微的手记',exact:true}).click();await expect(page.locator('#logs')).toHaveClass(/diary-reading/);await expect(page.locator('.record-reading strong')).toHaveText('把这一页留下。');await expect(page.locator('.zw-writing-controls,.zw-pen-tip,.zw-letter')).toHaveCount(0);
});
test('all themes share the existing background and memory pockets honor glass settings',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await open(page);
 for(const theme of ['light','dark'])for(const color of ['rose','sage','sky']){
  await page.evaluate(([theme,color])=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.background=color;},[theme,color]);
  for(const tab of ['home','chat','moments','work','memory','logs']){
   await page.locator('[data-tab='+tab+']').click();
   const styles=await page.evaluate(()=>{const c=n=>getComputedStyle(n);return {body:c(document.body).backgroundImage,shell:c(document.querySelector('.shell')).backgroundColor,ink:c(document.querySelector('#logs')).getPropertyValue('--ink').trim(),paper:c(document.documentElement).getPropertyValue('--paper-ink').trim()};});
   expect(styles.body).toBe('none');expect(styles.shell).toBe('rgba(0, 0, 0, 0)');expect(styles.ink).toBe(styles.paper);
  }
 }
 await page.locator('[data-tab=memory]').click();for(const card of await page.locator('#memory .memory-entry:not(.memory-primary)').all()){expect(await card.evaluate(n=>getComputedStyle(n).backdropFilter||getComputedStyle(n).webkitBackdropFilter)).toContain('blur(');}
 await page.locator('[data-tab=home]').click();await page.locator('#settingsButton').click();await page.locator('#reduceGlass').check();await page.locator('#closeSettings').click();await page.locator('[data-tab=memory]').click();for(const card of await page.locator('#memory .memory-entry:not(.memory-primary)').all()){expect(await card.evaluate(n=>getComputedStyle(n).backdropFilter||getComputedStyle(n).webkitBackdropFilter)).toBe('none');}
 await page.locator('[data-tab=logs]').click();await page.getByRole('button',{name:'翻开知微的手记',exact:true}).click();await expect(page.locator('#logs')).toHaveClass(/diary-reading/);await expect(page.locator('.shell')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
