'use strict';
// PCM16 LE on the wire; Int16Array inside the process. Never reinterpret compressed bytes.
function decodePCM(bytes) {
 if(bytes.length%2)throw Error('voice_pcm_truncated');
 const pcm=new Int16Array(bytes.length/2);
 for(let i=0;i<pcm.length;i++)pcm[i]=bytes.readInt16LE(i*2);
 return pcm;
}
function wav({pcm,sampleRate,channels}) {
 if(!(pcm instanceof Int16Array)||sampleRate!==16000||channels!==1||!pcm.length||pcm.length>16000*30)throw Error('voice_asr_format');
 const b=Buffer.alloc(44+pcm.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);
 b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);
 for(let i=0;i<pcm.length;i++)b.writeInt16LE(pcm[i],44+i*2);return b;
}
class PcmFrames {
 constructor(samples=320){if(!Number.isInteger(samples)||samples<1)throw Error('voice_frame_size');this.samples=samples;this.tail=new Int16Array(0);}
 push(pcm){
  if(!(pcm instanceof Int16Array)||pcm.length>48000*2)throw Error('voice_pcm_chunk_limit');
  const joined=new Int16Array(this.tail.length+pcm.length);joined.set(this.tail);joined.set(pcm,this.tail.length);
  const frames=[];let i=0;for(;i+this.samples<=joined.length;i+=this.samples)frames.push(joined.slice(i,i+this.samples));
  this.tail=joined.slice(i);return frames;
 }
 flush(){if(!this.tail.length)return [];const frame=new Int16Array(this.samples);frame.set(this.tail);this.reset();return [frame];}
 reset(){this.tail=new Int16Array(0);}
}
module.exports={decodePCM,wav,PcmFrames};
