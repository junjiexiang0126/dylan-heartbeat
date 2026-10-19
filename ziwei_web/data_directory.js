'use strict';
const fs=require('node:fs'),path=require('node:path');
function canonical(input){let current=path.resolve(input),suffix=[];for(;;){try{return path.join(fs.realpathSync(current),...suffix);}catch(e){if(e.code!=='ENOENT')throw e;suffix.unshift(path.basename(current));const parent=path.dirname(current);if(parent===current)throw e;current=parent;}}}
function checkedDirectory(input,env=process.env){
 const dir=canonical(input),native=env.HERMES_HOME?canonical(env.HERMES_HOME):null;
 if(dir==='/'||dir==='/data'||dir.startsWith('/data/')||native&&(dir===native||dir.startsWith(native+path.sep)))throw Error('Use a separate Web data volume outside the native profile');
 return dir;
}
module.exports={checkedDirectory};
