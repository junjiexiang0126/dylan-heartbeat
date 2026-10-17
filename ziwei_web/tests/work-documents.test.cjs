'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{documentBytes}=require('../work_documents');
const JSZip=require('jszip'),ExcelJS=require('exceljs');
test('DOCX and PPTX are valid ZIP documents containing the requested Chinese text',async()=>{for(const [kind,entry] of [['word','word/document.xml'],['ppt','ppt/slides/slide1.xml']]){const b=await documentBytes(kind,'教学计划','第一节 中文\n\n第二节 汉字');const zip=await JSZip.loadAsync(b);const xml=await zip.file(entry).async('string');assert.ok(xml.includes('第一节 中文'));assert.ok(zip.file('[Content_Types].xml'));}});
test('Excel stores formula-like user strings as text and preserves table cells',async()=>{const b=await documentBytes('excel','练习表','姓名 | 分数\n=HYPERLINK("http://example.com") | 二十');const book=new ExcelJS.Workbook();await book.xlsx.load(b);const sheet=book.worksheets[0];assert.equal(sheet.getCell('A3').type,ExcelJS.ValueType.String);assert.equal(sheet.getCell('B3').value,'二十');});
test('PDF is a real PDF with embedded CJK font',async()=>{const b=await documentBytes('pdf','课程计划','中文加减法\n十加二等于十二');assert.equal(b.subarray(0,5).toString(),'%PDF-');assert.ok(b.includes(Buffer.from('/FontDescriptor')));});
test('30-page Chinese courseware preserves every requested slide and final content',async()=>{
 const text=Array.from({length:30},(_,i)=>'## 第'+(i+1)+'页 课堂活动\n学习目标、活动步骤和课堂练习。\n\n教师提示：请学生轮流完成。').join('\n\n');
 const bytes=await documentBytes('ppt','完整课件',text),zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
 const slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));assert.equal(slides.length,30);assert.match(await zip.file('ppt/slides/slide30.xml').async('string'),/第30页/);
});
