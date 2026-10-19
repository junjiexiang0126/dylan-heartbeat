/* PhotoStack chat integration. Upstream engine/styles remain unmodified.
 * Required Notice: PhotoStack by Wren036 (https://github.com/Wren036/PhotoStack)
 * PolyForm Noncommercial 1.0.0 — personal/noncommercial use only.
 */
'use strict';
(() => {
  const timeline = document.getElementById('chatMessages');
  if (!timeline || !window.PhotoStack) return;
  const instances = new Map();
  let scheduled = false;
  function reconcile() {
    scheduled = false;
    for (const [bubble, record] of instances) {
      if (!bubble.isConnected) { record.stack.destroy(); instances.delete(bubble); }
    }
    for (const bubble of timeline.querySelectorAll('.message-bubble')) {
      const images = [...bubble.querySelectorAll('img.message-media')];
      const current = instances.get(bubble);
      if (images.length < 2) {
        if (current) { current.stack.destroy(); current.stage.remove(); instances.delete(bubble); }
        images.forEach(img => img.classList.remove('photostack-source-hidden'));
        continue;
      }
      const urls = images.map(img => img.src);
      if (current && current.images.length === urls.length && current.images.every((url, i) => url === urls[i])) continue;
      if (current) { current.stack.destroy(); current.stage.remove(); instances.delete(bubble); }
      const stage = document.createElement('div');
      stage.className = 'chat-photostack';
      stage.setAttribute('aria-label', '滑动浏览 ' + images.length + ' 张照片');
      stage.setAttribute('role', 'group');
      stage.tabIndex = 0;
      images[0].before(stage);
      images.forEach(img => img.classList.add('photostack-source-hidden'));
      const stack = new PhotoStack(stage, urls, {
        onTap(i) {
          // The existing authenticated image viewer still owns full-resolution display/save.
          const image = images[i];
          if (image) window.ZiweiChatExtra?.showImage(image);
        }
      });
      stage.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); stack.prev(); }
        if (event.key === 'ArrowRight') { event.preventDefault(); stack.next(); }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.ZiweiChatExtra?.showImage(images[stack.index]); }
      });
      instances.set(bubble, { stack, stage, images: urls });
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reconcile);
  }
  new MutationObserver(schedule).observe(timeline, { childList: true, subtree: true });
  schedule();
})();
