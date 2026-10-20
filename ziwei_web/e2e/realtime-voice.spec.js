'use strict';
const {test,expect}=require('./helpers/isolated-app');
test('realtime call uses existing dialog; mute and hangup reach the owned call',async({page})=>{
 const controls=[],ended=[];
 await page.route('**/api/voice/config',r=>r.fulfill({json:{enabled:true}}));
 await page.route('**/api/voice/livekit-token',r=>r.fulfill({json:{url:'wss://fixture.livekit.cloud',token:'fixture',callId:'fixture-call',agentIdentity:'ziwei-fixture'}}));
 await page.route('**/api/voice/control',r=>{controls.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
 await page.route('**/api/voice/end',r=>{ended.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
 await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();
 await page.evaluate(()=>{
  window.__mic=[];window.__disconnect=0;
  class Room{constructor(){this.localParticipant={setMicrophoneEnabled:async v=>window.__mic.push(v),getTrackPublication:()=>null};}on(){return this;}async connect(){}async startAudio(){}async disconnect(){window.__disconnect++;}}
  window.LivekitClient={Room,RoomEvent:{TrackSubscribed:'track',Disconnected:'disconnect',Reconnecting:'reconnecting',Reconnected:'reconnected',DataReceived:'data'},Track:{Source:{Microphone:'microphone'}}};
 });
 await page.locator('[data-tab=chat]').click();await page.locator('#chatCall').click();await page.locator('#chatCallStart').click();
 await expect(page.locator('#chatCallDialog')).toHaveAttribute('data-phase','listening');await expect(page.locator('#chatCallMute')).toBeEnabled();
 await page.locator('#chatCallMute').click();await expect.poll(()=>controls.some(c=>c.callId==='fixture-call'&&c.muted)).toBe(true);
 await page.locator('#chatCallEnd').click();await expect(page.locator('#chatCallDialog')).toBeHidden();await expect.poll(()=>ended.length).toBe(1);
 expect(await page.evaluate(()=>window.__mic)).toEqual([true,false]);expect(await page.evaluate(()=>window.__disconnect)).toBe(1);
});
