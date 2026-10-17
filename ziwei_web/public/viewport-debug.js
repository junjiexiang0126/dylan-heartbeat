/* Temporary, opt-in iPhone viewport diagnosis: ?ziwei_debug=1 */
(function(){
 /* Diagnostic enabled by default on this test branch. */
 const box=document.createElement('div');
 box.id='ziweiViewportDebug';
 box.style.cssText='position:fixed;top:calc(env(safe-area-inset-top,0px) + 6px);left:6px;z-index:2147483647;background:rgba(255,255,255,.96);color:#111;border:2px solid #f03;padding:7px;border-radius:8px;font:11px/1.45 monospace;white-space:pre;max-width:94vw;pointer-events:auto;box-shadow:0 2px 8px #0005';
 const label=document.createElement('div');
 const toggle=document.createElement('button');
 toggle.type='button';toggle.textContent='顶部层透明度：正常';
 toggle.style.cssText='font:12px sans-serif;padding:4px;margin-top:4px;color:#111;background:#eee;border:1px solid #666;border-radius:4px';
 let transparent=false;
 toggle.addEventListener('click',function(){
   transparent=!transparent;
   document.querySelectorAll('.topbar,.ambient').forEach(function(el){el.style.opacity=transparent?'.3':''});
   toggle.textContent=transparent?'顶部层透明度：30%':'顶部层透明度：正常';
 });
 box.append(label,toggle);document.body.appendChild(box);
 function fmt(el){if(!el)return 'missing';const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return 'top '+r.top.toFixed(0)+' bottom '+r.bottom.toFixed(0)+' h '+r.height.toFixed(0)+' '+cs.position+' z='+cs.zIndex}
 function tick(){
   const vv=window.visualViewport;
   label.textContent='iH '+innerHeight+' vvH '+(vv?vv.height.toFixed(0):'-')+' clientH '+document.documentElement.clientHeight+'\nscrollY '+scrollY.toFixed(0)+' vvTop '+(vv?vv.offsetTop.toFixed(0):'-')+'\nshell '+fmt(document.querySelector('.shell'))+'\ntopbar '+fmt(document.querySelector('.topbar'))+'\nambient '+fmt(document.querySelector('.ambient'))+'\nchat '+fmt(document.querySelector('.chat-panel'));
 }
 tick();setInterval(tick,500);
})();
