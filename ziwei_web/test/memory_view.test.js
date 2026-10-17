'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {memoryView}=require('../memory_view');
test('four presentation groups preserve native entries, source and protection without editing input',()=>{
 const native={files:[{name:'USER.md',updated_at:1700000000,entries:[{index:0,heading:'她的资料',text:'喜欢哲学。'}]},{name:'MEMORY.md',protected_entries:[1],entries:[{index:0,heading:'我的身份',text:'我是知微。'},{index:1,heading:'共同约定',text:'后端保护的原文。'},{index:2,heading:'代码部署',text:'仓库与项目记录。'},{index:3,heading:'一段未标注的经历',text:'未分类原文。'}]}],protected_files:['SOUL.md','care_rules'],errors:[]};
 const before=JSON.stringify(native),view=memoryView(native);
 assert.equal(JSON.stringify(native),before);assert.deepEqual(view.counts,{user:1,self:1,protected:1,work:1,uncategorized:1});
 assert.equal(view.rows.find(r=>r.categories.includes('protected')).protected,true);
 assert.equal(view.rows.find(r=>r.categories.includes('work')).content,'仓库与项目记录。');
 assert.deepEqual(view.protectedSources,['SOUL.md','care_rules']);assert.equal(view.rows.length,5);
});
test('generic MEMORY is not mislabeled as protected or self, and explicit categories override heading guesses',()=>{
 const view=memoryView({files:[{name:'MEMORY.md',entries:[{text:'普通原生记忆。',heading:'原生长期记忆'},{text:'主题明确但按后台分类。',heading:'代码相关的自我认识',category:'about_ziwei'},{text:'有长期分类但没有保护标记。',heading:'一条记忆',category:'long_term'}]}]});
 assert.deepEqual(view.rows[0].categories,['uncategorized']);assert.deepEqual(view.rows[1].categories,['self']);assert.equal(view.rows[2].protected,false);assert.ok(view.rows[2].categories.includes('protected'));
});
test('protected self/work records appear in both relevant views and duplicate file entry indices do not rewrite content',()=>{
 const view=memoryView({files:[{name:'SELF.md',category:'self',protected:true,entries:[{index:0,text:'身份原文',heading:'自我'}]},{name:'WORK.md',category:'work',entries:[{index:0,text:'代码原文',heading:'工作',protected:true}]}]});
 assert.deepEqual(view.rows[0].categories,['self','protected']);assert.deepEqual(view.rows[1].categories,['work','protected']);assert.equal(new Set(view.rows.map(r=>r.id)).size,2);assert.equal(view.counts.protected,2);
});
