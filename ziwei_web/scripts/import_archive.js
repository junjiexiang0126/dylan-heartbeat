'use strict';
// Offline, explicit archive import. No native session or memory writes.
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {ChatStore,hash}=require('../chat_store'),{HermesClient}=require('../hermes_client');
const {checkedDirectory}=require('../data_directory');
const [input,directory]=process.argv.slice(2);if(!input||!directory)throw Error('Usage: node scripts/import_archive.js PRIVATE_ARCHIVE.json WEB_DATA_DIR');
const dir=checkedDirectory(directory);
const lock=path.join(dir,'server.lock');if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));try{process.kill(pid,0);throw Error('Stop the Web server before archive import');}catch(e){if(e.code!=='ESRCH')throw e;}}
const dbpath=path.join(dir,'chat.sqlite');let scope;
if(fs.existsSync(dbpath)){const db=new DatabaseSync(dbpath,{readOnly:true});scope=db.prepare("SELECT value FROM meta WHERE key='scope'").get().value;db.close();}
else{const c=new HermesClient();scope=hash(c.base+'|'+c.session+'|'+c.key);}
const document=JSON.parse(fs.readFileSync(input,'utf8'));if(document.authority!=='query_archive_only_not_long_term_memory')throw Error('Archive authority declaration required');
const store=new ChatStore(dir,scope);try{const result=store.importArchive(document,document.label);console.log(JSON.stringify({source:document.label,sha256:document.sha256,...result}));}finally{store.close();}
