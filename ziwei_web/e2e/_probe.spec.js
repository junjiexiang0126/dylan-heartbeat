// PROBE ONLY — 不进合并。用于定位 WebKit 玻璃模糊失效环节。
const { test } = require('@playwright/test');
const VARIANTS = {
 A_production: `#F{position:fixed!important;left:220px;top:20px;width:200px;height:40px;border-radius:0!important;z-index:1}
#F::before{border-radius:0!important}`,
 B_noiso_neg1: `#F{position:fixed!important;left:220px;top:70px;width:200px;height:40px;border-radius:0!important;z-index:1;isolation:auto!important}
#F::before{border-radius:0!important;z-index:-1!important}`,
 C_noiso_stack_neg1: `#F{position:fixed!important;left:220px;top:120px;width:200px;height:40px;border-radius:0!important;z-index:0;isolation:auto!important}
#F::before{border-radius:0!important;z-index:-1!important}
#glass-test-backdrop{z-index:-2}`,
 D_direct_blur: `#F{position:fixed!important;left:220px;top:170px;width:200px;height:40px;border-radius:0!important;z-index:1;
-webkit-backdrop-filter:blur(16px) saturate(132%)!important;backdrop-filter:blur(16px) saturate(132%)!important;
background:linear-gradient(180deg,rgba(255,255,255,.68),rgba(255,255,255,.48))!important;isolation:auto!important}
#F::before{display:none!important}`,
 E_noiso_pos0_children: `#F{position:fixed!important;left:220px;top:220px;width:200px;height:40px;border-radius:0!important;z-index:0;isolation:auto!important}
#F::before{border-radius:0!important;z-index:0!important}
#F > *{position:relative;z-index:1}
#glass-test-backdrop{z-index:-2}`,
 F_control_noblur: `#F{position:fixed!important;left:220px;top:270px;width:200px;height:40px;border-radius:0!important;z-index:1}
#F::before{border-radius:0!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`,
};
for (const [name, css] of Object.entries(VARIANTS)) {
 test(`PROBE ${name}`, async ({ page, browserName }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  const meta = await page.evaluate((rules) => {
   const sheet = [...document.styleSheets].find(x => x.href && x.href.includes('/style.css'));
   const base = [
    '.ambient,.shell{display:none!important}',
    'html,body{background:transparent!important}',
    '#glass-test-backdrop{position:fixed;inset:0;background:linear-gradient(to right,#000 0 50%,#fff 50% 100%);z-index:1}',
   ];
   for (const r of base) sheet.insertRule(r, sheet.cssRules.length);
   for (const rule of rules.match(/[^{}]+\{[^{}]*\}/g) || []) sheet.insertRule(rule.trim(), sheet.cssRules.length);
   const bd = document.createElement('div'); bd.id = 'glass-test-backdrop'; document.body.append(bd);
   const g = document.createElement('div'); g.id = 'glass-pixel-fixture'; g.className = 'glass';
   g.innerHTML = '<span>X</span>'; document.body.append(g);
   const el = document.getElementById('glass-pixel-fixture');
   const ps = getComputedStyle(el, '::before');
   const cs = getComputedStyle(el);
   return { cls: el.className, isolation: cs.isolation, zIndex: cs.zIndex, position: cs.position,
       elBackdrop: cs.backdropFilter || cs.webkitBackdropFilter,
       beforeContent: ps.content, beforeBackdrop: ps.backdropFilter || ps.webkitBackdropFilter,
       beforeZ: ps.zIndex, beforeInset: ps.inset, beforeW: ps.width, beforeH: ps.height,
       elBg: cs.backgroundColor, rect: el.getBoundingClientRect().toJSON() };
  }, css.replace(/#F/g, '#glass-pixel-fixture'));
  const row = async (y) => {
   const png = await page.screenshot({ scale: 'css' });
   return page.evaluate(async ([b64, yy]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const out = []; for (let i = 0; i < 51; i++) out.push(cx.getImageData(295 + i, yy, 1, 1).data[0]);
    return out;
   }, [png.toString('base64'), y]);
  };
  const y = meta.rect.top + 20;
  const inside = await row(Math.round(y));
  const outside = await row(90);
  const jump = a => Math.max(...a.slice(1).map((n, i) => Math.abs(n - a[i])));
  console.log(`PROBE_RESULT ${JSON.stringify({ engine: browserName, name,
   jump_inside: jump(inside), jump_outside: jump(outside), sample_inside: inside.filter((_, i) => i % 6 === 0), meta })}`);
 });
}
