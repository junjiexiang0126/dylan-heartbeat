import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const license=await readFile(new URL('../raven/THREE-LICENSE.txt',import.meta.url),'utf8');
await build({banner:{js:'/*! Three.js MIT license\n'+license+'*/'},entryPoints:[fileURLToPath(new URL('../raven/raven-view.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../public/raven-view.js',import.meta.url)),bundle:true,format:'esm',minify:true,target:['safari16','chrome110'],legalComments:'eof'});
await build({entryPoints:[fileURLToPath(new URL('../raven/raven-controller.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../public/raven.js',import.meta.url)),bundle:true,format:'iife',minify:true,target:['safari16','chrome110'],external:['/raven-view.js'],legalComments:'eof'});
