/* 中文课堂游戏站 · 知微做的
   六个游戏：转盘 / 抢答 / 图字配对 / 数字练习 / 打地鼠 / 听声找词
   换主题只改 TOPICS 里的词库 */
'use strict';
const $=s=>document.querySelector(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

const TOPICS={
  halloween:{name:'万圣节',words:[
    {h:'鬼',p:'guǐ',e:'ghost',img:'img/gui.png'},
    {h:'鬼屋',p:'guǐ wū',e:'haunted house',img:'img/guiwu.png'},
    {h:'女巫',p:'nǚ wū',e:'witch',img:'img/nvwu.png'},
    {h:'吸血鬼',p:'xī xuè guǐ',e:'vampire',img:'img/xixuegui.png'},
    {h:'蜘蛛',p:'zhī zhū',e:'spider',img:'img/zhizhu.png'},
    {h:'蜘蛛网',p:'zhī zhū wǎng',e:'spider web',img:'img/zhizhuwang.png'}
  ]},
  food:{name:'万圣节食物',words:[
    {h:'南瓜派',p:'nán guā pài',e:'pumpkin pie',img:''},
    {h:'糖果',p:'táng guǒ',e:'candy',img:''},
    {h:'棉花糖',p:'mián huā táng',e:'cotton candy',img:''},
    {h:'机器',p:'jī qì',e:'machine',img:''},
    {h:'竹签',p:'zhú qiān',e:'bamboo stick',img:''},
    {h:'白糖',p:'bái táng',e:'sugar',img:''}
  ]},
  numbers:{name:'数字',words:[]}   // 运行时生成 1–30
};
for(let i=1;i<=30;i++) TOPICS.numbers.words.push({h:numCN(i),p:'',e:String(i),img:'',num:i});

function numCN(n){
  const d=['零','一','二','三','四','五','六','七','八','九'];
  if(n<10)return d[n];
  if(n===10)return '十';
  if(n<20)return '十'+(n%10?d[n%10]:'');
  const t=Math.floor(n/10), r=n%10;
  return d[t]+'十'+(r?d[r]:'');
}
const RANGE={min:1,max:30};

/* 录音文件名（音频放在 audio/ 目录，离线可播） */
const SLUG={halloween:['gui','guiwu','nvwu','xixuegui','zhizhu','zhizhuwang'],
            food:['nanguapai','tangguo','mianhuatang','jiqi','zhuqian','baitang']};
['halloween','food'].forEach(k=>TOPICS[k].words.forEach((w,i)=>{w.audio=SLUG[k][i]+'.mp3';}));
TOPICS.numbers.words.forEach(w=>{w.audio='n'+w.num+'.mp3';});

let topic='halloween';
const W=()=>TOPICS[topic].words;
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const rnd=n=>Math.floor(Math.random()*n);

/* ---------- 首页 ---------- */
const GAMES=[
  {id:'wheel',  name:'🎡 转盘抽词'},
  {id:'quiz',   name:'⚡ 抢答'},
  {id:'match',  name:'🧩 图字配对'},
  {id:'number', name:'🔢 数字练习'},
  {id:'mole',   name:'🔨 打地鼠'},
  {id:'mole2',  name:'🎃 打地鼠 · 加强版'},
  {id:'sentence',name:'✨ 造句魔法屋'},
  {id:'listen', name:'🔊 听声找词'}
];
/* ---------- 网站名字（她自己可改，存在这台设备上） ---------- */
const NAME_KEY='xbs_site_name';
function applyName(){const n=localStorage.getItem(NAME_KEY);if(n)$('#siteName').textContent=n;}
function editName(){
  const cur=$('#siteName').textContent;
  const n=prompt('改成什么名字？（留空＝恢复默认）', cur);
  if(n===null)return;
  const v=n.trim();
  if(!v){localStorage.removeItem(NAME_KEY);$('#siteName').textContent='向博士小课堂';}
  else{localStorage.setItem(NAME_KEY,v);$('#siteName').textContent=v;}
  document.title=$('#siteName').textContent;
}

const DESCS={wheel:'随机跳一个词，读 + 造句',quiz:'看图 / 听音选答案，自动计分',
  match:'图配汉字，比谁快',number:'随机出数，说汉字',mole:'打举对词卡的地鼠',listen:'听录音，点对应的图或字',mole2:'可改词表 / 难度 / 时长，连击计分',sentence:'抽一张词卡，用它造一个句子'};
function home(){
  const m=$('#menu'); m.innerHTML='';
  GAMES.forEach(g=>{const b=el('button','btn',g.name+'<small>'+DESCS[g.id]+'</small>');b.onclick=()=>open(g.id);m.appendChild(b);});
  $('#stage').innerHTML='<div class="card"><div class="qtext">选一个游戏开始 👆</div><div class="hint">先用上面的主题按钮选词库；数字主题只影响「数字练习」和「抢答」里的数字题</div></div>';
  $('#homeBtn').hidden=true;
}
function topicsUI(){
  const t=$('#topics'); t.innerHTML='';
  Object.keys(TOPICS).forEach(k=>{
    const b=el('button','topic'+(topic===k?' on':''),TOPICS[k].name);
    b.onclick=()=>{topic=k;topicsUI();home();};t.appendChild(b);
  });
}
function open(id){
  $('#homeBtn').hidden=false;
  if(id==='mole2'){ location.href='mole-plus.html'; return; }
  if(id==='sentence'){ location.href='sentence.html'; return; }
  ({wheel:gWheel,quiz:gQuiz,match:gMatch,number:gNumber,mole:gMole,listen:gListen}[id])();
}
$('#homeBtn').onclick=home;

/* ---------- 1 转盘 ---------- */
let wheelLast=-1;
function gWheel(){
  const stage=$('#stage');
  stage.innerHTML='<div class="card" id="wheelCard"></div><button class="primary" id="spinBtn">转一个！</button><div class="hint">转到的词：① 读一遍 ② 用它说一句话</div>';
  draw(W()[rnd(W().length)]);
  $('#spinBtn').onclick=()=>{
    const ws=W(); let i; do{i=rnd(ws.length);}while(i===wheelLast&&ws.length>1);
    wheelLast=i; draw(ws[i]);
  };
}
function draw(w){
  const pinyin=w.p?('<div class="pinyin">'+w.p+'</div>'):'';
  const en=w.e?('<div class="en">'+w.e+'</div>'):'';
  const img=w.img?('<img class="icon" src="'+w.img+'" alt="">'):'';
  $('#wheelCard').innerHTML=img+'<div class="big">'+w.h+'</div>'+pinyin+en;
}

/* ---------- 2 抢答 ---------- */
function qBank(){
  const ws=W(), out=[];
  ws.forEach((w,i)=>{
    if(!w.img) return;
    const opts=[w], pool=ws.filter(x=>x.img&&x.h!==w.h);
    shuffle(pool); while(opts.length<4&&pool.length) opts.push(pool.pop());
    shuffle(opts);
    out.push({q:'「'+w.h+'」'+'是哪一个？',opts:opts.map(o=>o.img),labels:opts.map(o=>o.h),img:true,ans:opts.indexOf(w)});
  });
  ws.forEach(w=>{
    if(!w.img) return;
    const pool=ws.filter(x=>x.img&&x.h!==w.h); shuffle(pool);
    const opts=[w,...pool.slice(0,3)]; shuffle(opts);
    out.push({q:'听到「'+w.p+'」选哪一个？',opts:opts.map(o=>o.h),labels:null,img:false,ans:opts.indexOf(w)});
  });
  shuffle(out);
  return out.slice(0,10);
}
function gQuiz(){
  const bank=qBank(); let i=0,score=0;
  const stage=$('#stage');
  stage.innerHTML='<div class="card"><div class="qtext" id="qT"></div><div class="opts" id="qO"></div><div class="row"><span id="qS"></span><span id="qP"></span></div></div><button class="ghost" id="again">重新开始</button>';
  const next=()=>{
    if(i>=bank.length){
      $('#qT').textContent='全部答完！得分：'+score+' / '+bank.length+' 🎉';$('#qO').innerHTML='';$('#qP').textContent='';return;
    }
    const q=bank[i];
    $('#qT').textContent=q.q;$('#qS').textContent='得分：'+score;$('#qP').textContent=(i+1)+' / '+bank.length;
    const box=$('#qO');box.innerHTML='';
    q.opts.forEach((o,idx)=>{
      const b=el('button');
      b.innerHTML = q.img ? ('<img src="'+o+'" style="height:52px;vertical-align:middle">') : o;
      b.onclick=()=>{
        [...box.children].forEach(x=>x.disabled=true);
        if(idx===q.ans){b.classList.add('ok');score++;}
        else{b.classList.add('no');box.children[q.ans].classList.add('ok');}
        setTimeout(()=>{i++;next();},850);
      };
      box.appendChild(b);
    });
  };
  $('#again').onclick=()=>{bank.length=0;gQuiz();};
  next();
}

/* ---------- 3 图字配对 ---------- */
function gMatch(){
  const ws=W().filter(w=>w.img);
  if(ws.length<2){$('#stage').innerHTML='<div class="card">这个主题没有图，换「万圣节」主题再玩</div>';return;}
  let sel=null,done=0,t0=Date.now();
  $('#stage').innerHTML='<div class="card"><div class="grid3" id="g1"></div></div><div class="card"><div class="grid3" id="g2"></div></div><div class="row"><span id="mS"></span><span id="mT"></span></div><div class="hint">先点图，再点汉字</div>';
  const g1=$('#g1'),g2=$('#g2');
  shuffle([...ws]).forEach(w=>{const d=el('button','tile','<img src="'+w.img+'" alt="">');d.dataset.k=w.h;d.onclick=()=>pick(d);g1.appendChild(d);});
  shuffle([...ws]).forEach(w=>{const d=el('button','tile','<div style="font-size:26px;padding:9px 0">'+w.h+'</div>');d.dataset.k=w.h;d.onclick=()=>pick(d);g2.appendChild(d);});
  const upd=()=>{$('#mS').textContent='已配对：'+done+' / '+ws.length;if(done===ws.length)$('#mT').textContent='用时 '+Math.round((Date.now()-t0)/1000)+' 秒 🎉';};
  function pick(e){
    if(e.classList.contains('done'))return;
    if(!sel){sel=e;e.classList.add('sel');return;}
    if(sel===e){e.classList.remove('sel');sel=null;return;}
    if(sel.dataset.k===e.dataset.k){sel.classList.remove('sel');sel.classList.add('done');e.classList.add('done');done++;sel=null;upd();}
    else{const a=sel;sel=null;a.classList.remove('sel');e.classList.add('miss');setTimeout(()=>e.classList.remove('miss'),450);}
  }
  upd();
}

/* ---------- 4 数字练习 ---------- */
function gNumber(){
  let n=0;
  const stage=$('#stage');
  stage.innerHTML='<div class="card"><div class="num" id="nShow">—</div><div class="pinyin" id="nPin"></div></div><button class="primary" id="nNew">换一个数字</button><div class="hint">老师指着数字问「这是几？」→ 学生说汉字 → 点「换一个」继续<br>也可以让学生数：一起从 1 数到 30</div>';
  const show=()=>{
    const min=Math.max(1,RANGE.min),max=Math.min(30,RANGE.max);
    n=min+rnd(max-min+1);
    $('#nShow').textContent=String(n);
    $('#nPin').textContent=numCN(n);
  };
  $('#nNew').onclick=show; show();
}

/* ---------- 5 打地鼠 ---------- */
function gMole(){
  const ws=W().filter(w=>w.img).length>=3?W().filter(w=>w.img):W();
  let score=0,left=45,target=null,timer=null,pop=null;
  $('#stage').innerHTML='<div class="card"><div class="qtext">打它：<span id="tgt" style="color:#ff9f43"></span></div><div class="holes" id="holes"></div><div class="row"><span id="sc">得分：0</span><span id="tm">45 秒</span></div><div class="hint">哪只地鼠举着这个词，就打它！打错扣一分</div></div>';
  const holes=$('#holes');
  for(let i=0;i<6;i++) holes.appendChild(el('div','hole'));
  const holeEls=[...holes.children];
  function newTarget(){
    target=ws[rnd(ws.length)];
    const img=target.img?('<img src="'+target.img+'" alt="">'):'';
    $('#tgt').innerHTML=target.h+' <span class="pinyin" style="display:inline;font-size:15px">'+target.p+'</span>';
  }
  function popUp(){
    holeEls.forEach(h=>{h.className='hole';h.innerHTML='';});
    const idx=shuffle([...holeEls.keys()]).slice(0,3);
    idx.forEach(i=>{
      const w=ws[rnd(ws.length)],h=holeEls[i];
      h.className='hole up';
      h.innerHTML=(w.img?'<img src="'+w.img+'" alt="">':'<div class="h">'+w.h+'</div>');
      h.onclick=()=>{
        if(w.h===target.h){score++;h.classList.add('hit');newTarget();}
        else{score--;h.classList.add('miss');}
        $('#sc').textContent='得分：'+score;
        h.onclick=null;setTimeout(()=>{h.className='hole';h.innerHTML='';},320);
      };
    });
  }
  newTarget();
  timer=setInterval(()=>{left--;$('#tm').textContent=left+' 秒';if(left<=0){clearInterval(timer);clearInterval(pop);$('#sc').textContent='结束！得分：'+score;holeEls.forEach(h=>{h.className='hole';h.innerHTML='';h.onclick=null;});}},1000);
  pop=setInterval(popUp,1400);popUp();
}

/* ---------- 6 听声找词 ---------- */
function gListen(){
  const ws=W();
  let cur=null,score=0,total=0;
  $('#stage').innerHTML='<div class="card"><button class="primary" id="playBtn">🔊 再听一遍</button><div class="grid3" id="opts" style="margin-top:12px"></div><div class="row"><span id="lS">答对：0 / 0</span><span id="lP"></span></div><div class="hint">听录音，点出对应的图或字</div></div><button class="ghost" id="lNext">下一个</button>';
  const audio=new Audio();
  const say=w=>{audio.src='audio/'+w.audio;audio.play().catch(()=>{});};
  function next(){
    const pool=[...ws].filter(w=>w.audio);
    if(!pool.length){$('#opts').innerHTML='<div class="hint">这个主题没有录音，换「万圣节」或「数字」主题</div>';return;}
    cur=pool[rnd(pool.length)];
    const others=shuffle(ws.filter(w=>w.h!==cur.h)).slice(0,5);
    const opts=shuffle([cur,...others]);
    const box=$('#opts');box.innerHTML='';
    opts.forEach(o=>{
      const b=el('button');
      b.innerHTML = o.img?('<img src="'+o.img+'" style="height:54px">'):('<div style="font-size:26px">'+o.h+'</div>');
      b.onclick=()=>{
        total++;
        if(o.h===cur.h){b.classList.add('ok');score++;}
        else{b.classList.add('no');[...box.children].forEach((x,i)=>{if(opts[i].h===cur.h)x.classList.add('ok');});}
        $('#lS').textContent='答对：'+score+' / '+total;
        setTimeout(next,900);
      };
      box.appendChild(b);
    });
    say(cur);
  }
  $('#playBtn').onclick=()=>cur&&say(cur);
  $('#lNext').onclick=next;
  next();
}

/* ---------- 起 ---------- */
applyName();
$('#gear').onclick=editName;
topicsUI();home();
