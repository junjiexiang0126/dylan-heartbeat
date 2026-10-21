'use strict';
// Local presentation only; security and profile writes stay in app.js.
(()=>{
 const dialog=document.getElementById('settings'),content=document.getElementById('settingsContent');
 if(!dialog||!content)return;
 const buttons=[...dialog.querySelectorAll('[data-settings-section]')],reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const sections=buttons.map(b=>document.getElementById(b.dataset.settingsSection));
 const select=id=>buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.settingsSection===id)));
 for(const button of buttons)button.onclick=()=>{
  const target=document.getElementById(button.dataset.settingsSection);if(!target)return;
  select(target.id);content.scrollTo({top:target.offsetTop-8,behavior:reduce.matches||document.documentElement.dataset.zwMotion==='off'?'auto':'smooth'});
 };
 let frame=null;
 content.addEventListener('scroll',()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=null;const top=content.scrollTop+28;let current=sections[0];for(const section of sections){if(section.offsetTop<=top)current=section;}select(current.id);});},{passive:true});
 function portrait(who){const source=document.getElementById(who==='user'?'userAvatar':'ziweiAvatar'),target=document.getElementById(who==='user'?'settingsUserPortrait':'settingsZiweiPortrait');target.replaceChildren(...[...source.childNodes].map(n=>n.cloneNode(true)));}
 function prepare(){content.scrollTop=0;select('spaceAppearance');for(const who of ['user','ziwei']){portrait(who);document.getElementById(who+'AvatarSelection').textContent='';}document.getElementById('glassLevelValue').value=document.getElementById('glassLevel').value+'%';}
 document.getElementById('glassLevel').addEventListener('input',event=>{document.getElementById('glassLevelValue').value=event.target.value+'%';});
 for(const who of ['user','ziwei'])document.getElementById(who+'AvatarFile').addEventListener('change',event=>{document.getElementById(who+'AvatarSelection').textContent=event.target.files[0]?.name||'';});
 document.getElementById('profileForm').addEventListener('invalid',event=>{const section=event.target.closest('.settings-section');if(section){content.scrollTo({top:section.offsetTop-8});select(section.id);}},{capture:true});
 dialog.addEventListener('close',()=>{if(frame)cancelAnimationFrame(frame);frame=null;for(const id of ['settingsUserPortrait','settingsZiweiPortrait'])document.getElementById(id).replaceChildren();for(const who of ['user','ziwei'])document.getElementById(who+'AvatarSelection').textContent='';});
 window.ZiweiSettings={prepare};
})();
