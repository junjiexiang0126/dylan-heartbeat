'use strict';
// Offline layout regression, not a real iPhone standalone/PWA acceptance test.
// Usage: node scripts/check_pwa_safe_area.cjs [baseline public directory]
const {webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const publicDir=process.env.ZIWEI_TEST_PUBLIC?path.resolve(process.env.ZIWEI_TEST_PUBLIC):path.resolve(__dirname,'../public');
const baseline=process.argv[2]&&path.resolve(process.argv[2]);
const scenarios=[
 {name:'portrait',width:390,height:844,top:59,bottom:34,left:0,right:0},
 {name:'narrow',width:320,height:740,top:44,bottom:34,left:0,right:0},
 {name:'landscape',width:844,height:390,top:0,bottom:21,left:59,right:59},
 {name:'desktop',width:1280,height:900,top:0,bottom:0,left:0,right:0},
];
function html(dir,s){
 return fs.readFileSync(path.join(dir,'index.html'),'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
  .replace(/<link\b[^>]*>/g,tag=>{
   if(!tag.includes('rel="stylesheet"'))return '';
   const file=path.join(dir,tag.match(/href="\/([^"]+)"/)[1]);
   if(!fs.existsSync(file))return ''; // Font bytes are not needed for layout isolation.
   const css=fs.readFileSync(file,'utf8').replace(/env\(safe-area-inset-(top|bottom|left|right)(?:,[^)]*)?\)/g,(_,edge)=>s[edge]+'px');
   return '<style>'+css+'</style>';
  });
}
async function show(page,name){await page.evaluate(name=>{
 document.querySelector('#login').hidden=true;document.querySelector('#app').hidden=false;
 document.body.className=['chat','work'].includes(name)?'chat-view'+(name==='work'?' work-view':''):'';
 document.querySelectorAll('.panel').forEach(n=>n.hidden=n.id!==name);
 window.scrollTo(0,0);
},name);}
async function hit(page,selector,s){
 const g=await page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
 assert(g.top>=s.top,selector+' above safe top: '+JSON.stringify(g));
 assert(g.bottom<=s.height-s.bottom,selector+' below safe bottom');
 assert(g.hit,selector+' is covered');
}
async function snapshot(page,name){await show(page,name);return page.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>n.getClientRects().length).map(n=>{
 const r=n.getBoundingClientRect(),s=getComputedStyle(n);return [n.tagName,n.id,n.className,r.x,r.y,r.width,r.height,...['fontFamily','fontSize','lineHeight','color','background','border','borderRadius','padding','margin','backdropFilter','opacity'].map(k=>s[k])];
}));}
(async()=>{
 const browser=await webkit.launch({headless:true});let checks=0;
 try{for(const s of scenarios){
  const page=await browser.newPage({reducedMotion:"reduce",viewport:{width:s.width,height:s.height}});
  await page.route('**/*',route=>route.abort()); // Never contact production or APIs.
  await page.setContent(html(publicDir,s));await show(page,'work');
  await page.evaluate(()=>{
   window.fetch=async url=>({ok:true,json:async()=>url==='/api/session'?{authenticated:true,csrf:'fixture'}:url==='/api/home'?{}:{data:[],tasks:[],tools:[],usage:[]}});
   window.ZiweiSave={saveOrShare:(src,name)=>{window.savedImage={src,name};}};
  });
  await page.addScriptTag({path:path.join(publicDir,'work.js')});
  await page.addScriptTag({path:path.join(publicDir,'chat-extra.js')});
  for(const selector of ['.work-members button:first-child','.work-members button:last-child','#workSearchToggle','#workToolsOpen'])await hit(page,selector,s);
  await page.locator('#workSearchToggle').click();assert(await page.locator('#workSearchBar').isVisible());
  await page.locator('#workSearchToggle').click();
  await page.locator('#workToolsOpen').click();await page.locator('#workToolsClose').waitFor({state:'visible'});await hit(page,'#workToolsClose',s);await page.locator('#workToolsClose').click();
  await page.locator('.work-members button:first-child').click();assert.equal(await page.locator('#workInput').inputValue(),'@知微 ');await page.locator('#workInput').blur();
  const composer=await page.locator('#workForm').boundingBox(),nav=await page.locator('nav').boundingBox();assert(composer.y+composer.height<nav.y);
  for(const origin of ['work','chat']){
   await show(page,origin);await page.evaluate(origin=>{
    const root=document.querySelector(origin==='work'?'.work-conversation':'#chatMessages');root.replaceChildren();
    for(let i=0;i<2;i++){const img=document.createElement('img');img.className='message-media';img.alt='测试原图-'+i+'.png';img.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="pink"/></svg>');root.append(img);}
    window.ZiweiChatExtra.showImage(root.querySelector('img'));
   },origin);
   for(const selector of ['#chatImageClose','#chatImageZoomIn','#chatImageSave'])await hit(page,selector,s);
   const saveBounds=await page.locator('#chatImageSave').boundingBox();assert(saveBounds.x>=s.left&&saveBounds.x+saveBounds.width<=s.width-s.right);
   await page.locator('#chatImageSave').click();assert.equal(await page.evaluate(()=>window.savedImage.name),'测试原图-0.png');
   await page.locator('#chatImageNext').click();assert.match(await page.locator('#chatImageName').textContent(),/^2 \/ 2/);
   await page.locator('#chatImagePrevious').click();await page.locator('#chatImageZoomIn').click();assert.equal(await page.locator('#chatImageFull').evaluate(n=>n.style.width),'150%');
   assert((await page.locator('#chatImageCanvas').boundingBox()).height>0);await page.locator('#chatImageClose').click();assert(!(await page.locator('#chatImageViewer').isVisible()));
  }
  await page.close();
  if(baseline){for(const theme of ['light','dark']){
   const before=await browser.newPage({reducedMotion:"reduce",viewport:{width:s.width,height:s.height}}),after=await browser.newPage({reducedMotion:"reduce",viewport:{width:s.width,height:s.height}});
   for(const [p,dir] of [[before,baseline],[after,publicDir]]){await p.route('**/*',r=>r.abort());await p.setContent(html(dir,s));await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);}
   for(const name of ['chat','moments','home','memory','logs']){assert.deepEqual(await snapshot(after,name),await snapshot(before,name),s.name+' '+theme+' '+name+' changed');checks++;}
   await before.close();await after.close();
  }}
  console.log('PASS '+s.name+': Work controls, composer, chat/Work image controls (synthetic safe area)');
 }
 console.log('PASS '+checks+' unchanged-page comparisons; real iPhone PWA verification still required.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
