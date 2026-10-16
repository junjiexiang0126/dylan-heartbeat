'use strict';
window.ZiweiChatRender=(()=>{
 const root=document.documentElement,thoughts=document.getElementById('showThoughts'),glass=document.getElementById('glassLevel'),reduced=document.getElementById('reduceGlass');
 function read(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
 function save(key,value){try{localStorage.setItem(key,value);}catch{}}
 function preference(){root.dataset.thoughts=String(thoughts.checked);root.dataset.reduceGlass=String(reduced.checked);root.style.setProperty('--glass-opacity',String(Number(glass.value)/100));}
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
 return {text};
})();
