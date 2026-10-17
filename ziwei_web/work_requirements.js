'use strict';
// A structural check of the user's explicit numeric contract, not a factual review.
function contract(task){
 const pages=/(?:制作|生成|恰好|共|一份)\s*(\d{1,2})\s*页/.exec(task),range=/每页(?:正文)?\s*(\d{1,3})\s*(?:至|到|[-—–~～])\s*(\d{1,3})\s*字/.exec(task);
 if(!pages||!range)return null;
 const count=Number(pages[1]),min=Number(range[1]),max=Number(range[2]);
 return count>=1&&count<=32&&min>=1&&max>=min&&max<=999?{pages:count,min,max,counting:'汉字计数；不计页标题、空白和标点；表格文字计入所在页'}:null;
}
function inspect(task,text){
 const rule=contract(task);if(!rule)return {rule:null,issues:[]};
 const headings=[...text.matchAll(/^#{1,3}\s+第\s*(\d+)\s*页[^\n]*(?:\n|$)/gm)],issues=[];
 if(headings.length!==rule.pages)issues.push({code:'page_count',expected:rule.pages,actual:headings.length});
 if(headings[0]?.index!==0)issues.push({code:'page_prelude'});
 const pages=headings.map((h,i)=>{const n=Number(h[1]),body=text.slice(h.index+h[0].length,headings[i+1]?.index??text.length),chars=[...body.matchAll(/\p{Script=Han}/gu)].length;
  if(n!==i+1)issues.push({code:'page_sequence',position:i+1,actual:n});
  if(chars<rule.min||chars>rule.max)issues.push({code:'page_characters',page:n,actual:chars,min:rule.min,max:rule.max});
  return {page:n,characters:chars};
 });return {rule,pages,issues:issues.slice(0,40)};
}
module.exports={contract,inspect};
