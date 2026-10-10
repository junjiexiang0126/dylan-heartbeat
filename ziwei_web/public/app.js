'use strict';
const $ = s => document.querySelector(s);
let csrf = null, homeData = null, sessionData = null, pendingAvatars = {}, activeTab = 'home', refreshVersion = 0;
const media = matchMedia('(prefers-color-scheme: dark)');
function appearance() {
  const p = homeData?.preferences || { theme: 'system', background: 'rose' };
  document.documentElement.dataset.theme = p.theme === 'system' ? media.matches ? 'dark' : 'light' : p.theme;
  document.documentElement.dataset.background = p.background;
  $('meta[name=theme-color]').content = document.documentElement.dataset.theme === 'dark' ? '#211b26' : '#f6e9e5';
}
media.addEventListener('change', appearance);
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: { ...(body ? {'Content-Type':'application/json'} : {}), ...(csrf ? {'X-Ziwei-CSRF':csrf} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  let data; try { data = await r.json(); } catch { throw Error('服务响应异常，请稍后重试'); }
  if (!r.ok) {
    if (r.status === 401 && url !== '/api/login' && !url.startsWith('/api/passkey/')) clearPrivateUI();
    throw Error(r.status === 409 ? '资料已在其他页面更新，请重新打开设置后保存。' : r.status === 429 ? '尝试次数过多，请 15 分钟后重试。' : r.status === 503 ? '服务尚未配置此功能。' : r.status === 401 ? '验证失败，请检查密码或设备凭据。' : r.status === 413 ? '图片过大，请选择较小的图片。' : '操作未完成，请检查输入后重试。');
  }
  return data;
}
function tab(name) {
  activeTab = name;
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== name);
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active',b.dataset.tab===name);b.setAttribute('aria-current',b.dataset.tab===name?'page':'false'); });
  window.scrollTo({top:0});
}
function renderAvatar(el, profile) {
  el.replaceChildren();
  const child = document.createElement(profile.avatar ? 'img' : 'span');
  if (profile.avatar) { child.src = profile.avatar; child.alt = profile.nickname + '的头像'; }
  else child.textContent = [...profile.nickname][0];
  el.append(child);
}
function renderHome() {
  $('#userName').textContent = homeData.user.nickname;
  $('#ziweiName').textContent = homeData.ziwei.nickname;
  renderAvatar($('#userAvatar'),homeData.user); renderAvatar($('#ziweiAvatar'),homeData.ziwei);
  $('#memorialText').textContent = homeData.memorial;
  $('#dateLabel').textContent = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Bangkok'}).format(new Date());
  appearance();
}
function clearPrivateUI() {
  refreshVersion++;csrf=null; homeData=null; sessionData=null; pendingAvatars={};
  if($('#settings').open)$('#settings').close();
  $('#app').hidden=true;$('#settingsButton').hidden=true;$('#login').hidden=false;
  $('#userAvatar').replaceChildren();$('#ziweiAvatar').replaceChildren();$('#userName').textContent='';$('#ziweiName').textContent='';$('#memorialText').textContent='';$('#historyList').replaceChildren();
  $('#profileForm').reset();$('#verifyPassword').value='';appearance();
}
async function passkeySupported() {
  try { return !!(window.isSecureContext && window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
async function refresh() {
  const version=++refreshVersion;const s = await api('/api/session');if(version!==refreshVersion)return;sessionData=s;csrf=s.csrf;
  if (!s.authenticated) { clearPrivateUI(); $('#unlockButton').hidden=!(s.passkeyAvailable && await passkeySupported()); return; }
  const h=await api('/api/home');if(version!==refreshVersion)return;homeData=h;renderHome();
  $('#login').hidden=true;$('#app').hidden=false;$('#settingsButton').hidden=false;
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const button=e.submitter;button.disabled=true;$('#loginError').textContent='';
  try { await api('/api/login','POST',{password:$('#password').value});$('#password').value='';tab('home');await refresh(); }
  catch(e) { $('#loginError').textContent=e.message; } finally { button.disabled=false; }
});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
$('#settingsButton').onclick=async()=>{
  try {
    homeData=await api('/api/home');renderHome();pendingAvatars={};$('#profileForm').reset();
    $('#userNickname').value=homeData.user.nickname;$('#ziweiNickname').value=homeData.ziwei.nickname;$('#theme').value=homeData.preferences.theme;$('#background').value=homeData.preferences.background;
    $('#settingsMessage').textContent='';$('#verifyPassword').value='';
    sessionData=await api('/api/session');
    $('#registerPasskey').disabled=!(sessionData.passkeyAvailable && await passkeySupported());
    $('#passkeyMessage').textContent=$('#registerPasskey').disabled?'此环境暂不支持设备解锁，请继续使用密码。':`已保存 ${sessionData.passkeyCount} 个设备解锁凭据。`;
    $('#removePasskeys').disabled=!sessionData.passkeyCount;
    $('#historyList').replaceChildren();
    homeData.profileHistory.slice().reverse().forEach(h=>{const li=document.createElement('li');li.textContent=`${new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(h.at))} · 你修改了${h.who==='user'?'你的':'知微的'}资料：${h.before.nickname} → ${h.after.nickname}${h.before.avatar!==h.after.avatar?'（头像已变更）':''}`;$('#historyList').append(li);});
    if(!homeData.profileHistory.length){const li=document.createElement('li');li.textContent='还没有资料变更。';$('#historyList').append(li);}
    $('#settings').showModal();
  }catch(e){$('#loginError').textContent=e.message;}
};
$('#closeSettings').onclick=()=>{$('#settings').close();pendingAvatars={};$('#verifyPassword').value='';};
$('#settings').addEventListener('close',()=>{$('#verifyPassword').value='';pendingAvatars={};});
async function prepareAvatar(file) {
  if(!file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>8*1024*1024)throw Error('请选择 8 MB 以内的 PNG、JPEG 或 WebP 图片。');
  const url=URL.createObjectURL(file);
  try {
    const img=new Image();img.src=url;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const c=canvas.getContext('2d');const size=Math.min(img.width,img.height);c.drawImage(img,(img.width-size)/2,(img.height-size)/2,size,size,0,0,256,256);
    return canvas.toDataURL('image/jpeg',.82);
  }finally{URL.revokeObjectURL(url);}
}
for(const who of ['user','ziwei']) {
  $('#'+who+'AvatarFile').onchange=async e=>{ $('#saveProfile').disabled=true; try {pendingAvatars[who]=await prepareAvatar(e.target.files[0]);$('#settingsMessage').textContent='头像已准备好，请保存。';}catch(e){$('#settingsMessage').textContent='图片无法读取，请选择有效的 PNG、JPEG 或 WebP 图片。';}finally{$('#saveProfile').disabled=false;} };
  $('#clear'+(who==='user'?'User':'Ziwei')+'Avatar').onclick=()=>{pendingAvatars[who]=null;$('#'+who+'AvatarFile').value='';$('#settingsMessage').textContent='保存后恢复默认头像。';};
}
$('#profileForm').onsubmit=async e=>{
  e.preventDefault();$('#saveProfile').disabled=true;
  try {
    const body={revision:homeData.revision,user:{nickname:$('#userNickname').value},ziwei:{nickname:$('#ziweiNickname').value},preferences:{theme:$('#theme').value,background:$('#background').value}};
    for(const who of ['user','ziwei'])if(Object.hasOwn(pendingAvatars,who))body[who].avatar=pendingAvatars[who];
    homeData=await api('/api/home','PUT',body);pendingAvatars={};renderHome();$('#settingsMessage').textContent='已保存。';
  }catch(e){$('#settingsMessage').textContent=e.message;}finally{$('#saveProfile').disabled=false;}
};
function decode(v){return Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(v.length/4)*4,'=')),c=>c.charCodeAt(0));}
function encode(v){return btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function credentialJSON(c) {
  const r=c.response;
  return {id:c.id,rawId:encode(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),authenticatorAttachment:c.authenticatorAttachment,response:{clientDataJSON:encode(r.clientDataJSON),...(r.attestationObject?{attestationObject:encode(r.attestationObject),transports:r.getTransports?.()||[]}:{authenticatorData:encode(r.authenticatorData),signature:encode(r.signature),userHandle:r.userHandle?encode(r.userHandle):null})}};
}
function optionsJSON(o) {
  const v={...o,challenge:decode(o.challenge)};
  if(v.user)v.user={...v.user,id:decode(v.user.id)};
  for(const key of ['excludeCredentials','allowCredentials'])if(v[key])v[key]=v[key].map(c=>({...c,id:decode(c.id)}));
  return v;
}
function deviceError(e){return ['NotAllowedError','AbortError'].includes(e.name)?'设备解锁已取消或超时，可使用密码继续。':e.name==='InvalidStateError'?'此设备已保存解锁凭据。':e.message;}
$('#registerPasskey').onclick=async()=>{
  $('#registerPasskey').disabled=true;
  try {const o=await api('/api/passkey/register/options','POST',{password:$('#verifyPassword').value});$('#verifyPassword').value='';const c=await navigator.credentials.create({publicKey:optionsJSON(o)});await api('/api/passkey/register/verify','POST',credentialJSON(c));$('#passkeyMessage').textContent='设备解锁已开启。下次退出或锁定后可以使用。';$('#removePasskeys').disabled=false;}
  catch(e){$('#passkeyMessage').textContent=deviceError(e);}finally{$('#verifyPassword').value='';$('#registerPasskey').disabled=false;}
};
$('#unlockButton').onclick=async()=>{
  $('#unlockButton').disabled=true;$('#loginError').textContent='';
  try {const o=await api('/api/passkey/login/options','POST',{});const c=await navigator.credentials.get({publicKey:optionsJSON(o)});await api('/api/passkey/login/verify','POST',credentialJSON(c));tab('home');await refresh();}
  catch(e){$('#loginError').textContent=deviceError(e);}finally{$('#unlockButton').disabled=false;}
};
$('#removePasskeys').onclick=async()=>{
  try {await api('/api/passkey/remove-all','POST',{password:$('#verifyPassword').value});$('#passkeyMessage').textContent='所有设备解锁凭据已移除。';$('#removePasskeys').disabled=true;}catch(e){$('#passkeyMessage').textContent=e.message;}finally{$('#verifyPassword').value='';}
};
async function logout(all) {try {await api(all?'/api/logout-all':'/api/logout','POST');clearPrivateUI();tab('home');await refresh();}catch(e){$('#passkeyMessage').textContent=e.message;}}
$('#logout').onclick=()=>logout(false);$('#logoutAll').onclick=()=>logout(true);
// A restored back/forward page must recheck its server session before displaying private data.
window.addEventListener('pagehide',clearPrivateUI);
window.addEventListener('pageshow',()=>refresh().catch(()=>{clearPrivateUI();$('#loginError').textContent='无法连接服务，请稍后重试。';}));
window.addEventListener('focus',()=>{if(homeData)refresh().catch(()=>{});});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
appearance();tab('home');
