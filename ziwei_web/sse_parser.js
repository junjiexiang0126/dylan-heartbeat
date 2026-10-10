'use strict';
// Streaming SSE parser: handles arbitrary UTF-8 chunk boundaries and multiline data.
class SSEParser{
 constructor(onEvent){this.decoder=new TextDecoder();this.buffer='';this.onEvent=onEvent;this.finished=false}
 feed(chunk){if(this.finished)return;this.buffer+=this.decoder.decode(chunk,{stream:true}).replace(/\r\n/g,'\n');this.consume()}
 consume(){let i;while((i=this.buffer.indexOf('\n\n'))>=0){const frame=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+2);let data=[],event='message';for(const line of frame.split('\n')){if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));else if(line.startsWith('event:'))event=line.slice(6).trim()}if(event==='done'&&!data.length){this.finished=true;this.onEvent({event:'done',data:null});return}if(!data.length)continue;const payload=data.join('\n');if(payload==='[DONE]'){this.finished=true;this.onEvent({event:'done',data:null});return}let value;try{value=JSON.parse(payload)}catch{value=payload}this.onEvent({event,data:value});if(event==='done'){this.finished=true;return}}}
 end(){this.buffer+=this.decoder.decode();this.consume();if(!this.finished)this.onEvent({event:'disconnect',data:null})}
}
module.exports={SSEParser};
