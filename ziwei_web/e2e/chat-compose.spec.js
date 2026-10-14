'use strict';
const {test,expect}=require('@playwright/test');
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
test('composer stays one compact row 8px above nav and grows only on focus',async({page})=>{
 await open(page);
 for(const size of [{width:320,height:568},{width:390,height:844},{width:440,height:956},{width:956,height:440}]){
  await page.setViewportSize(size);
  await expect.poll(()=>page.evaluate(()=>{
   const form=document.querySelector('#chatForm').getBoundingClientRect(),nav=document.querySelector('nav').getBoundingClientRect();
   return Math.round(nav.top-form.bottom);
  })).toBe(8);
  expect((await page.locator('#chatForm').boundingBox()).height).toBeLessThanOrEqual(56);
  const boxes=await page.evaluate(()=>['label[for=chatFiles]','#chatInput','#chatVoice','#chatSend'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,y:r.top+r.height/2};}));
  expect(Math.max(...boxes.map(x=>x.y))-Math.min(...boxes.map(x=>x.y))).toBeLessThan(1);
  for(let i=1;i<boxes.length;i++)expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i-1].right);
 }
 await page.setViewportSize({width:390,height:844});await page.locator('#chatInput').focus();await expect(page.locator('#chatForm')).toHaveClass(/is-editing/);
 await page.locator('#chatInput').fill('第一行\n第二行\n第三行\n第四行');
 expect((await page.locator('#chatForm').boundingBox()).height).toBeGreaterThan(100);
 await page.locator('#chatPeer').click();await expect(page.locator('#chatForm')).not.toHaveClass(/is-editing/);
 expect((await page.locator('#chatForm').boundingBox()).height).toBeLessThanOrEqual(56);
 await expect(page.locator('#chatInput')).toHaveValue('第一行\n第二行\n第三行\n第四行');
 await expect(page.locator('#chatSend')).toHaveText('');await expect(page.locator('#chatSend svg')).toHaveCount(1);
});
test('shrinking visual viewport lifts the input above a simulated keyboard',async({page})=>{
 await page.addInitScript(()=>{window.__vv=new EventTarget();window.__vv.height=844;window.__vv.offsetTop=0;Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>window.__vv});});
 await page.setViewportSize({width:390,height:844});await open(page);await page.locator('#chatInput').focus();
 await page.evaluate(()=>{window.__vv.height=360;window.__vv.dispatchEvent(new Event('resize'));});
 await expect.poll(()=>page.locator('#chatForm').evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(352);
 await page.evaluate(()=>{window.__vv.height=844;window.__vv.dispatchEvent(new Event('resize'));});
 await expect.poll(()=>page.evaluate(()=>Math.round(document.querySelector('nav').getBoundingClientRect().top-document.querySelector('#chatForm').getBoundingClientRect().bottom))).toBe(8);
});
test('dictation inserts text without sending and drops late results after leaving chat',async({page})=>{
 await page.addInitScript(()=>{
  window.SpeechRecognition=class{constructor(){window.__speech=this;}start(){this.started=true;}stop(){this.onend?.();}abort(){this.aborted=true;}};
 });
 await open(page);await page.locator('#chatInput').fill('已有草稿 ');await page.locator('#chatVoice').click();
 await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#chatSend')).toBeDisabled();
 expect(await page.evaluate(()=>window.__speech.lang)).toBe('zh-CN');
 await page.evaluate(()=>{const result=[{transcript:'语音识别结果'}];result.isFinal=true;window.__speech.onresult({results:[result]});window.__speech.onend();});
 await expect(page.locator('#chatInput')).toHaveValue('已有草稿 语音识别结果');await expect(page.locator('#chatSend')).toBeEnabled();
 await expect(page.locator('#chatMessages')).not.toContainText('语音识别结果');
 await page.locator('#chatVoice').click();await page.locator('[data-tab=home]').click();
 expect(await page.evaluate(()=>window.__speech.aborted)).toBe(true);
 await page.evaluate(()=>{const result=[{transcript:'迟到结果'}];result.isFinal=true;window.__speech.onresult({results:[result]});});
 await expect(page.locator('#chatInput')).toHaveValue('已有草稿 语音识别结果');
});
test('unsupported speech and permission denial show accurate feedback',async({page})=>{
 await page.addInitScript(()=>{window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;});
 await open(page);await page.locator('#chatVoice').click();await expect(page.locator('#chatVoiceHint')).toContainText('暂不支持');
 await page.evaluate(()=>{window.SpeechRecognition=class{constructor(){window.__speech=this;}start(){}abort(){}};});
 await page.locator('#chatVoice').click();await page.evaluate(()=>{window.__speech.onerror({error:'not-allowed'});window.__speech.onend();});
 await expect(page.locator('#chatVoiceHint')).toContainText('未获得');await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','false');
});
