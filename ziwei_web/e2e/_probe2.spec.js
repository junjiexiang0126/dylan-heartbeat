const { test } = require('@playwright/test');
const variants = {
 G_direct_blur: '#box{position:fixed;left:220px;top:20px;width:200px;height:40px;background:rgba(255,255,255,.58);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}',
 H_pseudo_blur_iso: '#box{position:fixed;left:220px;top:70px;width:200px;height:40px;isolation:isolate}#box::before{content:"";position:absolute;inset:0;z-index:-1;background:rgba(255,255,255,.58);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}',
 I_pseudo_blur_noiso: '#box{position:fixed;left:220px;top:120px;width:200px;height:40px}#box::before{content:"";position:absolute;inset:0;z-index:-1;background:rgba(255,255,255,.58);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}',
 J_control_noblur: '#box{position:fixed;left:220px;top:170px;width:200px;height:40px;background:rgba(255,255,255,.58)}'
};
for (const [name,css] of Object.entries(variants)) test('PROBE2 '+name,async({page,browserName})=>{
 await page.setViewportSize({width:640,height:360});
 await page.setContent('<!doctype html><html><head><style>html,body{margin:0}#bg{position:fixed;inset:0;background:linear-gradient(to right,#000 0 50%,#fff 50% 100%)}'+css+'</style></head><body><div id="bg"></div><div id="box"></div></body></html>');
 const cap=await page.evaluate(()=>({ua:navigator.userAgent,secure:isSecureContext,supports:CSS.supports('backdrop-filter','blur(4px)'),webkit:CSS.supports('-webkit-backdrop-filter','blur(4px)'),rect:document.querySelector('#box').getBoundingClientRect().toJSON(),backdrop:getComputedStyle(document.querySelector('#box')).backdropFilter,pseudo:getComputedStyle(document.querySelector('#box'),'::before').backdropFilter}));
 const png=await page.screenshot({scale:'css'});
 const pixels=await page.evaluate(async(b64)=>{const im=new Image();im.src='data:image/png;base64,'+b64;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);const y=Math.round(document.querySelector('#box').getBoundingClientRect().top+20);return Array.from({length:51},(_,i)=>x.getImageData(295+i,y,1,1).data[0])},png.toString('base64'));
 const jump=Math.max(...pixels.slice(1).map((v,i)=>Math.abs(v-pixels[i])));
 console.log('PROBE2_RESULT '+JSON.stringify({engine:browserName,name,jump,cap,sample:pixels.filter((_,i)=>i%6===0)}));
});