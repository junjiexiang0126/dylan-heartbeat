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
