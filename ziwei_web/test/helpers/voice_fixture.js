'use strict';
// Explicit protocol fixture, never a production speech recognizer.
const b=require('node:fs').readFileSync(process.argv[2]);if(b.length<44){process.stdout.write(JSON.stringify({error:'voice_transcription_failed'}));process.exitCode=1;}else process.stdout.write(JSON.stringify({text:'fixture spoken 427'}));
