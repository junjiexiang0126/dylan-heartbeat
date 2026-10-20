'use strict';
// Isolated, dependency-free call lifecycle. No microphone, network or API calls occur here.
// Transport adapters may call these methods after verifying the authenticated call session.
class RealtimeCallSession {
  constructor({onEvent=()=>{}, onCancel=()=>{}}={}) {
    this.onEvent=onEvent; this.onCancel=onCancel;
    this.phase='idle'; this.muted=false; this.closed=false; this.turn=0; this.generation=0;
  }
  emit(type, detail={}) { this.onEvent({type, phase:this.phase, muted:this.muted, generation:this.generation, ...detail}); }
  start() {
    if(this.closed||this.phase!=='idle') return false;
    this.phase='listening'; this.emit('call.started'); return true;
  }
  setMuted(value) {
    if(this.closed||this.phase==='idle') return false;
    this.muted=Boolean(value);
    // Invalidate any pending speech collection. The transport must stop the mic track
    // and abort its ASR upload; this module never submits audio on its own.
    if(this.muted) { if(this.phase==='user-speaking') { this.generation++; this.phase='listening'; } this.onCancel('asr'); }
    this.emit(this.muted?'microphone.muted':'microphone.unmuted');
    return true;
  }
  beginSpeech() {
    if(this.closed||this.muted||this.phase==='idle') return null;
    if(this.phase==='speaking'||this.phase==='thinking') {
      this.generation++; this.onCancel('tts'); this.onCancel('llm');
      this.phase='listening'; this.emit('assistant.interrupted');
    }
    this.phase='user-speaking'; this.emit('user.speech.started');
    return this.generation;
  }
  finishSpeech(token, audioPresent) {
    if(this.closed||this.muted||this.phase!=='user-speaking'||token!==this.generation) return false;
    this.phase='listening';
    if(!audioPresent) { this.emit('user.silence'); return false; }
    this.turn++; this.phase='thinking'; this.emit('user.speech.ready', {turn:this.turn}); return true;
  }
  assistantAudio(token) {
    if(this.closed||this.phase!=='thinking'||token!==this.generation) return false;
    this.phase='speaking'; this.emit('assistant.speaking'); return true;
  }
  assistantDone(token) {
    if(this.closed||token!==this.generation||!['speaking','thinking'].includes(this.phase)) return false;
    this.phase='listening'; this.emit('assistant.done'); return true;
  }
  hangup() {
    if(this.closed) return false;
    this.closed=true; this.generation++; this.onCancel('asr'); this.onCancel('tts'); this.onCancel('llm');
    this.phase='ended'; this.emit('call.ended'); return true;
  }
}
module.exports={RealtimeCallSession};
