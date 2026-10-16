import {resolvePresence} from './presence.mjs';
const app=document.querySelector('#app'),home=document.querySelector('#home'),article=document.querySelector('.today');
if(app&&home&&article){
 const stage=document.createElement('div');stage.className='raven-stage';stage.id='ravenStage';
 const poster=document.createElement('img');poster.src='/models/raven-poster.png';poster.alt='圆滚滚的小渡鸦';poster.className='raven-fallback';stage.append(poster);
 const canvas=document.createElement('canvas');canvas.id='ravenCanvas';canvas.tabIndex=0;canvas.setAttribute('role','button');canvas.setAttribute('aria-label','小渡鸦：点击互动，左右拖动旋转');stage.append(canvas);
 const caption=document.createElement('p');caption.id='ravenCaption';caption.className='raven-caption';
 const feedback=document.createElement('p');feedback.id='ravenFeedback';feedback.className='raven-feedback';feedback.setAttribute('aria-live','polite');
 const retry=document.createElement('button');retry.className='text-button raven-retry';retry.textContent='重新载入渡鸦';retry.hidden=true;
 article.classList.add('raven-home');article.querySelector('.status-orbit')?.nextElementSibling?.classList.add('raven-info');article.append(stage,caption,feedback,retry);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let view=null,pending=false,source=null,epoch=0,requestVersion=0,shown=false,inViewport=false,timer=null,loadError=null;
 const visible=()=>!app.hidden&&!home.hidden&&!document.hidden;
 function paint(){original?.call(window.ZiweiChatExtra,source);const state=resolvePresence(source);stage.dataset.presence=state.state||'unknown';stage.dataset.mode=state.mode;stage.dataset.stale=String(state.stale);
  view?.setMode(state.mode);const clock=state.updatedAt?new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Bangkok'}).format(new Date(state.updatedAt)):null;
  caption.textContent=state.stale?'状态已过期 · 最后更新于 '+clock:state.state?'点击跳一下 · 左右拖动看看':'尚无状态记录 · 等知微本人更新';canvas.setAttribute('aria-label',state.stale?'装死的小渡鸦：点一下戳戳，左右拖动旋转':'小渡鸦：点击跳跃，左右拖动旋转');
  if(loadError)feedback.textContent=loadError;else if(!view?.interaction)feedback.textContent=state.stale?'只是很久没更新，不是真的挂了。':'';
 }
 function accept(value){source=value;requestVersion++;paint();}
 // Reuse the existing public presence delivery, never change its contents.
 const original=window.ZiweiChatExtra?.presence;if(original)window.ZiweiChatExtra.presence=function(value){original.apply(this,arguments);accept(value);};
 async function ensure(){if(view||pending||!visible()||!inViewport)return;pending=true;const v=epoch;try{const {RavenView}=await import('/raven-view.js');if(v!==epoch||!visible())return;
   view=new RavenView(canvas,{reduced:reduced.matches,onReady:()=>{if(v!==epoch)return;loadError=null;canvas.hidden=false;canvas.removeAttribute('aria-disabled');poster.hidden=true;retry.hidden=true;paint();sync();},onError:message=>{if(v!==epoch)return;loadError=message;canvas.hidden=true;canvas.setAttribute('aria-disabled','true');poster.hidden=false;retry.hidden=false;feedback.textContent=message;},onInteract:name=>{if(v!==epoch)return;feedback.textContent=name==='Poke'?'别戳，还活着。':name?'蹦一下，马上回来。':'';if(!name)paint();}});paint();if(inViewport)view.resume();
  }catch{if(v===epoch){loadError='3D 暂时无法载入，保留静态渡鸦。';canvas.hidden=true;poster.hidden=false;retry.hidden=false;feedback.textContent=loadError;}}finally{pending=false;}}
 async function refresh(){if(!visible())return;const v=epoch,run=++requestVersion;try{const response=await fetch('/api/chat/status',{credentials:'same-origin',cache:'no-store'});if(v!==epoch||run!==requestVersion||!visible())return;if(response.status===401){document.dispatchEvent(new Event('ziwei-session-expired'));return;}if(!response.ok)return;const data=await response.json();if(v===epoch&&run===requestVersion&&visible()&&Object.hasOwn(data,'presence'))accept(data.presence);}catch{if(v===epoch)paint();}}
 function sync(){const on=visible();if(app.hidden){if(shown||view||source){epoch++;requestVersion++;source=null;loadError=null;view?.dispose();view=null;poster.hidden=false;delete canvas.dataset.ready;feedback.textContent='';paint();}}
  if(on&&!shown){paint();void ensure();void refresh();clearInterval(timer);timer=setInterval(()=>{paint();void refresh();},30000);}else if(!on){clearInterval(timer);timer=null;view?.pause();}shown=on;if(on&&inViewport)view?.resume();else view?.pause();}
 const observer=new MutationObserver(sync);observer.observe(app,{attributes:true,attributeFilter:['hidden']});observer.observe(home,{attributes:true,attributeFilter:['hidden']});
 const intersection=new IntersectionObserver(entries=>{inViewport=entries[0].isIntersecting;if(visible()&&inViewport){void ensure();view?.resume();}else view?.pause();});intersection.observe(stage);
 reduced.addEventListener('change',()=>{view?.setReduced(reduced.matches);sync();});document.addEventListener('visibilitychange',sync);addEventListener('pagehide',()=>{clearInterval(timer);view?.dispose();view=null;epoch++;source=null;requestVersion++;shown=false;});addEventListener('pageshow',sync);
 retry.onclick=()=>{epoch++;view?.dispose();view=null;pending=false;loadError=null;canvas.hidden=false;canvas.removeAttribute('aria-disabled');retry.hidden=true;poster.hidden=false;void ensure();};paint();sync();
}
