'use strict';
const {test,expect}=require('@playwright/test');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();await page.locator('#chatCall').click();}
async function microphone(page,{brief=false}={}){
 await page.addInitScript(({brief})=>{
  window.__callTracks=[];window.__callGain=null;
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
   const c=new AudioContext(),osc=c.createOscillator(),gain=c.createGain(),out=c.createMediaStreamDestination();osc.frequency.value=440;gain.gain.value=.16;osc.connect(gain).connect(out);osc.start();await c.resume();window.__callGain=gain;window.__callTracks=out.stream.getTracks();if(brief)setTimeout(()=>gain.gain.value=0,700);
   for(const track of window.__callTracks){const stop=track.stop.bind(track);track.stop=()=>{stop();osc.stop();void c.close();};}return out.stream;
  }}});
 },{brief});
}
function speech(){
 const wav=Buffer.alloc(48044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
 for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(9000*Math.sin(2*Math.PI*440*i/8000)),44+i*2);return wav;
}
test('call screen uses saved avatar and name, fits phone and follows theme',async({page},testInfo)=>{
 await page.route('**/api/home',async route=>{const response=await route.fetch(),home=await response.json();home.ziwei={...home.ziwei,nickname:'微微',avatar:png};await route.fulfill({json:home});});
 await open(page);await expect(page.locator('#chatCallName')).toHaveText('微微');await expect(page.locator('#chatCallAvatar img')).toHaveAttribute('src',png);await expect(page.locator('#chatCallElapsed')).toHaveText('00:00');await expect(page.locator('#chatCallMute')).toBeDisabled();
 for(const theme of ['light','dark'])for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const box=await page.locator('#chatCallDialog').boundingBox();expect(box.x).toBe(0);expect(box.y).toBe(0);expect(box.width).toBe(size.width);expect(box.height).toBe(size.height);
  expect(await page.locator('#chatCallDialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await expect(page.locator('#chatCallEnd')).toBeInViewport();
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:testInfo.outputPath('call-screen-light.png')});
 await page.locator('#chatCallEnd').click();await expect(page.locator('#chatCallDialog')).toBeHidden();
});
test('microphone wave reflects signal and silence, mute discards recording, repeated calls release tracks',async({page})=>{
 await microphone(page);let sends=0;page.on('request',r=>{if(r.url().endsWith('/api/chat/send'))sends++;});await open(page);await page.locator('#chatCallStart').click();await expect(page.locator('#chatCallDialog')).toHaveAttribute('data-phase','listening');
 await expect.poll(()=>page.locator('#chatCallWave').getAttribute('data-level')).not.toBe('0');await expect(page.locator('#chatCallSpeaker')).toHaveText('你在说话');
 await page.evaluate(()=>window.__callGain.gain.value=0);await expect.poll(()=>page.locator('#chatCallWave').getAttribute('data-level')).toBe('0.000');
 await page.locator('#chatCallMute').click();await expect(page.locator('#chatCallMute')).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>window.__callTracks.every(t=>!t.enabled))).toBe(true);
 await page.evaluate(()=>window.__callGain.gain.value=.16);await expect(page.locator('#chatCallSpeaker')).toHaveText('麦克风已静音');await expect(page.locator('#chatCallWave')).toHaveAttribute('data-level','0');
 await expect.poll(()=>page.locator('#chatCallElapsed').textContent()).not.toBe('00:00');expect(sends).toBe(0);
 await page.locator('#chatCallMute').click();await expect(page.locator('#chatCallSpeaker')).toHaveText('你在说话');expect(await page.evaluate(()=>window.__callTracks.every(t=>t.enabled))).toBe(true);
 await page.locator('#chatCallEnd').click();expect(await page.evaluate(()=>window.__callTracks.every(t=>t.readyState==='ended'))).toBe(true);await expect(page.locator('#chatCallWave')).toHaveAttribute('data-level','0');expect(sends).toBe(0);
 await page.locator('#chatCall').click();await page.locator('#chatCallStart').click();await expect(page.locator('#chatCallDialog')).toHaveAttribute('data-phase','listening');await page.locator('#chatCallEnd').click();expect(await page.evaluate(()=>window.__callTracks.every(t=>t.readyState==='ended'))).toBe(true);
});
test('reply sound drives peer wave, then silence resumes listening and leaving stops playback',async({page})=>{
 await microphone(page,{brief:true});const id='942ce262-b8cb-4c0b-837e-ad33f4c7ee38',wav=speech(),requests=[];
 page.on('request',r=>{if(r.url().endsWith('/api/chat/send'))requests.push(r.postDataJSON().requestId);});
 await page.route('**/api/chat/speech',r=>r.fulfill({json:{id,name:'reply.wav',mime:'audio/wav',size:wav.length}}));await page.route('**/api/chat/attachments/'+id,r=>r.fulfill({contentType:'audio/wav',body:wav}));
 try{
  await open(page);await page.locator('#chatCallStart').click();await expect(page.locator('#chatCallDialog')).toHaveAttribute('data-phase','speaking',{timeout:15000});
  await expect.poll(()=>page.locator('#chatCallWave').evaluate(el=>Number(el.dataset.level))).toBeGreaterThan(.1);await expect(page.locator('#chatCallSpeaker')).toHaveText('知微的声音');await expect.poll(()=>page.locator('#chatCallAudio').evaluate(a=>a.currentTime)).toBeGreaterThan(.1);expect(requests.length).toBe(1);
  await expect(page.locator('#chatCallDialog')).toHaveAttribute('data-phase','listening',{timeout:7000});await expect(page.locator('#chatCallWave')).toHaveAttribute('data-level','0.000');
  await page.evaluate(()=>window.ZiweiChat.leave());await expect(page.locator('#chatCallDialog')).toBeHidden();expect(await page.locator('#chatCallAudio').evaluate(a=>a.paused&&!a.getAttribute('src'))).toBe(true);expect(await page.evaluate(()=>window.__callTracks.every(t=>t.readyState==='ended'))).toBe(true);
 }finally{
  await page.evaluate(async ids=>{const s=await(await fetch('/api/session')).json();for(const id of ids)for(const prefix of ['user-','reply-'])await fetch('/api/chat/action',{method:'POST',headers:{'Content-Type':'application/json','X-Ziwei-CSRF':s.csrf},body:JSON.stringify({id:prefix+id,action:'delete'})});},requests);
 }
});
test('denied microphone leaves an honest stopped screen and allows retry',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError');}}}));await open(page);await page.locator('#chatCallStart').click();await expect(page.locator('#chatCallState')).toHaveText('未获得麦克风权限。');await expect(page.locator('#chatCallStart')).toBeEnabled();await expect(page.locator('#chatCallMute')).toBeDisabled();await expect(page.locator('#chatCallElapsed')).toHaveText('00:00');await expect(page.locator('#chatCallWave')).toHaveAttribute('data-level','0');await page.locator('#chatCallEnd').click();
});
