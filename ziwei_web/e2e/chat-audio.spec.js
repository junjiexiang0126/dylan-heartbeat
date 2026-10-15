'use strict';
const {test,expect}=require('@playwright/test');
// Decode actual PCM audio through the native player; do not mock play().
const wav=Buffer.alloc(64044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(64000,40);for(let i=0;i<32000;i++)wav.writeInt16LE(Math.round(1000*Math.sin(2*Math.PI*440*i/8000)),44+i*2);
const id='842ce262-b8cb-4c0b-837e-ad33f4c7ee35';
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
test('native playback advances and survives background timeline refresh and state changes',async({page})=>{
 await page.addInitScript(()=>{window.EventSource=class{constructor(){window.__events=this;this.listeners={};}addEventListener(name,fn){this.listeners[name]=fn;}close(){}};});
 let status='queued',reads=0;
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[{id:'audio-fixture',role:'user',content:'播放验收',attachments:[id],created_at:'2026-10-15T00:00:00Z',status,source:'live'}],before:1,hasMore:false}}));
 await page.route('**/api/chat/attachments/'+id+'/metadata',r=>{reads++;return r.fulfill({json:{id,name:'mandarin.wav',mime:'audio/wav',size:wav.length}});});
 await page.route('**/api/chat/attachments/'+id,r=>r.fulfill({contentType:'audio/wav',body:wav}));
 await open(page);const audio=page.locator('.voice-audio');await expect(audio).toHaveAttribute('controls','');await expect.poll(()=>audio.evaluate(a=>a.readyState)).toBeGreaterThan(0);
 await audio.evaluate(a=>{window.__originalAudio=a;a.playbackRate=.25;});await audio.click({position:{x:22,y:20}});
 await expect.poll(()=>audio.evaluate(a=>a.currentTime)).toBeGreaterThan(.1);
 const refresh=()=>page.evaluate(()=>window.__events.listeners['timeline.changed']({data:'{}'}));
 await refresh();await expect(page.locator('#chatTimeline')).toHaveAttribute('aria-busy','false');
 status='completed';await refresh();await expect(page.locator('.message-label')).toContainText('已回复');
 expect(await audio.evaluate(a=>a===window.__originalAudio)).toBe(true);expect(await audio.evaluate(a=>a.paused)).toBe(false);expect(reads).toBe(1);
 await expect(page.locator('.voice-download')).toHaveAttribute('href','/api/chat/attachments/'+id);
 await page.locator('[data-tab=home]').click();expect(await audio.evaluate(a=>a.paused)).toBe(true);
});
test('audio read failure is shown beside the native player',async({page})=>{
 await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[{id:'broken-audio',role:'user',content:'',attachments:[id],created_at:'2026-10-15T00:00:00Z',status:'completed',source:'live'}],before:1,hasMore:false}}));
 await page.route('**/api/chat/attachments/'+id+'/metadata',r=>r.fulfill({json:{id,name:'recording.wav',mime:'audio/wav',size:wav.length}}));
 await page.route('**/api/chat/attachments/'+id,r=>r.fulfill({status:404,json:{error:'attachment_not_found'}}));
 await open(page);await expect(page.locator('.voice-time')).toContainText('语音读取失败');await expect(page.locator('.voice-audio')).toBeVisible();await expect(page.locator('.voice-download')).toHaveAttribute('download','recording.wav');
});
