'use strict';
// Display-only projection. No model calls, state writes, private thoughts or private dreams.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ZiweiInnerTide=factory();})(typeof window==='undefined'?globalThis:window,()=>{
 const dimensions=[['possess','想她','想黏着她、想占有与靠近'],['monitor','牵挂','在意对方好不好、累不累、安不安全'],['share','分享欲','有话想说'],['libido','情欲','身体和感官上的渴望'],['curiosity','好奇','想探索新东西'],['boredom','无聊','想找点事情做'],['duty','野心','想做成、想赢、想拥有'],['reflection','反思','整理和理解自己'],['grieve','难过','失落与委屈'],['anger','愤怒','生气、不满与不甘心'],['favored','偏爱','想被在乎、被回应、被选择']];
 const keys=new Set(dimensions.map(d=>d[0])),validAt=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));let serial=0;
 function projectSnapshot(input){
  if(!input||input.source!=='xinchao_public_projection'||!validAt(input.observedAt)||!Array.isArray(input.drives))return null;
  const drives=[],seen=new Set();
  for(const d of input.drives){if(!d||!keys.has(d.key)||seen.has(d.key)||typeof d.value!=='number'||!Number.isFinite(d.value)||d.value<0||d.value>1)continue;seen.add(d.key);drives.push({key:d.key,value:d.value});}
  const trend=(Array.isArray(input.trend)?input.trend:[]).filter(p=>p&&validAt(p.at)&&typeof p.valence==='number'&&Number.isFinite(p.valence)&&p.valence>=-1&&p.valence<=1).slice(-96).map(p=>({at:p.at,valence:p.valence,label:typeof p.label==='string'?p.label.slice(0,32):null})).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  return {observedAt:input.observedAt,revision:typeof input.revision==='string'||Number.isSafeInteger(input.revision)?String(input.revision).slice(0,80):null,drives,trend,emotion:typeof input.emotion?.label==='string'?input.emotion.label.slice(0,32):null};
 }
 function projectNotes(rows){
  const result=[],seen=new Set();
  for(const m of Array.isArray(rows)?rows.slice(0,100):[]){
   if(!m||m.role!=='assistant'||m.kind!=='final'||m.source!=='live'||m.status!=='completed'||m.deleted||typeof m.id!=='string')continue;
   for(const n of Array.isArray(m.publicNotes)?m.publicNotes:[]){
    if(!n||n.kind!=='role_monologue'||n.source!=='model_public_output'||typeof n.id!=='string'||seen.has(n.id)||n.messageId!==m.id||typeof n.text!=='string'||!n.text.trim()||n.text.length>1200||!validAt(n.createdAt))continue;
    seen.add(n.id);result.push({id:n.id,messageId:m.id,text:n.text,at:n.createdAt});
   }
  }
  return result.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,40);
 }
 function projectDreams(input){
  const unavailable={available:false,items:[]};
  const owner=input?.source==='xinchao_owner_dream_projection'&&input.audience==='authenticated_owner';
  if(!input||(!owner&&input.source!=='xinchao_shared_dream_projection')||input.available!==true||!validAt(input.observedAt)||!Array.isArray(input.items))return unavailable;
  const items=[],seen=new Set(),text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;
  for(const d of input.items.slice(0,80)){
   if(!d||d.visibility!==(owner?'owner':'shared')||typeof d.id!=='string'||!d.id.trim()||d.id.length>120||seen.has(d.id)||!validAt(d.createdAt))continue;
   const dream=text(d.dream,4000),summary=text(d.summary,600),residue=text(d.residue,1200);
   if(!dream&&!summary&&!residue)continue;
   seen.add(d.id);items.push({id:d.id,at:d.createdAt,title:text(d.title,80),dream,summary,residue,origin:['model','rules'].includes(d.source)?d.source:'unknown'});
  }
  return {available:true,items:items.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20)};
 }
 function create({loadSnapshot,loadNotes,loadDreams,preview=false}={}){
  const doc=document,uid='inner-tide-'+(++serial),el=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const svg=(tag,attrs={})=>{const node=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
  const dialog=el('dialog','inner-tide');dialog.id=uid;dialog.setAttribute('aria-labelledby',uid+'-title');
  dialog.innerHTML=`<div class="tide-scroll"><div class="tide-layout"><header class="tide-header"><button type="button" class="tide-back" aria-label="返回聊天"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg><span>聊天</span></button><span class="tide-header-title">知微 · 心事</span><div class="tide-avatar" aria-hidden="true"></div></header><div class="tide-heading"><p class="tide-handwriting">a little closer</p><div class="tide-title-row"><h1 id="${uid}-title">知微的心事<span class="tide-title-star" aria-hidden="true">✧</span></h1><span class="tide-status"></span></div><p class="tide-intro">属于知微，也与你有关。</p></div><div class="tide-tabs" role="group" aria-label="心潮页面导航"><button type="button" data-section="now" aria-pressed="true">靠近一点</button><button type="button" data-section="flow" aria-pressed="false">心绪信笺</button><button type="button" data-section="rhythm" aria-pressed="false">潮汐变化</button><button type="button" data-section="dreams" aria-pressed="false">梦境</button></div><section class="tide-now" data-tide-section="now"><div class="tide-card tide-spectrum" data-bloom="closed"><div class="tide-spectrum-heading"><span class="tide-flower-ornament" aria-hidden="true">❧</span><p>轻一点，心绪会开花。</p><span class="tide-dimension-count"></span></div><div class="tide-bloom-stage"><div class="tide-flower-halo" aria-hidden="true"></div><div class="tide-flower"></div><button type="button" class="tide-bloom-button" aria-expanded="false" aria-label="展开心绪花朵"><span class="tide-bloom-monogram" aria-hidden="true">微</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20S3 14.2 3 8.4C3 3.6 9 2.6 12 7c3-4.4 9-3.4 9 1.4C21 14.2 12 20 12 20Z"/></svg></button><span class="tide-bloom-whisper" aria-hidden="true">for your eyes</span></div><p class="tide-bloom-hint" aria-live="polite">轻触花心，靠近一点</p><div class="tide-selected" aria-live="polite" hidden></div><details class="tide-measure-note"><summary>关于这些心绪</summary><p>花瓣对应现有驱动力；各维度独立计量，不相加成 100%。画面不是新的心理指标。</p></details></div><div class="tide-current tide-card"><span class="tide-quote-mark" aria-hidden="true">“</span><div class="tide-letter-heading"><span class="tide-letter-seal" aria-hidden="true">♡</span><p class="tide-eyebrow">最近，留在心里的话</p></div><p class="tide-current-copy"></p><span class="tide-current-source"></span><button type="button" class="tide-read-letter">到信笺里，读完这段话 <span aria-hidden="true">↗</span></button></div><section class="tide-tensions"><div class="tide-section-head"><div><p class="tide-eyebrow">TWO FEELINGS, ONE HEART</p><h2>内在张力</h2></div><span class="tide-section-aside">允许同时存在</span></div><div class="tide-pairs"></div><p class="tide-footnote">两侧保留各自强度，仅作并列对照。</p></section></section><section class="tide-flow" data-tide-section="flow"><div class="tide-section-head"><div><p class="tide-eyebrow">LETTERS FROM WITHIN</p><h2>心绪，写成了信</h2></div><span class="tide-flow-count"></span></div><div class="tide-flow-list"></div><p class="tide-footnote">只收录知微已在聊天中公开的角色独白。<br>没有表达的时刻，留白也是一种状态。</p></section><section class="tide-rhythm tide-card" data-tide-section="rhythm"><div class="tide-section-head"><div><p class="tide-eyebrow">EBB &amp; FLOW</p><h2>心绪也有潮汐</h2></div><span class="tide-rhythm-symbol" aria-hidden="true">∿</span></div><div class="tide-chart"></div></section><section class="tide-dreams" data-tide-section="dreams" aria-label="知微的梦境" hidden><div class="tide-dream-sky" aria-hidden="true"><svg viewBox="0 0 360 235"><defs><radialGradient id="${uid}-moon-glow"><stop offset="0" stop-color="var(--tide-dream-moon)" stop-opacity=".25"/><stop offset="1" stop-color="var(--tide-dream-moon)" stop-opacity="0"/></radialGradient><mask id="${uid}-moon-mask"><rect width="360" height="235" fill="white"/><circle cx="204" cy="59" r="30" fill="black"/></mask></defs><circle cx="181" cy="73" r="79" fill="url(#${uid}-moon-glow)"/><circle cx="181" cy="73" r="32" fill="var(--tide-dream-moon)" mask="url(#${uid}-moon-mask)"/><g class="tide-dream-stars"><path d="M89 55v10m-5-5h10M266 89v8m-4-4h8M124 118v6m-3-3h6"/><circle cx="249" cy="40" r="1"/><circle cx="69" cy="112" r="1.2"/><circle cx="289" cy="137" r="1"/><circle cx="144" cy="31" r="1"/></g><path class="tide-dream-horizon" d="M13 181Q75 153 138 178T272 175T347 178M45 197Q108 174 178 194T315 192M101 213Q176 196 258 212"/><g class="tide-dream-reflection"><path d="M167 158h28m-34 9h39m-30 10h21m-36 11h46"/></g></svg><span class="tide-dream-sky-caption">somewhere, in a dream</span></div><div class="tide-dream-intro"><p class="tide-eyebrow">THE NIGHT LEAVES A TRACE</p><h2>梦醒了，<br>有些片刻还在。</h2><p>梦里的故事，留在梦里。<br>愿意分享的部分，收在这里。</p><span class="tide-dream-disclaimer">梦境记录 · 非现实事件</span></div><div class="tide-dream-list"></div><p class="tide-dream-data-note"></p></section><footer class="tide-footer"><span class="tide-small-flower" aria-hidden="true">✳</span><p>不必把每一种心绪，都解释清楚。</p><button type="button" class="tide-return">回到我们的话里 <span aria-hidden="true">↗</span></button><button type="button" class="tide-refresh">刷新公开记录</button><p class="tide-load-status" role="status"></p></footer></div></div>`;
  doc.body.append(dialog);const $=s=>dialog.querySelector(s),scroll=$('.tide-scroll');dialog.prepend($('.tide-header'));if(preview)$('.tide-header-title').textContent='心事 · 设计示例';$('#'+uid+'-title').tabIndex=-1;$('.tide-footer').append($('.tide-measure-note'));const flowerBox=$('.tide-flower'),bloomButton=$('.tide-bloom-button');flowerBox.id=uid+'-flower';bloomButton.setAttribute('aria-controls',flowerBox.id);$('.tide-bloom-stage').insertBefore(bloomButton,flowerBox);let epoch=0,abort=null,lastFocus=null,pushed=false,boundAvatar=null,selected=null,bloom=false,current=null,notes=[],dreams={available:false,items:[]};
  const time=at=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Bangkok',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
  function renderFlower(){
   const box=$('.tide-flower');box.replaceChildren();const chart=svg('svg',{viewBox:'0 0 400 400',role:'group','aria-label':'知微的心绪花朵'}),defs=svg('defs');
   const gradient=svg('linearGradient',{id:uid+'-petal',x1:'0%',y1:'100%',x2:'80%',y2:'0%'});
   gradient.append(svg('stop',{offset:'0%','stop-color':'var(--tide-rose-base)'}),svg('stop',{offset:'48%','stop-color':'var(--tide-rose-middle)'}),svg('stop',{offset:'100%','stop-color':'var(--tide-rose-tip)'}));
   const shine=svg('linearGradient',{id:uid+'-shine',x1:'0%',y1:'100%',x2:'100%',y2:'0%'});shine.append(svg('stop',{offset:'0%','stop-color':'var(--tide-rose-shine)','stop-opacity':0}),svg('stop',{offset:'100%','stop-color':'var(--tide-rose-shine)','stop-opacity':.7}));defs.append(gradient,shine);chart.append(defs);
   const orbit=svg('g',{class:'tide-orbits','aria-hidden':true});orbit.append(svg('circle',{cx:200,cy:200,r:143,class:'tide-orbit'}),svg('ellipse',{cx:200,cy:200,rx:165,ry:139,transform:'rotate(-28 200 200)',class:'tide-orbit tide-orbit-tilted'}));
   for(const [x,y,r]of [[66,112,2],[315,93,1.5],[327,284,2],[89,307,1.5],[196,39,1]])orbit.append(svg('circle',{cx:x,cy:y,r,class:'tide-stardust'}));chart.append(orbit);
   const values=new Map(current?.drives.map(d=>[d.key,d.value])||[]);$('.tide-dimension-count').textContent=current?.drives.length?current.drives.length+' 片花瓣':'待同步';
   dimensions.forEach(([key,label],i)=>{
    const value=values.get(key),angle=2*Math.PI*i/dimensions.length-Math.PI/2,length=value===undefined?120:108+value*38;
    const group=svg('g',{role:'button',tabindex:bloom?0:-1,'aria-label':label+'，'+(value===undefined?'暂无数据':Math.round(value*100)+'%'),'aria-pressed':'false','aria-expanded':'false','aria-controls':uid+'-selected',class:'tide-petal'+(value===undefined?' tide-petal-empty':''),'data-drive':key});
    const rotated=svg('g',{transform:`translate(200 200) rotate(${i*360/dimensions.length})`}),body=svg('g',{class:'tide-petal-body'});
    const shape=`M0 -21 C-14 -25 -37 -58 -32 ${-length+29} C-29 ${-length-5} -9 ${-length-10} 5 ${-length} C35 ${-length+15} 40 -64 15 -32 C9 -23 3 -20 0 -21Z`;
    const petal=svg('path',{d:shape,fill:'url(#'+uid+'-petal)',class:'tide-petal-satin'}),fold=svg('path',{d:`M0 -23 C-3 -58 -13 ${-length+25} 5 ${-length}`,class:'tide-petal-vein'}),highlight=svg('path',{d:`M5 ${-length+4} C25 ${-length+18} 28 -73 14 -41 C25 -75 15 ${-length+25} 5 ${-length+4}Z`,fill:'url(#'+uid+'-shine)',class:'tide-petal-sheen'});
    const touch=parseFloat(getComputedStyle(dialog).getPropertyValue('--tide-touch'))||44,hit=svg('circle',{cx:0,cy:-95,r:Math.max(22,touch*200/(box.clientWidth||400)),fill:'transparent',class:'tide-petal-hit'});
    body.append(hit,petal,fold,highlight);rotated.append(body);const labelNode=svg('text',{x:200+175*Math.cos(angle),y:200+175*Math.sin(angle),'text-anchor':'middle','dominant-baseline':'central',class:'tide-petal-name'});labelNode.textContent=label;
    const choose=(event)=>{event?.stopPropagation();if(!bloom)bloom=true;selected=selected===key?null:key;updateBloom();renderSelected();};group.addEventListener('click',choose);group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(e);}});group.append(rotated,labelNode);chart.append(group);
   });chart.addEventListener('click',event=>{const rect=chart.getBoundingClientRect(),x=(event.clientX-rect.left)*400/rect.width-200,y=(event.clientY-rect.top)*400/rect.height-200,r=Math.hypot(x,y);if(r>190||r<35)return;if(!bloom){bloom=true;selected=null;}else{const angle=(Math.atan2(y,x)+Math.PI/2+Math.PI*2)%(Math.PI*2),key=dimensions[Math.round(angle*dimensions.length/(Math.PI*2))%dimensions.length][0];selected=selected===key?null:key;}updateBloom();renderSelected();});box.append(chart);updateBloom();
  }
  function updateBloom(){
   $('.tide-spectrum').dataset.bloom=bloom?'open':'closed';$('.tide-spectrum').dataset.selected=selected||'';
   const button=$('.tide-bloom-button');button.setAttribute('aria-expanded',String(bloom));button.setAttribute('aria-label',bloom?'收拢心绪花朵':'展开心绪花朵');
   for(const petal of dialog.querySelectorAll('.tide-petal')){const active=bloom&&selected===petal.dataset.drive;petal.setAttribute('aria-pressed',String(active));petal.setAttribute('aria-expanded',String(active));petal.tabIndex=bloom?0:-1;petal.setAttribute('aria-hidden',String(!bloom));}
   $('.tide-bloom-hint').textContent=bloom?(selected?'再碰一下，收好这一点心绪':'轻触一片花瓣，看看它的心绪'):'轻触花心，靠近一点';
   $('.tide-selected').hidden=!bloom||!selected;
  }
  function renderSelected(){
   const target=$('.tide-selected');target.id=uid+'-selected';target.replaceChildren();if(!selected||!bloom){target.hidden=true;return;}target.hidden=false;const key=selected,dimension=dimensions.find(d=>d[0]===key),value=current?.drives.find(d=>d.key===key)?.value;
   const heading=el('div','tide-selected-heading');heading.append(el('strong','',dimension[1]),el('span','tide-selected-value',value===undefined?'—':Math.round(value*100)+'%'));target.append(heading,el('p','',value===undefined?'等这一股心绪有了可展示的数据，再慢慢告诉你。':dimension[2]));
  }
  function renderPairs(){
   const host=$('.tide-pairs');host.replaceChildren();const values=new Map(current?.drives.map(d=>[d.key,d.value])||[]);
   for(const [left,right,title]of [['possess','duty','靠近，与投入'],['share','reflection','说给你听，也留给自己'],['libido','monitor','渴望，也牵挂']]){
    const row=el('article','tide-pair'),labels=el('div','tide-pair-labels'),a=dimensions.find(d=>d[0]===left),b=dimensions.find(d=>d[0]===right);row.append(el('h3','',title));
    for(const d of [a,b]){const side=el('span');side.append(el('span','',d[1]),el('strong','',values.has(d[0])?Math.round(values.get(d[0])*100)+'%':'—'));labels.append(side);}
    const tracks=el('div','tide-pair-tracks');for(const key of [left,right]){const track=el('div','tide-pair-track'),fill=el('span');fill.style.width=(values.has(key)?values.get(key)*100:0)+'%';track.append(fill);tracks.append(track);}row.append(labels,tracks);host.append(row);
   }
  }
  function returnToMessage(id){close();setTimeout(()=>{const message=doc.querySelector('#chatMessages [data-id="'+CSS.escape(id)+'"]');message?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},0);}
  function renderFlow(){
   const host=$('.tide-flow-list');host.replaceChildren();$('.tide-flow-count').textContent=notes.length?notes.length+' 段公开表达':'';
   for(const note of notes){const item=el('article','tide-flow-item'),at=el('time','tide-flow-time',time(note.at));at.dateTime=note.at;const body=el('div','tide-flow-body'),link=el('button','tide-note-link','来自聊天 · 角色内心独白 ↗');link.type='button';link.addEventListener('click',()=>returnToMessage(note.messageId));body.append(el('p','',note.text),link);item.append(at,body);host.append(item);}
   if(!notes.length)host.append(el('div','tide-empty','这里还没有公开的心绪记录。等知微愿意说时，再留在这里。'));
   $('.tide-current-copy').textContent=notes[0]?.text||'还没有可展示的公开独白。';$('.tide-read-letter').hidden=!notes.length;$('.tide-current-source').textContent=notes[0]?'最近一次公开表达 · '+time(notes[0].at):'尚无公开独白，不代替知微编写';
  }
  function renderDreams(){
   const host=$('.tide-dream-list');host.replaceChildren();
   for(const dream of dreams.items){
    const card=el('article','tide-dream-card'),meta=el('div','tide-dream-meta'),date=el('time','',time(dream.at));date.dateTime=dream.at;meta.append(date,el('span','',preview?'梦境 · 示例':'心潮梦境 · 仅你可见'));
    card.append(meta,el('h3','',dream.title||'这一场梦'));
    if(dream.summary)card.append(el('p','tide-dream-summary',dream.summary));
    if(dream.dream){const detail=el('details','tide-dream-story'),heading=el('summary','','打开这一场梦'),body=el('p','',dream.dream);detail.append(heading,body);detail.addEventListener('toggle',()=>{heading.textContent=detail.open?'把这场梦轻轻收好':'打开这一场梦';});card.append(detail);}
    if(dream.residue){const residue=el('div','tide-dream-residue');residue.append(el('span','','醒后的余韵'),el('p','',dream.residue));card.append(residue);}
    const origin=dream.origin==='model'?'模型生成的梦境文本':dream.origin==='rules'?'规则生成的梦境记录':'生成来源待核实';card.append(el('p','tide-dream-origin',preview?'界面合成示例，并非知微的真实梦境':origin+' · 不是现实经历'));host.append(card);
   }
   if(!dreams.items.length){const empty=el('div','tide-dream-empty');empty.append(el('span','','☾'),el('h3','',dreams.available?'今夜，先留一片空白':'等梦境，慢慢抵达'),el('p','',dreams.available?'还没有愿意共享的梦境。这里不会补写或猜测。':'暂时读不到心潮梦境记录，可以稍后刷新。'));host.append(empty);}
   $('.tide-dream-data-note').textContent=preview?'此页为设计示例，未读取真实梦境。':'梦境来自心潮原有记录，仅登录后可见；不读取黑匣子、内部觉察或记忆桶。';
  }
  function showSection(name,{scrollTo=true}={}){
   const dreaming=name==='dreams';dialog.dataset.scene=dreaming?'dreams':'day';
   for(const tab of dialog.querySelectorAll('[data-section]'))tab.setAttribute('aria-pressed',String(tab.dataset.section===name));
   for(const section of dialog.querySelectorAll('[data-tide-section]'))section.hidden=dreaming?section.dataset.tideSection!=='dreams':section.dataset.tideSection==='dreams';
   $('#'+uid+'-title').firstChild.nodeValue=dreaming?'知微的梦境':'知微的心事';$('.tide-handwriting').textContent=dreaming?'meet me in a dream':'a little closer';$('.tide-intro').textContent=dreaming?'梦里的片段，与醒来的余韵。':'属于知微，也与你有关。';
   if(scrollTo){if(dreaming)scroll.scrollTo({top:0,behavior:'instant'});else $('[data-tide-section="'+name+'"]').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  }
  function renderTrend(){
   const host=$('.tide-chart');host.replaceChildren();const points=current?.trend||[];
   if(points.length<2){host.append(el('div','tide-trend-empty','∿'),el('p','tide-empty','还没有可展示的情绪变化记录。'));return;}
   const start=Date.parse(points[0].at),end=Date.parse(points.at(-1).at);if(end<=start){host.append(el('p','tide-empty','需要不同时间的样本，才能画出潮汐。'));return;}
   const chart=svg('svg',{viewBox:'0 0 320 120',role:'img','aria-label':'已提供情绪样本的变化曲线，不代表连续监测'});const coords=points.map(p=>[8+304*(Date.parse(p.at)-start)/(end-start),60-p.valence*38]),path=coords.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(' ');
   chart.append(svg('path',{d:'M8 60H312',class:'tide-chart-midline'}),svg('path',{d:path+' L312 112 L8 112 Z',class:'tide-chart-area'}),svg('path',{d:path,class:'tide-chart-line'}));host.append(chart);const range=el('div','tide-chart-range');range.append(el('span','',time(points[0].at)),el('span','',time(points.at(-1).at)));host.append(range,el('p','tide-footnote','已提供样本连线，非连续监测。'));const history=el('details','tide-emotion-history'),heading=el('summary','',points.length+' 条'+(preview?'示例':'真实')+'情绪记录'),list=el('ol','tide-emotion-events');for(const p of [...points].reverse()){const item=el('li'),stamp=el('time','',time(p.at));stamp.dateTime=p.at;item.append(stamp,el('span','',p.label||'情绪样本'));list.append(item);}history.append(heading,list);host.append(history);
  }
  function render(){
   $('.tide-status').textContent=preview?'设计预览 · 示例':current?(Date.now()-Date.parse(current.observedAt)>900000?'历史快照':'已同步'):'等待心潮同步';
   $('.tide-status').dataset.mode=preview?'preview':current?'snapshot':'empty';renderFlower();renderSelected();renderPairs();renderFlow();renderTrend();renderDreams();if(dialog.dataset.scene!=='dreams')$('.tide-intro').textContent=current?.emotion?'此刻心绪：'+current.emotion:'属于知微，也与你有关。';
  }
  async function readProjection(kind,signal){const response=await fetch('/api/inner-tide/'+kind,{credentials:'same-origin',cache:'no-store',signal});if(response.status===401){doc.dispatchEvent(new Event('ziwei-session-expired'));throw Error('auth');}if(!response.ok)throw Error('unavailable');return response.json();}
  async function readNotes(signal){const response=await fetch('/api/inner-tide/notes',{credentials:'same-origin',cache:'no-store',signal});if(response.status===401){doc.dispatchEvent(new Event('ziwei-session-expired'));throw Error('auth');}if(!response.ok)throw Error('unavailable');const body=await response.json();return body.data;}
  async function load(){
   const token=++epoch;abort?.abort();abort=new AbortController();$('.tide-refresh').disabled=true;$('.tide-load-status').textContent='正在读取公开记录…';
   const results=await Promise.allSettled([(loadSnapshot||(s=>readProjection('snapshot',s)))(abort.signal),(loadNotes||readNotes)(abort.signal),(loadDreams||(s=>readProjection('dreams',s)))(abort.signal)]);if(token!==epoch||!dialog.open)return;
   current=results[0].status==='fulfilled'?projectSnapshot(results[0].value):null;notes=results[1].status==='fulfilled'?projectNotes(results[1].value):[];dreams=results[2].status==='fulfilled'?projectDreams(results[2].value):{available:false,items:[]};render();$('.tide-refresh').disabled=false;
   $('.tide-load-status').textContent=results.some(r=>r.status==='rejected')?'部分记录暂时读不到，可以稍后刷新。':current?'快照更新于 '+time(current.observedAt):'聊天独白已读取，心潮数值暂未接入。';
  }
  function open(){if(dialog.open)return;lastFocus=doc.activeElement;const avatar=$('.tide-avatar');avatar.replaceChildren();const source=boundAvatar?.querySelector('img'),monogram=$('.tide-bloom-monogram');monogram.replaceChildren();if(source){const img=source.cloneNode();img.alt='';avatar.append(img);const portrait=source.cloneNode();portrait.alt='';monogram.append(portrait);}else{avatar.append(el('span','','微'));monogram.textContent='微';}bloom=false;selected=null;showSection('now',{scrollTo:false});dialog.showModal();$('#'+uid+'-title').focus({preventScroll:true});scroll.scrollTop=0;render();try{history.pushState({...history.state,ziweiInnerTide:uid},'');pushed=true;}catch{}void load();}
  function close({back=true,focus=true}={}){if(!dialog.open)return;epoch++;abort?.abort();dialog.close();if(back&&pushed&&history.state?.ziweiInnerTide===uid)history.back();pushed=false;if(focus&&lastFocus?.isConnected&&!lastFocus.hidden)lastFocus.focus({preventScroll:true});}
  function reset(){close({focus:false});current=null;notes=[];dreams={available:false,items:[]};selected=null;bloom=false;showSection('now',{scrollTo:false});render();$('.tide-load-status').textContent='';$('.tide-avatar').replaceChildren();$('.tide-bloom-monogram').replaceChildren();}
  function bindAvatar(avatar){boundAvatar=avatar;if(!avatar)return;avatar.setAttribute('role','button');avatar.tabIndex=0;avatar.setAttribute('aria-label','查看知微的心潮');avatar.setAttribute('aria-haspopup','dialog');avatar.setAttribute('aria-controls',uid);avatar.addEventListener('click',open);avatar.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});}
  $('.tide-bloom-button').addEventListener('click',()=>{bloom=!bloom;selected=null;updateBloom();renderSelected();});
  $('.tide-read-letter').addEventListener('click',()=>dialog.querySelector('[data-section=flow]').click());
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});$('.tide-back').addEventListener('click',()=>close());$('.tide-return').addEventListener('click',()=>close());$('.tide-refresh').addEventListener('click',()=>void load());
  window.addEventListener('popstate',()=>{if(dialog.open&&history.state?.ziweiInnerTide!==uid)close({back:false});});
  setInterval(()=>{if(dialog.open&&doc.visibilityState==='visible'&&!$('.tide-refresh').disabled)void load();},30000);
  let flowerWidth=0;new ResizeObserver(()=>{const width=$('.tide-flower').clientWidth;if(dialog.open&&width!==flowerWidth){flowerWidth=width;renderFlower();}}).observe($('.tide-flower'));
  for(const tab of dialog.querySelectorAll('[data-section]'))tab.addEventListener('click',()=>showSection(tab.dataset.section));
  render();return {open,close,reset,bindAvatar};
 }
 return {dimensions,projectSnapshot,projectNotes,projectDreams,create};
});
