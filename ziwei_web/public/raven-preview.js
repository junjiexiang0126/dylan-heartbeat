import {RavenView} from '/raven-view.js';
const status=document.querySelector('#previewStatus'),canvas=document.querySelector('#previewCanvas');
const view=new RavenView(canvas,{onReady:()=>{status.textContent='模型已载入 · 动作演示';view.resume();},onError:message=>status.textContent=message,onInteract:name=>{status.textContent=name==='Poke'?'别戳，还活着。':name?'跳一下，回到刚才的动作。':'互动结束 · 恢复所选动作';}});
for(const [name,mode] of [['待机','Idle'],['在工作','Work'],['在休息','Rest'],['在思考','Think'],['在想你','Affection'],['过期装死','Stale']]){const b=document.createElement('button');b.className='secondary';b.textContent=name;b.onclick=()=>{view.setMode(mode);status.textContent='动作预览：'+name;};document.querySelector('#previewControls').append(b);}
// A render-only handle for screenshots / reviewing animation frames, no API.
window.RavenPreview=view;
document.addEventListener('visibilitychange',()=>document.hidden?view.pause():view.resume());addEventListener('pagehide',()=>view.dispose());
