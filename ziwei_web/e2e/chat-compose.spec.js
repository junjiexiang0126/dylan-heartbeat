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
async function hold(page){const r=await page.locator('#chatVoice').boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();return r;}
test('hold starts immediately; release sends once, appears as a playable voice bubble and survives reload',async({page})=>{
 await recorderMock(page);await open(page);const sent=page.waitForRequest(r=>r.url().endsWith('/api/chat/send')&&r.method()==='POST');let sends=0;page.on('request',r=>{if(r.url().endsWith('/api/chat/send'))sends++;});
 await hold(page);await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#chatSend')).toBeDisabled();await expect(page.locator('#chatRecorder')).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__recorder?.state)).toBe('recording');
 await page.mouse.up();const payload=(await sent).postDataJSON();expect(payload.message).toBe('');expect(payload.attachments).toHaveLength(1);expect(sends).toBe(1);await expect(page.locator('#chatRecorder')).toBeHidden();await expect(page.locator('#chatMessages .voice-play')).toHaveCount(1);await expect(page.locator('#chatMessages')).toContainText('协议测试回复');
 await page.reload();await page.locator('[data-tab=chat]').click();await expect(page.locator('.voice-play')).toHaveCount(1);const audio=page.locator('.voice-audio');await expect(audio).not.toHaveAttribute('controls','');await page.locator('.voice-play').click();await expect.poll(()=>audio.evaluate(a=>a.paused)).toBe(false);await page.locator('[data-tab=home]').click();expect(await audio.evaluate(a=>a.paused)).toBe(true);
});
test('upward slide, pointer cancellation and late permission never upload or send',async({page})=>{
 await recorderMock(page);await open(page);let uploads=0,sends=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/chat/attachments'))uploads++;if(r.url().endsWith('/api/chat/send'))sends++;});
 const mic=await hold(page);await expect.poll(()=>page.evaluate(()=>window.__recorder?.state)).toBe('recording');await page.mouse.move(mic.x+mic.width/2,mic.y-80);await page.mouse.up();await expect(page.locator('#chatVoiceHint')).toContainText('上滑取消');await expect(page.locator('#chatRecorder')).toBeHidden();
 await hold(page);await page.locator('#chatVoice').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','false');
 await page.evaluate(()=>navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.__grant=r));await hold(page);await expect.poll(()=>page.evaluate(()=>!!window.__grant)).toBe(true);await page.mouse.up();await page.evaluate(()=>window.__grant({getTracks:()=>[{stop:()=>window.__tracksStopped++}]}));await expect(page.locator('#chatRecorder')).toBeHidden();expect(uploads).toBe(0);expect(sends).toBe(0);
});
test('denial and unsupported recording remain visible; a click does not toggle recording on',async({page})=>{
 await recorderMock(page);await open(page);await page.evaluate(()=>window.MediaRecorder=undefined);await page.locator('#chatVoice').click();await expect(page.locator('#chatVoiceHint')).toContainText('暂不支持');await page.evaluate(()=>{window.MediaRecorder=class{};navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});await page.locator('#chatVoice').click();await expect(page.locator('#chatVoiceHint')).toContainText('未获得');await expect(page.locator('#chatVoice')).toHaveAttribute('aria-pressed','false');
});
test('leaving during a held upload cannot send a cancelled draft',async({page})=>{
 await recorderMock(page);await open(page);let release;const held=new Promise(r=>release=r);await page.route('**/api/chat/attachments',async r=>{await held;await r.continue();});let sends=0;page.on('request',r=>{if(r.url().endsWith('/api/chat/send'))sends++;});await hold(page);await expect.poll(()=>page.evaluate(()=>window.__recorder?.state)).toBe('recording');await page.mouse.up();await expect(page.locator('#chatVoiceHint')).toContainText('正在上传');await page.locator('[data-tab=home]').click();release();await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatVoiceDraft')).toBeHidden();await expect(page.locator('#chatSend')).toBeEnabled();expect(sends).toBe(0);
});
test('recording waveform follows real signal and silence, then cancellation releases the microphone',async({page},info)=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{const c=new AudioContext(),o=c.createOscillator(),g=c.createGain(),dest=c.createMediaStreamDestination();o.frequency.value=440;g.gain.value=.2;o.connect(g).connect(dest);o.start();await c.resume();window.__gain=g;window.__voiceMod=setInterval(()=>g.gain.value=.05+.15*(1+Math.sin(performance.now()/110))/2,80);window.__tracks=dest.stream.getTracks();for(const track of window.__tracks){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(window.__voiceMod);stop();o.stop();void c.close();};}return dest.stream;}}});});
 await page.setViewportSize({width:390,height:844});await open(page);await hold(page);await expect(page.locator('#chatRecordWave i')).toHaveCount(25);await expect.poll(()=>page.locator('#chatRecordWave').getAttribute('data-level').then(Number)).toBeGreaterThan(.1);await expect.poll(()=>page.locator('#chatRecordWave i').evaluateAll(nodes=>nodes.filter(n=>Number(n.style.getPropertyValue('--voice-amplitude'))>.1).length)).toBeGreaterThanOrEqual(20);await page.emulateMedia({reducedMotion:'reduce'});for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:require('./helpers/screenshot-path').screenshotPath(info,'voice-recording-'+theme+'.png')});}await page.evaluate(()=>{clearInterval(window.__voiceMod);window.__gain.gain.value=0;});await expect.poll(()=>page.locator('#chatRecordWave').getAttribute('data-level').then(Number)).toBeLessThan(.01);await expect(page.locator('#chatRecordGesture')).toContainText('上滑取消');await page.locator('#chatVoice').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await expect(page.locator('#chatRecorder')).toBeHidden();expect(await page.evaluate(()=>window.__tracks.every(t=>t.readyState==='ended'))).toBe(true);
});
