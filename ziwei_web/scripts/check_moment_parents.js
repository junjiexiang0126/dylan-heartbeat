'use strict';
// Read-only production diagnostic. No message text, images or memory are read.
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs');
const [file,...prefixes]=process.argv.slice(2);
if(!file||!prefixes.length||prefixes.some(x=>!/^([a-f0-9]{8}|[a-f0-9]{8}-[a-f0-9-]{27})$/i.test(x))){console.error('Usage: node scripts/check_moment_parents.js /absolute/path/moments.sqlite <8-hex-prefix-or-UUID> ...');process.exit(2);}
if(!file.startsWith('/')||!fs.existsSync(file)){console.error('Existing absolute database path required. No database was created.');process.exit(2);}
const db=new DatabaseSync(file,{readOnly:true});
try{for(const prefix of prefixes){const rows=db.prepare("SELECT 'post' AS type,id,deleted,NULL AS post_id FROM posts WHERE lower(id) LIKE lower(?) UNION ALL SELECT 'comment' AS type,id,deleted,post_id FROM comments WHERE lower(id) LIKE lower(?)").all(prefix+'%',prefix+'%');console.log(JSON.stringify({prefix,present:rows.length>0,matches:rows}));}}finally{db.close();}
