// PROBE v2 — 不进最终提交。修正 v1 的缺陷：v1 直接用 boundingBox 坐标，没有先滚动，
// 所以短视口下坐标落在视口外（elementFromPoint 返回 null），那不是渲染问题，是探针自身的问题。
// v2 先 scrollIntoViewIfNeeded（与真实 locator.click() 一样），再手动做手势，
// 并额外记录：视口高度、滚动位置、底部导航与按钮是否重叠、手势期间 #chatMessages 的 DOM 变动次数。无断言。
const { test } = require('@playwright/test');
async function login(page){await page.goto('/');await page.locator('#password').fill('isolated-e2e-password-123456');await page.getByRole('button',{name:'进入知微之家'}).click();await page.waitForTimeout(400);}
test('SEND-CLICK PROBE v2 scroll-then-gesture', async ({page,browserName})=>{
  await login(page);
  await page.locator('[data-tab=chat]').click();
  await page.locator('#chatInput').fill('probe2 '+Date.now());
  await page.locator('#chatFiles').setInputFiles({name:'p.txt',mimeType:'text/plain',buffer:Buffer.from('x')});
  await page.waitForTimeout(900);
  const send=page.locator('#chatSend');
  await send.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.evaluate(()=>{window.__m=0;const t=document.querySelector('#chatMessages');if(t)new MutationObserver(()=>window.__m++).observe(t,{childList:true,subtree:true,characterData:true});const n=e=>{const x=e.target;return x?(x.id||x.className||x.tagName):'?'};window.__p={click:[],up:[]};document.addEventListener('click',e=>window.__p.click.push(n(e)),true);document.addEventListener('pointerup',e=>window.__p.up.push(n(e)),true);});
  const box=await send.boundingBox();
  const cx=Math.round(box.x+box.width/2), cy=Math.round(box.y+box.height/2);
  const snap=async tag=>{const s=await page.evaluate(([x,y])=>{const r=document.querySelector('#chatSend').getBoundingClientRect();const nb=document.querySelector('nav').getBoundingClientRect();const c=document.querySelector('#chatAttachments').getBoundingClientRect();const pr=document.querySelector('#chatProgress');const h=document.elementFromPoint(x,y);return{scrollY:Math.round(scrollY),vh:innerHeight,vw:innerWidth,docH:document.documentElement.scrollHeight,sendTop:Math.round(r.top),sendBottom:Math.round(r.bottom),inViewport:(r.top>=0&&r.bottom<=innerHeight),hit:h?(h.id||h.className||h.tagName):null,navTop:Math.round(nb.top),navOverlapsSend:!(r.bottom<nb.top||r.top>nb.bottom||r.right<nb.left||r.left>nb.right),disabled:document.querySelector('#chatSend').disabled,chips:Math.round(c.height),progH:Math.round(pr.getBoundingClientRect().height),listH:Math.round(document.querySelector('#chatMessages').getBoundingClientRect().height),mut:window.__m};},[cx,cy]);console.log('PROBE2 '+browserName+' '+tag+' '+JSON.stringify(s));return s;};
  await snap('00-before-move');
  await page.mouse.move(cx,cy); await snap('01-before-down');
  await page.mouse.down();      await snap('02-after-down');
  await page.waitForTimeout(150);
  await snap('03-before-up');
  await page.mouse.up();        await snap('04-after-up');
  const ev=await page.evaluate(()=>window.__p);
  console.log('PROBE2 '+browserName+' EVENTS '+JSON.stringify(ev));
});
