// PROBE ONLY — 不进最终提交。只打印几何证据，没有断言，不会让 CI 变红，也掩盖不了真实失败。
const { test } = require('@playwright/test');
async function login(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await page.waitForTimeout(400);}
test('SEND-CLICK PROBE geometry', async ({page,browserName})=>{
  await login(page);
  await page.locator('[data-tab=chat]').click();
  await page.locator('#chatInput').fill('probe '+Date.now());
  await page.locator('#chatFiles').setInputFiles({name:'p.txt',mimeType:'text/plain',buffer:Buffer.from('x')});
  await page.waitForTimeout(900);
  await page.evaluate(()=>{window.__p={click:[],up:[]};document.addEventListener('click',e=>window.__p.click.push(e.target&&(e.target.id||e.target.className)||'?'),true);document.addEventListener('pointerup',e=>window.__p.up.push(e.target&&(e.target.id||e.target.className)||'?'),true);});
  const box=await page.locator('#chatSend').boundingBox();
  const cx=Math.round(box.x+box.width/2), cy=Math.round(box.y+box.height/2);
  const snap=async tag=>{const s=await page.evaluate(([x,y])=>{const h=document.elementFromPoint(x,y);const r=document.querySelector('#chatSend').getBoundingClientRect();const c=document.querySelector('#chatAttachments').getBoundingClientRect();const pr=document.querySelector('#chatProgress');return{scrollY:Math.round(scrollY),sendTop:Math.round(r.top),sendLeft:Math.round(r.left),hit:h?(h.id||h.className||h.tagName):null,disabled:document.querySelector('#chatSend').disabled,chips:Math.round(c.height),progHidden:pr.hidden,progH:Math.round(pr.getBoundingClientRect().height),listH:Math.round(document.querySelector('#chatMessages').getBoundingClientRect().height),quoteHidden:document.querySelector('#chatQuote').hidden};},[cx,cy]);console.log('PROBE '+browserName+' '+tag+' '+JSON.stringify(s));return s;};
  await snap('00-before-move');
  await page.mouse.move(cx,cy); await snap('01-before-down');
  await page.mouse.down();      await snap('02-after-down');
  await page.waitForTimeout(150);
  await snap('03-before-up');
  await page.mouse.up();        await snap('04-after-up');
  const ev=await page.evaluate(()=>window.__p);
  console.log('PROBE '+browserName+' EVENTS '+JSON.stringify(ev));
});
