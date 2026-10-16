import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// The viewer accepts an animation name; it cannot publish or modify presence.
export class RavenView{
 constructor(canvas,{onReady=()=>{},onError=()=>{},onInteract=()=>{},reduced=false}={}){
  this.canvas=canvas;this.onReady=onReady;this.onError=onError;this.onInteract=onInteract;this.reduced=reduced;this.disposed=false;this.running=false;this.mode='Idle';this.interaction=null;this.yaw=0;this.returning=false;this.abort=new AbortController();this.time=0;
  try{
   this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.45;
   this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(34,1,.1,40);this.camera.position.set(3.0,2.35,6.2);this.camera.lookAt(0,1.35,0);
   this.scene.add(new THREE.HemisphereLight(0xf3edff,0x68595a,2.0));const key=new THREE.DirectionalLight(0xffeedb,3.1);key.position.set(-3,6,5);this.scene.add(key);const rim=new THREE.DirectionalLight(0xa4adf4,3.0);rim.position.set(4,3,-3);this.scene.add(rim);const fill=new THREE.DirectionalLight(0xc0c9ff,.85);fill.position.set(0,2,6);this.scene.add(fill);
   const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const context=shadowCanvas.getContext('2d'),gradient=context.createRadialGradient(64,64,5,64,64,64);gradient.addColorStop(0,'rgba(45,30,40,.25)');gradient.addColorStop(1,'rgba(45,30,40,0)');context.fillStyle=gradient;context.fillRect(0,0,128,128);this.shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.8,2.2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));this.shadow.rotation.x=-Math.PI/2;this.shadow.position.y=.012;this.scene.add(this.shadow);
   this.pivot=new THREE.Group();this.scene.add(this.pivot);this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
   canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;this.pause();this.onError('3D 暂时不可用，请重新打开。');},{signal:this.abort.signal});
   this.bindInteraction();this.load();
  }catch(e){this.failed=true;this.pause();this.onError('当前设备暂不支持 3D，保留静态渡鸦。');}
 }
 async load(){try{
  const r=await fetch('/models/raven.glb',{signal:this.abort.signal,cache:'force-cache'});if(!r.ok)throw Error('model_load');const buffer=await r.arrayBuffer();if(this.disposed)return;
  const gltf=await new GLTFLoader().parseAsync(buffer,'/models/');if(this.disposed){this.disposeObject(gltf.scene);return;}
  this.model=gltf.scene;this.pivot.add(this.model);this.mixer=new THREE.AnimationMixer(this.model);this.actions=new Map(gltf.animations.map(clip=>[clip.name,this.mixer.clipAction(clip)]));
  this.mixer.addEventListener('finished',e=>{if(e.action===this.oneShot){this.oneShot=null;this.interaction=null;this.onInteract(null);this.playBase();}});
  this.playBase();this.canvas.dataset.ready='true';this.onReady();if(this.running)this.resume();else this.render();
 }catch(e){if(e.name!=='AbortError'&&!this.disposed){this.failed=true;this.pause();this.onError('模型未能载入，点击重试。');}}}
 resize(){if(!this.renderer||this.disposed)return;const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();this.render();}
 playBase(){if(!this.mixer)return;this.model.rotation.y=this.mode==='Stale'?-Math.PI/2:0;this.mixer.stopAllAction();this.oneShot=null;this.base=this.actions.get(this.mode)||this.actions.get('Idle');this.base.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat,Infinity).play();if(this.reduced){this.mixer.update(.02);this.base.paused=true;}this.canvas.dataset.animation=this.mode;this.render();}
 setMode(mode){if(this.mode===mode)return;this.mode=mode;if(this.camera){this.camera.position.y=mode==='Stale'?4.5:2.35;this.camera.lookAt(0,mode==='Stale'?1.0:1.35,0);}if(!this.interaction)this.playBase();this.canvas.dataset.baseAnimation=mode;}
 interact(){if(!this.mixer||this.interaction||this.disposed||this.reduced)return;const name=this.mode==='Stale'?'Poke':'Jump',action=this.actions.get(name);this.mixer.stopAllAction();this.oneShot=action;this.interaction=name;action.reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();this.canvas.dataset.animation=name;this.onInteract(name);}
 bindInteraction(){const c=this.canvas,opts={signal:this.abort.signal};let drag=null;
  c.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:this.yaw,moved:false,horizontal:false};this.returning=false;c.setPointerCapture(e.pointerId);},opts);
  c.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>7){drag.moved=true;drag.horizontal=Math.abs(dx)>Math.abs(dy);}if(!drag.horizontal)return;this.yaw=drag.start+dx*.013;this.pivot.rotation.y=this.yaw;c.dataset.interaction='rotate';this.render();},opts);
  const end=e=>{if(!drag||e.pointerId!==drag.id)return;const tap=!drag.moved&&e.type==='pointerup';drag=null;this.returning=!this.reduced;if(this.reduced){this.yaw=0;this.pivot.rotation.y=0;this.render();}delete c.dataset.interaction;if(c.hasPointerCapture(e.pointerId))c.releasePointerCapture(e.pointerId);if(tap)this.interact();};c.addEventListener('pointerup',end,opts);c.addEventListener('pointercancel',end,opts);
  c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.interact();}else if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();this.yaw+=(e.key==='ArrowLeft'?-.35:.35);this.pivot.rotation.y=this.yaw;this.returning=true;this.render();}},opts);
 }
 frame=now=>{if(!this.running||this.disposed||this.contextLost)return;this.frameID=requestAnimationFrame(this.frame);if(now-(this.lastFrame||0)<1000/30)return;const dt=Math.min((now-(this.lastFrame||now))/1000,.5);this.lastFrame=now;this.time+=dt;if(!this.reduced)this.mixer?.update(dt);if(this.mixer&&!this.interaction&&!['Rest','Stale'].includes(this.mode)&&this.time>(this.nextBlink||3)){const blink=this.actions.get('Blink');blink.reset().setLoop(THREE.LoopOnce,1).play();this.nextBlink=this.time+4.5;}if(this.returning){this.yaw*=Math.exp(-dt*3);if(Math.abs(this.yaw)<.003){this.yaw=0;this.returning=false;}this.pivot.rotation.y=this.yaw;}this.render();};
 render(){if(this.renderer&&this.scene&&!this.disposed&&!this.contextLost){this.renderer.render(this.scene,this.camera);this.canvas.dataset.yaw=String(this.yaw.toFixed(3));}}
 resume(){if(this.disposed||this.contextLost||this.failed)return;if(this.frameID)cancelAnimationFrame(this.frameID);this.running=true;this.lastFrame=0;this.frameID=requestAnimationFrame(this.frame);this.canvas.dataset.running='true';if(this.reduced){this.pause();this.render();}}
 pause(){this.running=false;if(this.frameID)cancelAnimationFrame(this.frameID);this.frameID=null;this.canvas.dataset.running='false';}
 setReduced(value){this.reduced=value;this.interaction=null;this.oneShot=null;this.onInteract(null);this.playBase();}
 disposeObject(object){const geometries=new Set(),materials=new Set();object?.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?Array.isArray(o.material)?o.material:[o.material]:[])materials.add(m);});geometries.forEach(g=>g.dispose());materials.forEach(m=>{for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();});}
 dispose(){if(this.disposed)return;this.pause();this.disposed=true;this.abort.abort();this.resizeObserver?.disconnect();this.mixer?.stopAllAction();this.mixer?.uncacheRoot(this.model);this.disposeObject(this.scene);this.renderer?.dispose();this.renderer?.forceContextLoss();}
}
