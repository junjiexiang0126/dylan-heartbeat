'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createHomeStore}=require('../home_store'),{extract}=require('../document_text');
test('anniversary is explicitly confirmed, validated, revision protected and retained after restart',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dates-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const home=createHomeStore(dir);assert.equal(home.read().metOn,null);
 assert.throws(()=>home.update({revision:0,relationship:{metOn:'2026-02-30'}}));assert.throws(()=>home.update({revision:0,relationship:{metOn:'2999-01-01'}}));
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),saved=home.update({revision:0,relationship:{metOn:today}});assert.equal(saved.daysTogether,1);assert.equal(createHomeStore(dir).read().metOn,today);assert.equal(home.update({revision:0,relationship:{metOn:null}}),null);
});
test('document extraction reads real DOCX content and rejects XML entities',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-doc-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const code="import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('word/document.xml',sys.stdin.buffer.read());z.close()";
 const file=path.join(dir,'document.docx');spawnSync('python3',['-c',code,file],{input:'<w:document xmlns:w="urn:test"><w:t>文档提取 ZW-612</w:t></w:document>'});assert.equal((await extract(file,'document.docx')).text,'文档提取 ZW-612');
 spawnSync('python3',['-c',code,file],{input:'<!DOCTYPE doc [<!ENTITY data "expanded">]><doc>&data;</doc>'});assert.equal(await extract(file,'document.docx'),null);
});
