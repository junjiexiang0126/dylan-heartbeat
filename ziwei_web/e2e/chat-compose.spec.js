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
async function recorderMock(page){await page.addInitScript(()=>{
 window.__tracksStopped=0;
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>window.__tracksStopped++}]})}});
 window.MediaRecorder=class {static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/wav';window.__recorder=this;}start(){this.state='recording';}stop(){this.state='inactive';const b=new Uint8Array(16044),v=new DataView(b.buffer),str=(p,s)=>[...s].forEach((c,i)=>b[p+i]=c.charCodeAt(0));str(0,'RIFF');v.setUint32(4,b.length-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,16000,true);this.ondataavailable?.({data:new Blob([b],{type:this.mimeType})});this.onstop?.();}};
 });}
test('recording sends original audio with empty text and supports playback after reload',async({page})=>{
 await recorderMock(page);await open(page);await page.locator('#chatVoice').click();
 await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#chatSend')).toBeDisabled();
 await page.locator('#chatVoice').click();await expect(page.locator('#chatVoicePreview')).toBeVisible();await expect(page.locator('#chatInput')).toHaveValue('');
 await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>window.__tracksStopped)).toBeGreaterThan(0);
 const sent=page.waitForRequest(r=>r.url().endsWith('/api/chat/send')&&r.method()==='POST');await page.locator('#chatSend').click();
 const payload=(await sent).postDataJSON();expect(payload.message).toBe('');expect(payload.attachments).toHaveLength(1);
 await expect(page.locator('.voice-message')).toHaveCount(1);await expect(page.locator('#chatMessages')).toContainText('协议测试回复');
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.voice-message')).toHaveCount(1);
 await page.locator('.voice-play').click();await expect(page.locator('.voice-play')).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-tab=home]').click();expect(await page.locator('#chatMessages audio').evaluate(a=>a.paused)).toBe(true);
});
test('cancel and leave discard recordings; delayed permission cannot restart microphone',async({page})=>{
 await recorderMock(page);await open(page);await page.locator('#chatVoice').click();await page.locator('#chatVoiceCancel').click();await expect(page.locator('#chatVoiceDraft')).toBeHidden();
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.__grant=r);});
 await page.locator('#chatVoice').click();await page.locator('[data-tab=home]').click();
 await page.evaluate(()=>window.__grant({getTracks:()=>[{stop:()=>window.__tracksStopped++}]}));await page.locator('[data-tab=chat]').click();
 await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#chatVoiceDraft')).toBeHidden();
 await expect(page.locator('#chatMessages .voice-message')).toHaveCount(0);
});
test('unsupported recorder and permission denial show accurate feedback',async({page})=>{
 await recorderMock(page);await open(page);await page.evaluate(()=>window.MediaRecorder=undefined);await page.locator('#chatVoice').click();await expect(page.locator('#chatVoiceHint')).toContainText('暂不支持');
 await page.evaluate(()=>{window.MediaRecorder=class{};navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});
 await page.locator('#chatVoice').click();await expect(page.locator('#chatVoiceHint')).toContainText('未获得');await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','false');
});
test('late upload after leaving chat never sends a cancelled voice draft',async({page})=>{
 await recorderMock(page);await open(page);await page.locator('#chatVoice').click();await page.locator('#chatVoice').click();
 let release;const held=new Promise(r=>release=r);await page.route('**/api/chat/attachments',async r=>{await held;await r.continue();});let sends=0;page.on('request',r=>{if(r.url().endsWith('/api/chat/send'))sends++;});
 await page.locator('#chatSend').click();await expect(page.locator('#chatVoiceHint')).toContainText('正在上传');await page.locator('[data-tab=home]').click();release();await page.locator('[data-tab=chat]').click();
 await expect(page.locator('#chatVoiceDraft')).toBeHidden();await expect(page.locator('#chatSend')).toBeEnabled();expect(sends).toBe(0);
});
