'use strict';
(function(){try{var L=localStorage,g=L.getItem('zw_pref_theme')||'system',r=(g==='light'||g==='dark')?g:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),b=(L.getItem('zw_resolved_theme')===r?L.getItem('zw_bg'):null)||(r==='dark'?'#211b26':'#fff9f7'),d=document.documentElement,m=document.querySelector('meta[name="theme-color"]'),bgk=L.getItem('zw_background');d.setAttribute('data-theme',r);if(bgk)d.setAttribute('data-background',bgk);if(m)m.setAttribute('content',b);}catch(e){}})();
/* 页面固定：禁止双指缩放与双击放大。
   iOS Safari 从 10 起会忽略 user-scalable=no，必须用事件拦截才真的锁死。 */
(function(){
  var stop=function(e){ if(e.touches&&e.touches.length>1){ e.preventDefault(); } };
  document.addEventListener('gesturestart',function(e){e.preventDefault();},{passive:false});
  document.addEventListener('gesturechange',function(e){e.preventDefault();},{passive:false});
  document.addEventListener('gestureend',function(e){e.preventDefault();},{passive:false});
  document.addEventListener('touchstart',stop,{passive:false});
  document.addEventListener('touchmove',stop,{passive:false});
  document.addEventListener('dblclick',function(e){e.preventDefault();},{passive:false});
  window.addEventListener('wheel',function(e){ if(e.ctrlKey) e.preventDefault(); },{passive:false});
  document.documentElement.style.touchAction='manipulation';
})();

/* 安全区兜底：iOS 部分版本/形态下 env(safe-area-inset-top) 会报 0，
   但状态栏仍然浮在页面之上，内容就被压住。这里实测一次，为 0 时按 47px 兜底。 */
(function(){
  try{
    var probe=document.createElement('div');
    probe.style.cssText='position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
    document.documentElement.appendChild(probe);
    var cs=getComputedStyle(probe);
    var top=parseFloat(cs.paddingTop)||0, bottom=parseFloat(cs.paddingBottom)||0;
    probe.remove();
    var standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
    var dpr=window.devicePixelRatio||2;
    if(top===0&&standalone&&dpr>=2.5){ top=47; }
    if(bottom===0&&standalone&&dpr>=2.5){ bottom=34; }
    document.documentElement.style.setProperty('--zw-safe-top',top+'px');
    document.documentElement.style.setProperty('--zw-safe-bottom',bottom+'px');
  }catch(e){}
})();
