'use strict';
// Run: node --test ziwei_web/tests/work-phase1.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const publicDir=path.resolve(__dirname,'../public');
const read=name=>fs.readFileSync(path.join(publicDir,name),'utf8');
test('Work has its own panel and sixth tab without replacing private chat',()=>{
 const html=read('index.html');
 for(const id of ['chat','moments','home','memory','logs','work'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.equal((html.match(/data-tab="/g)||[]).length,6);
 assert.match(html,/data-tab="work"/);
 assert.match(html,/src="\/work\.js"/);
 assert.match(html,/href="\/work\.css"/);
});
test('Work controls are present and never silently submit to private chat',()=>{
 const html=read('index.html'),js=read('work.js');
 for(const id of ['workInput','workStatus','workMode','workForm','workVoice','workAttach'])assert.match(html,new RegExp('id="'+id+'"'));
 for(const tool of ['auto','ppt','word','pdf','excel','image','research'])assert.match(html,new RegExp('data-work-tool="'+tool+'"'));
 for(const person of ['知微','白鸦'])assert.ok(html.includes('data-work-mention="'+person+'"'));
 assert.match(js,/preventDefault\(\)/);
 assert.doesNotMatch(js,/fetch\s*\(|\/api\/chat|\/api\/message/);
});
test('Six-column navigation and scoped variable-based styling',()=>{
 const css=read('work.css');
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/--work-gap:/);
 assert.match(css,/--work-radius:/);
});
