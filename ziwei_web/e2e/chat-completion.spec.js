'use strict';
const {test,expect}=require('./helpers/isolated-app');
let cleanupIds=[];
test.beforeEach(()=>{cleanupIds=[];});
test.afterEach(async({page},info)=>{
 await page.evaluate(async({ids,resetDate})=>{const s=await (await fetch('/api/session')).json();if(!s.authenticated)return;const headers={'Content-Type':'application/json','X-Ziwei-CSRF':s.csrf};for(const id of ids)for(const prefix of ['user-','reply-'])await fetch('/api/chat/action',{method:'POST',headers,body:JSON.stringify({id:prefix+id,action:'delete'})});if(resetDate){const h=await (await fetch('/api/home')).json();await fetch('/api/home',{method:'PUT',headers,body:JSON.stringify({revision:h.revision,relationship:{metOn:null}})});}}, {ids:cleanupIds,resetDate:info.title.startsWith('confirmed anniversary')});
});
async function open(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await expect(page.locator('#app')).toBeVisible();await page.locator('[data-tab=chat]').click();}
const row=(id,role='assistant',attachments=[])=>({id,role,content:'消息内容',attachments,created_at:'2026-10-15T00:00:00Z',status:'completed',source:'live'});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNYk1b3HwAF4gKQxKktkgAAAABJRU5ErkJggg==','base64');
test('confirmed anniversary persists; real presence expires independently of network health',async({page})=>{
 let fresh=true;await page.route('**/api/chat/status',r=>r.fulfill({json:{configured:true,connected:true,presence:{state:'在思考',source:'ziwei',updatedAt:new Date(Date.now()-(fresh?0:3600000)).toISOString(),stale:!fresh}}}));
 await open(page);await expect(page.locator('#chatPresence')).toHaveText('在思考');await expect(page.locator('#chatConnection')).toHaveText('已连接');
 await page.locator('#settingsButton').click();await page.locator('#metOn').fill('2026-10-07');await page.locator('#saveProfile').click();await expect(page.locator('#settingsMessage')).toHaveText('已保存。');await page.locator('#closeSettings').click();
 await page.locator('[data-tab=home]').click();await expect(page.locator('#metOnValue')).toHaveText('2026-10-07');await expect(page.locator('#daysTogether')).not.toHaveText('待确认');
 fresh=false;await page.locator('[data-tab=chat]').click();await expect(page.locator('#chatPresence')).toHaveText(/^最后更新于 \d{2}:\d{2}$/);await expect(page.locator('#chatConnection')).toHaveText('已连接');
 await page.reload();await expect(page.locator('#metOnValue')).toHaveText('2026-10-07');
});
test('approval shows actual command as text and submits the exact once-only choice',async({page})=>{
 let approvals=[{requestId:'8860b355-2199-4782-a46c-2d30db7f6310',approvalId:'native-request-1',command:'fixture <script>alert(1)</script>',choices:['once','deny']}],submitted;
 await page.route('**/api/chat/approvals',r=>r.fulfill({json:{data:approvals}}));await page.route('**/api/chat/approval',r=>{submitted=r.request().postDataJSON();approvals=[];return r.fulfill({json:{ok:true}});});
 await open(page);await expect(page.locator('.chat-approval')).toContainText('知微需要你的批准');await expect(page.locator('.chat-approval pre')).toContainText('<script>');await expect(page.locator('.chat-approval script')).toHaveCount(0);
 await page.getByRole('button',{name:'允许本次',exact:true}).click();await expect(page.locator('.chat-approval')).toHaveCount(0);expect(submitted).toEqual({requestId:'8860b355-2199-4782-a46c-2d30db7f6310',approvalId:'native-request-1',choice:'once'});
});
test('private images open full screen, navigate, zoom, download and clear on close',async({page})=>{
 const ids=['942ce262-b8cb-4c0b-837e-ad33f4c7ee35','942ce262-b8cb-4c0b-837e-ad33f4c7ee36'];await page.route('**/api/chat/messages?*',r=>r.fulfill({json:{data:[row('images','user',ids)],before:1,hasMore:false}}));
 for(const [i,id] of ids.entries()){await page.route('**/api/chat/attachments/'+id+'/metadata',r=>r.fulfill({json:{id,name:'picture-'+i+'.png',mime:'image/png',size:png.length}}));await page.route('**/api/chat/attachments/'+id,r=>r.fulfill({contentType:'image/png',body:png}));}
 await open(page);await page.locator('img.message-media').first().click();await expect(page.locator('#chatImageViewer')).toBeVisible();await expect(page.locator('#chatImageName')).toContainText('1 / 2');await page.locator('#chatImageNext').click();await expect(page.locator('#chatImageName')).toContainText('2 / 2');await page.locator('#chatImageZoomIn').click();await expect(page.locator('#chatImageFull')).toHaveAttribute('style',/150%/);await expect(page.locator('#chatImageSave')).toHaveAttribute('download','picture-1.png');await page.locator('#chatImageClose').click();await expect(page.locator('#chatImageFull')).not.toHaveAttribute('src',/.+/);
});
test('voice call reports unsupported browsers honestly and releases late microphone permission',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>window.__micResolve=resolve)},configurable:true});window.AudioContext=class{constructor(){this.state='running';}resume(){return Promise.resolve();}close(){return Promise.resolve();}};});
 await open(page);await page.locator('#chatCall').click();await expect(page.locator('#chatCallDialog')).toBeVisible();await page.locator('#chatCallStart').click();await expect(page.locator('#chatCallState')).toHaveText('正在连接麦克风…');await expect.poll(()=>page.evaluate(()=>typeof window.__micResolve)).toBe('function');await page.locator('#chatCallEnd').click();await page.evaluate(()=>{window.__stopped=false;window.__micResolve({getTracks:()=>[{stop:()=>window.__stopped=true}]});});await expect.poll(()=>page.evaluate(()=>window.__stopped)).toBe(true);await expect(page.locator('#chatCallDialog')).toBeHidden();
});
test('voice call records an utterance, sends once, plays a reply and releases its live tracks',async({page})=>{
 await page.addInitScript(()=>{
  window.__callTracks=[];Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{const c=new AudioContext(),osc=c.createOscillator(),gain=c.createGain(),out=c.createMediaStreamDestination();osc.frequency.value=440;gain.gain.value=.2;osc.connect(gain).connect(out);osc.start();await c.resume();setTimeout(()=>gain.gain.value=0,700);window.__callTracks=out.stream.getTracks();for(const track of window.__callTracks){const stop=track.stop.bind(track);track.stop=()=>{stop();osc.stop();void c.close();};}return out.stream;}}});
 });
 const id='942ce262-b8cb-4c0b-837e-ad33f4c7ee37',wav=Buffer.alloc(16044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
 let sends=0;page.on('request',r=>{if(r.url().endsWith('/api/chat/send')){sends++;cleanupIds.push(r.postDataJSON().requestId);}});
 await page.route('**/api/chat/speech',r=>r.fulfill({json:{id,name:'reading.wav',mime:'audio/wav',size:wav.length}}));await page.route('**/api/chat/attachments/'+id,r=>r.fulfill({contentType:'audio/wav',body:wav}));
 await open(page);await page.locator('#chatCall').click();await page.locator('#chatCallStart').click();await expect.poll(()=>sends,{timeout:15000}).toBe(1);await expect.poll(()=>page.locator('#chatCallAudio').evaluate(a=>a.currentTime),{timeout:15000}).toBeGreaterThan(.1);await expect(page.locator('#chatCallState')).toHaveText('正在听你说…');expect(sends).toBe(1);await page.locator('#chatCallEnd').click();expect(await page.evaluate(()=>window.__callTracks.every(t=>t.readyState==='ended'))).toBe(true);
});

test('stale status uses its real last-update time and a missing record stays distinct',async({page})=>{
 await open(page);await expect(page.locator('#chatConnection')).toHaveText('已连接');await page.evaluate(()=>window.ZiweiChatExtra.presence({state:'在工作',source:'ziwei',updatedAt:'2026-10-16T01:05:00Z',stale:true}));await expect(page.locator('#chatPresence')).toHaveText('最后更新于 08:05');await expect(page.locator('#todayStatus')).toHaveText('最近状态：在工作');await page.evaluate(()=>window.ZiweiChatExtra.presence(null));await expect(page.locator('#chatPresence')).toHaveText('尚无状态记录');
});
