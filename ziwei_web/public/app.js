const login=document.querySelector('#login'),app=document.querySelector('#app'),err=document.querySelector('#loginError');
let csrf=null;
async function refresh(){const r=await fetch('/api/session',{cache:'no-store'});if(!r.ok)throw Error('session unavailable');const s=await r.json();csrf=s.csrf;login.hidden=s.authenticated;app.hidden=!s.authenticated}
document.querySelector('#loginForm').addEventListener('submit',async e=>{e.preventDefault();err.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.querySelector('#password').value})});if(!r.ok){err.textContent=r.status===503?'服务端尚未配置登录密码':r.status===429?'尝试次数过多，请15分钟后重试':'登录失败，请检查密码';return}document.querySelector('#password').value='';await refresh()}catch{err.textContent='网络连接失败'}});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==b.dataset.tab);document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b))});
document.querySelector('#logout').onclick=async()=>{if(!csrf)return;const r=await fetch('/api/logout',{method:'POST',headers:{'X-Ziwei-CSRF':csrf}});if(r.ok)await refresh()};
refresh().catch(()=>{err.textContent='无法连接服务端'});
