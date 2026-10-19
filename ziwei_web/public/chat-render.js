'use strict';
window.ZiweiChatRender=(()=>{
 const root=document.documentElement,thoughts=document.getElementById('showThoughts'),glass=document.getElementById('glassLevel'),reduced=document.getElementById('reduceGlass');
 function read(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
 function save(key,value){try{localStorage.setItem(key,value);}catch{}}
 function preference(){root.dataset.thoughts=String(thoughts.checked);root.dataset.reduceGlass=String(reduced.checked);root.style.setProperty('--glass-opacity',String((100-Number(glass.value))/100));}
 thoughts.checked=read('zw_show_summaries','false')==='true';glass.value=read('zw_glass_level','68');reduced.checked=read('zw_reduce_glass','false')==='true';preference();
 thoughts.onchange=()=>{save('zw_show_summaries',String(thoughts.checked));preference();};
 glass.oninput=()=>{save('zw_glass_level',glass.value);preference();};reduced.onchange=()=>{save('zw_reduce_glass',String(reduced.checked));preference();};
 const background=document.getElementById('spaceWallpaper'),backgroundInput=document.getElementById('spaceBackgroundFile'),backgroundStatus=document.getElementById('spaceBackgroundStatus');let spaceImage=null,spaceVersion=0;
 function backgroundStore(write,value){return new Promise((resolve,reject)=>{const open=indexedDB.open('ziwei-chat-appearance',1);open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('preferences'))open.result.createObjectStore('preferences');};open.onerror=()=>reject(open.error);open.onblocked=()=>reject(Error('storage_unavailable'));open.onsuccess=()=>{const db=open.result,tx=db.transaction('preferences',write?'readwrite':'readonly'),store=tx.objectStore('preferences'),request=write?(value?store.put(value,'space-wallpaper'):store.delete('space-wallpaper')):store.get('space-wallpaper');tx.oncomplete=()=>{db.close();resolve(request.result||null);};tx.onerror=()=>{db.close();reject(tx.error);};};});}
 function paintBackground(){const visible=!!spaceImage&&!document.getElementById('app').hidden;background.hidden=!visible;if(visible)background.querySelector('img').src=spaceImage;else background.querySelector('img').removeAttribute('src');document.body.classList.toggle('has-space-wallpaper',visible);}
 const observer=new MutationObserver(paintBackground);observer.observe(document.getElementById('app'),{attributes:true,attributeFilter:['hidden']});
 backgroundStore(false).then(value=>{if(!spaceVersion&&typeof value==='string'&&value.startsWith('data:image/')){spaceImage=value;paintBackground();}}).catch(()=>{});
 document.getElementById('chooseSpaceBackground').onclick=()=>backgroundInput.click();
 document.getElementById('resetSpaceBackground').onclick=async()=>{spaceVersion++;spaceImage=null;paintBackground();try{await backgroundStore(true,null);backgroundStatus.textContent='已恢复跟随主题的背景。';}catch{backgroundStatus.textContent='已恢复主题，本设备暂未能保存设置。';}};
 backgroundInput.onchange=async()=>{const file=backgroundInput.files[0];backgroundInput.value='';if(!file)return;const version=++spaceVersion;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){backgroundStatus.textContent='请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。';return;}
  const url=URL.createObjectURL(file);try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});const scale=Math.min(1,1800/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const value=canvas.toDataURL('image/jpeg',.85);if(version!==spaceVersion)return;await backgroundStore(true,value);if(version!==spaceVersion)return;spaceImage=value;paintBackground();backgroundStatus.textContent='空间壁纸已保存到当前设备。';}catch{if(version===spaceVersion)backgroundStatus.textContent='壁纸未能保存，请重试。';}finally{URL.revokeObjectURL(url);}
 };
 function text(node,value){
  node.replaceChildren();
  // Deliberately small Markdown renderer. No HTML, unsafe links or eval.
  const chunks=value.split(/(```[^\n]*\n[\s\S]*?```)/g);
  for(const chunk of chunks){
   const code=/^```([^\n]*)\n([\s\S]*?)```$/.exec(chunk);
   if(code){const box=document.createElement('section'),label=document.createElement('small'),pre=document.createElement('pre'),body=document.createElement('code'),copy=document.createElement('button');box.className='chat-code';label.textContent=code[1]||'代码';body.textContent=code[2];copy.type='button';copy.textContent='复制代码';copy.onclick=async()=>{try{await navigator.clipboard.writeText(code[2]);copy.textContent='已复制';}catch{copy.textContent='请长按代码复制';}};pre.append(body);box.append(label,copy,pre);node.append(box);}
   else{const span=document.createElement('span');span.textContent=chunk;node.append(span);}
  }
 }
 function actions(node){
  const paths={
   '拍一拍':'M7 12V7a2 2 0 0 1 4 0v5m0-3V5a2 2 0 0 1 4 0v7m0-3a2 2 0 0 1 4 0v6c0 4-2 6-6 6h-1c-2 0-3-1-4-2l-4-5a2 2 0 0 1 3-3l2 2',
   '引用':'M10 7H5v6h4c0 3-1 4-3 5m15-11h-5v6h4c0 3-1 4-3 5',
   '复制':'M9 8V3h12v13h-5M3 8h13v13H3Z',
   '收藏':'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
   '删除':'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
   '恢复':'M4 9a8 8 0 1 1 0 7M4 3v6h6',
   '朗读回复':'M4 9h4l5-5v16l-5-5H4Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
   '重新发送':'M20 9a8 8 0 1 0 0 7m0-13v6h-6'
  };
  for(const button of node.querySelectorAll('button')){const label=button.textContent,key=label==='取消收藏'?'收藏':label;if(!paths[key])continue;button.setAttribute('aria-label',label);button.title=label;button.classList.add('message-action-icon');if(key==='收藏')button.setAttribute('aria-pressed',String(label==='取消收藏'));const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',paths[key]);svg.append(path);button.replaceChildren(svg);}
 }
 return {text,actions};
})();
