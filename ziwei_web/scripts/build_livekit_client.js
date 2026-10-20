'use strict';
const fs=require('node:fs'),path=require('node:path');
const packageDir=path.dirname(path.dirname(require.resolve('livekit-client')));
const target=path.join(__dirname,'../public/vendor/livekit-client.js');fs.mkdirSync(path.dirname(target),{recursive:true});
fs.copyFileSync(path.join(packageDir,'dist/livekit-client.umd.js'),target);
console.log('Bundled pinned LiveKit browser SDK');
