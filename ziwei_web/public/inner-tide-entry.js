'use strict';
(()=>{
 const avatar=document.getElementById('chatAvatar'),app=document.getElementById('app');
 if(!avatar||!app||!window.ZiweiInnerTide)return;
 const page=window.ZiweiInnerTide.create();page.bindAvatar(avatar);
 new MutationObserver(()=>{if(app.hidden)page.reset();}).observe(app,{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('ziwei-session-expired',()=>page.reset());
})();
