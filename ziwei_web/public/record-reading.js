'use strict';
// Small DOM-only reading view. Saved text is never interpreted as HTML.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZiweiRecordReading=api;})(typeof window==='object'?window:globalThis,()=>{
 const choices={contact_user:'和你聊了聊',rest:'让自己歇一会儿',self_directed_task:'做了一点自己的事',publish_moment:'留下一条朋友圈',write_diary:'写下今天的一页'};
 const changes={add:'记下一件事',append:'补充了一段记忆',update:'整理了一段记忆',replace:'更新了一段记忆',remove:'放下一段旧记忆',delete:'放下一段旧记忆'};
 function title(row){
  if(row.basis==='agent_briefing'&&Object.hasOwn(choices,row.title))return choices[row.title];
  if(row.basis==='memory_audit'){const op=String(row.title||'').split(/\s*[·:]\s*/)[0];return Object.hasOwn(changes,op)?changes[op]:'整理记忆';}
  return String(row.title||'留下的一页');
 }
 function narrative(value){
  const text=String(value??'');
  if(text.length>200000||!/^\s*\{/.test(text))return text;
  try{const obj=JSON.parse(text);if(!obj||Array.isArray(obj)||typeof obj!=='object')return text;
   const fields=[['did',''],['text',''],['content',''],['body',''],['summary',''],['reflection','想到这里'],['next','接下来']];
   const seen=new Set(),parts=[];
   for(const [key,label] of fields){const v=obj[key];if(typeof v!=='string'||!v.trim()||seen.has(v))continue;seen.add(v);parts.push((label?'### '+label+'\n\n':'')+v.trim());}
   return parts.length?parts.join('\n\n'):text;
  }catch{return text;}
 }
 function preview(value,maximum=180){
  return narrative(value).replace(/^---\s*\n[\s\S]*?\n---\s*\n/,'').replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g,' [代码片段] ').replace(/!\[([^\]]*)\]\([^\n)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^\n)]*\)/g,'$1').replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm,'').replace(/(?:\*\*|__|~~|`)/g,'').replace(/\s+/g,' ').trim().slice(0,maximum);
 }
 function safeURL(value){
  if(/[\u0000-\u0020\u007f]/.test(value))return null;
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
 }
 function inline(node,value,depth=0){
  const d=node.ownerDocument;if(depth>6){node.append(d.createTextNode(value));return;}
  const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|!?(?:\[[^\[\]\n]*\])\([^\s)]*\))/g;
  let offset=0;for(const match of value.matchAll(pattern)){
   node.append(d.createTextNode(value.slice(offset,match.index)));const token=match[0];let child;
   if(token[0]==='`'){child=d.createElement('code');child.textContent=token.slice(1,-1);}
   else if(token.startsWith('**')||token.startsWith('__')){child=d.createElement('strong');inline(child,token.slice(2,-2),depth+1);}
   else if(token.startsWith('~~')){child=d.createElement('s');inline(child,token.slice(2,-2),depth+1);}
   else if(token[0]==='*'){child=d.createElement('em');inline(child,token.slice(1,-1),depth+1);}
   else{const link=/^(!?)\[([^\]]*)\]\((.*)\)$/.exec(token),url=safeURL(link[3]);child=d.createElement(!link[1]&&url?'a':'span');inline(child,link[2]||'图片',depth+1);if(child.tagName==='A'){child.href=url;child.target='_blank';child.rel='noopener noreferrer';child.referrerPolicy='no-referrer';}}
   node.append(child);offset=match.index+token.length;
  }
  node.append(d.createTextNode(value.slice(offset)));
 }
 function code(node,body,language=''){
  const d=node.ownerDocument,box=d.createElement('details'),summary=d.createElement('summary'),pre=d.createElement('pre'),code=d.createElement('code');
  box.className='record-code';summary.textContent='查看'+(/^(?:json|jsonl)$/i.test(language)?'数据':'代码')+(language?' · '+language.slice(0,30):'');code.textContent=body;pre.append(code);box.append(summary,pre);node.append(box);
 }
 function blocks(node,text,depth=0){
  const d=node.ownerDocument,lines=text.replace(/\r\n?/g,'\n').split('\n');let i=0,count=0;
  const special=line=>/^\s*(?:`{3,}|~{3,}|#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s)/.test(line)||/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  while(i<lines.length){
   if(++count>2000||depth>5){code(node,lines.slice(i).join('\n'),'原文');break;}
   const line=lines[i];if(!line.trim()){i++;continue;}
   const fence=/^\s*(`{3,}|~{3,})(.*)$/.exec(line);
   if(fence){const body=[];i++;while(i<lines.length&&!new RegExp('^\\s*'+fence[1][0]+'{'+fence[1].length+',}\\s*$').test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;code(node,body.join('\n'),fence[2].trim());continue;}
   const heading=/^\s*(#{1,6})\s+(.+)$/.exec(line);
   if(heading){const h=d.createElement('h'+Math.min(6,Math.max(3,heading[1].length)));inline(h,heading[2].replace(/\s+#+\s*$/,''));node.append(h);i++;continue;}
   if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){node.append(d.createElement('hr'));i++;continue;}
   if(/^\s*>/.test(line)){const text=[];while(i<lines.length&&/^\s*>/.test(lines[i]))text.push(lines[i++].replace(/^\s*>\s?/,''));const q=d.createElement('blockquote');blocks(q,text.join('\n'),depth+1);node.append(q);continue;}
   const list=/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
   if(list){const ordered=!!list[2],ul=d.createElement(ordered?'ol':'ul');if(ordered)ul.start=Number(list[2]);
    while(i<lines.length){const m=/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[i]);if(!m||!!m[2]!==ordered)break;const li=d.createElement('li');inline(li,m[3].replace(/^\[([ xX])\]\s*/,(_,v)=>v===' '?'☐ ':'☑ '));ul.append(li);i++;}node.append(ul);continue;}
   if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i+1])){
    const table=d.createElement('table'),wrap=d.createElement('div');wrap.className='record-table';let first=true;
    for(;i<lines.length&&lines[i].includes('|');i++){if(/^\s*\|?[\s:|\-]+\|?\s*$/.test(lines[i]))continue;const tr=d.createElement('tr');for(const cell of lines[i].replace(/^\s*\||\|\s*$/g,'').split('|')){const td=d.createElement(first?'th':'td');inline(td,cell.trim());tr.append(td);}table.append(tr);first=false;}wrap.append(table);node.append(wrap);continue;
   }
   const para=[line];i++;while(i<lines.length&&lines[i].trim()&&!special(lines[i])&&!(i+1<lines.length&&/^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i+1])))para.push(lines[i++]);const p=d.createElement('p');inline(p,para.join('\n'));node.append(p);
  }
 }
 function render(node,value){
  node.replaceChildren();node.classList.add('record-reading');const text=narrative(value);
  if(/^\s*[\[{]/.test(text)){try{JSON.parse(text);const p=node.ownerDocument.createElement('p');p.textContent='这一页保存的是数据记录，展开后可以查看。';node.append(p);code(node,text,'json');return;}catch{}}
  blocks(node,text);
 }
 return {render,preview,title,narrative,safeURL};
});
