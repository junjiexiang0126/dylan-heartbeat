'use strict';
window.ZiweiFiles=(()=>{
 const $=id=>document.getElementById(id),dialog=$('fileViewer');let revision=0,controller=null,file=null,blobURL=null;
 function reset(){revision++;controller?.abort();controller=null;file=null;if(blobURL)URL.revokeObjectURL(blobURL);blobURL=null;$('filePreview').replaceChildren();$('fileViewerName').textContent='';$('fileViewerStatus').textContent='';$('fileSave').disabled=true;}
 function close(){reset();if(dialog.open)dialog.close();}
 dialog.addEventListener('close',()=>{if(!dialog.open)reset();});$('fileClose').onclick=close;$('fileBack').onclick=close;
 async function open(url,name,mime=''){
  reset();const backLabel=$('chat').hidden?'返回上一页':'返回聊天';$('fileBack').textContent=backLabel;$('fileClose').setAttribute('aria-label','关闭文件，'+backLabel);const version=revision;controller=new AbortController();$('fileViewerName').textContent=name;$('fileViewerStatus').textContent='正在准备文件…';if(!dialog.open)dialog.showModal();
  try{
   const response=await fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('文件读取失败，请关闭后重试。');
   const blob=await response.blob();if(version!==revision)return;
   file=new File([blob],name,{type:blob.type||mime||'application/octet-stream'});$('fileSave').disabled=false;
   $('fileViewerStatus').textContent='文件已准备好。保存或分享后，可直接关闭返回。';
   const pre=document.createElement('pre');pre.className='file-text-preview';
   if(/^image\//.test(mime)){blobURL=URL.createObjectURL(blob);const image=document.createElement('img');image.className='file-image-preview';image.src=blobURL;image.alt=name;$('filePreview').append(image);}
   else if(/^text\//.test(mime)||/\.(txt|md|csv|json)$/i.test(name)){pre.textContent=await blob.slice(0,500000).text();if(version!==revision)return;$('filePreview').append(pre);if(blob.size>500000)$('fileViewerStatus').textContent='这里只预览前部文字；保存或分享会保留完整文件。';}
   else if(/\.(pdf|docx|xlsx)$/i.test(name)){
    const preview=await fetch(url+'/preview',{cache:'no-store',signal:controller.signal});if(version!==revision)return;
    if(preview.ok){const value=await preview.json();if(version!==revision)return;pre.textContent=value.text||'此文件暂无可提取的文字。';$('filePreview').append(pre);$('fileViewerStatus').textContent='文字预览；原始排版以保存后的文件为准。';}
    else $('fileViewerStatus').textContent='此格式暂不支持站内预览，可保存或分享完整文件。';
   }else $('fileViewerStatus').textContent='文件已准备好，可保存或分享完整文件。';
  }catch(error){if(version===revision&&error.name!=='AbortError')$('fileViewerStatus').textContent=file?'预览暂不可用，仍可保存或分享完整文件。':error.message;}
 }
 $('fileSave').onclick=async()=>{
  if(!file)return;const selected=file,version=revision;let sharing=false;
  try{
   // The file was loaded before this gesture: iOS retains user activation.
   if(navigator.share&&navigator.canShare?.({files:[selected]})){sharing=true;await navigator.share({files:[selected],title:selected.name});if(version===revision)$('fileViewerStatus').textContent='系统分享已返回。你可以关闭并回到聊天。';}
   else{
    const standalone=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
    if(standalone&&/iPad|iPhone|iPod/.test(navigator.userAgent)){if(version===revision)$('fileViewerStatus').textContent='系统暂未允许文件分享。请在 Safari 中打开知微之家后保存；此页面可以直接关闭返回。';return;}
    if(blobURL)URL.revokeObjectURL(blobURL);blobURL=URL.createObjectURL(selected);const a=document.createElement('a');a.href=blobURL;a.download=selected.name;a.target='_blank';a.rel='noopener';document.body.append(a);a.click();a.remove();$('fileViewerStatus').textContent='已交给浏览器下载。关闭此面板即可返回。';
   }
  }catch(error){if(version===revision)$('fileViewerStatus').textContent=error.name==='AbortError'?'已取消分享，文件仍可查看。':sharing?'系统未能打开分享面板，请再次点击重试。':'保存未成功，请重试。';}
 };
 return {open,close,reset:close};
})();
