// Original articulated raven, modeled in geometry from the approved concept.
// No image planes, remote assets, native APIs, or external modeling service.
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('../public/models/',import.meta.url));
await mkdir(output,{recursive:true});
// GLTFExporter only needs this browser primitive to serialize the binary Blob.
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};
const material=(name,color,roughness=.75,metalness=0)=>new T.MeshStandardMaterial({name,color,roughness,metalness});
const plumage=material('charcoal_blue_feathers','#272831',.79),wingMat=material('violet_graphite_wings','#30323f',.7),beakMat=material('smooth_dark_beak','#34353b',.36),footMat=material('graphite_feet','#343238',.66),eyeMat=material('glossy_eyes','#100e11',.08),irisMat=material('warm_umber_iris','#39251f',.24),sclera=material('warm_eye_rim','#c9bdae',.48),shine=new T.MeshBasicMaterial({name:'eye_glints',color:'#fffaf0'});
plumage.vertexColors=wingMat.vertexColors=true;plumage.color.set('#ffffff');wingMat.color.set('#ffffff');
const root=new T.Group();root.name='Raven';root.userData={design:'Ziwei raven v1, original procedural mesh',axis:'Y up, beak +Z',clips:'Idle Work Rest Think Affection Stale Jump Poke Blink',reference:'approved four-view raven concept; sculpted stylization, not a textured reconstruction'};
const rig=new T.Group();rig.name='Pose';root.add(rig);
let seed=12837;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
function group(name,parent,position=[0,0,0]){const g=new T.Group();g.name=name;g.position.set(...position);parent.add(g);return g;}
function mesh(geo,mat,parent,position=[0,0,0],scale=[1,1,1],name=''){const m=new T.Mesh(geo,mat);m.position.set(...position);m.scale.set(...scale);m.name=name;parent.add(m);return m;}
const sphere=new T.SphereGeometry(1,24,16);
function colored(geo,color){const c=new T.Color(color),a=new Float32Array(geo.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}geo.setAttribute('color',new T.BufferAttribute(a,3));return geo;}
const body=group('Body',rig,[0,1.08,0]);body.scale.x=1.12;
mesh(colored(sphere.clone(),'#292a33'),plumage,body,[0,0,0],[.74,.86,.64],'rounded_body');
const head=group('Head',body,[0,.79,.20]);
mesh(colored(sphere.clone(),'#292932'),plumage,head,[0,0,0],[.64,.61,.59],'rounded_head');

// Closed, gently cupped feather: independent depth and a tapered curved tip.
function feather(width,length,depth=.035,bend=.08){
 const p=[],ix=[],rows=7,sides=8;
 for(let r=0;r<=rows;r++){const t=r/rows,profile=Math.max(.006,Math.sin(Math.PI*t)**.68)*(1-.37*t);for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2;p.push(Math.cos(a)*width*profile,-length*t,Math.sin(a)*depth*profile+bend*t*t);}}
 for(let r=0;r<rows;r++)for(let j=0;j<sides;j++){const i=r*(sides+1)+j,k=i+sides+1;ix.push(i,k,i+1,k,k+1,i+1);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;
}
function bakeFeathers(parent,parts,mat,name){const merged=mergeGeometries(parts);const m=mesh(merged,mat,parent);m.name=name;parts.forEach(p=>p.dispose());return m;}
function transformFeather(geo,position,normal,shade){
 const n=normal.clone().normalize(),up=new T.Vector3(0,1,0).addScaledVector(n,-n.y).normalize(),right=new T.Vector3().crossVectors(up,n).normalize(),basis=new T.Matrix4().makeBasis(right,up,n);basis.setPosition(position);geo.applyMatrix4(basis);return colored(geo,shade);
}
const bodyFeathers=[];
for(let row=0;row<11;row++){
 const angle=.40+row*.205,n=Math.max(10,Math.round(39*Math.sin(angle)));
 for(let i=0;i<n;i++){const phi=(i+(row%2)*.5)/n*Math.PI*2+(rand()-.5)*.045,a=angle+(rand()-.5)*.045,x=.742*Math.sin(a)*Math.cos(phi),y=.86*Math.cos(a),z=.642*Math.sin(a)*Math.sin(phi),normal=new T.Vector3(x/.742**2,y/.86**2,z/.642**2),length=.15+rand()*.045;
  bodyFeathers.push(transformFeather(feather(.072+rand()*.017,length,.012,.014),new T.Vector3(x,y,z),normal,new T.Color('#30313a').multiplyScalar(.84+rand()*.24)));
 }
}
bakeFeathers(body,bodyFeathers,plumage,'overlapping_body_feathers');
const headFeathers=[];
for(let row=0;row<6;row++)for(let i=0;i<24;i++){
 const a=.35+row*.34,phi=(i+(row%2)*.5)/24*Math.PI*2,x=.642*Math.sin(a)*Math.cos(phi),y=.612*Math.cos(a),z=.592*Math.sin(a)*Math.sin(phi);
 // Leave the expressive facial mask unobstructed.
 if(z>.26&&y>-.30&&y<.40)continue;
 headFeathers.push(transformFeather(feather(.072,.145+rand()*.035,.018,.017),new T.Vector3(x,y,z),new T.Vector3(x/.64**2,y/.61**2,z/.59**2),new T.Color('#30303a').multiplyScalar(.84+rand()*.19)));
}
bakeFeathers(head,headFeathers,plumage,'small_head_feathers');
for(let i=0;i<3;i++){
 const tuft=mesh(colored(feather(.075,.39-i*.035,.026,.09),'#343440'),plumage,head,[-.13+i*.12,.54,-.08+i*.025],[1,1,1],'crest_'+i);tuft.rotation.set(Math.PI-.40-i*.18,0,(i-1)*.27);
}

// Sculpted broad raven beak, lofted from forehead to a hooked point.
function beak(){const p=[],ix=[],rings=[[-.02,.245,.125],[.15,.26,.13],[.36,.18,.075],[.54,.085,-.035],[.59,.002,-.12]],sides=16;
 for(const [z,w,y] of rings)for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2;p.push(Math.cos(a)*w,y+Math.sin(a)*w*.62,z);}
 for(let r=0;r<rings.length-1;r++)for(let j=0;j<sides;j++){const i=r*(sides+1)+j,k=i+sides+1;ix.push(i,i+1,k,k,i+1,k+1);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;
}
mesh(beak(),beakMat,head,[0,-.06,.43],[1,1,1],'hooked_upper_beak');
const lowerBeak=mesh(sphere,beakMat,head,[0,-.155,.63],[.198,.07,.31],'lower_beak');
for(const side of [-1,1]){
 const nostril=mesh(sphere,eyeMat,head,[side*.18,.018,.66],[.027,.018,.014],'nostril');nostril.rotation.y=side*.5;
 const eye=group(side<0?'EyeL':'EyeR',head,[side*.338,.135,.444]);eye.rotation.y=side*.48;
 mesh(sphere,sclera,eye,[0,0,0],[.213,.235,.105],'eye_rim');
 mesh(sphere,irisMat,eye,[side*-.012,-.003,.064],[.175,.190,.067],'iris');
 mesh(sphere,eyeMat,eye,[side*-.016,.005,.105],[.151,.169,.040],'pupil');
 mesh(sphere,shine,eye,[-.047,.068,.140],[.044,.046,.012],'eye_glint');
 mesh(sphere,shine,eye,[.048,-.054,.142],[.012,.014,.007],'eye_glint_small');
 // Sculpted upper brow adds a deadpan expression without human eyebrows.

}

for(const side of [-1,1]){
 const wing=group(side<0?'WingL':'WingR',body,[side*.61,.30,-.06]);wing.rotation.z=side*.12;
 mesh(colored(sphere.clone(),'#282a35'),wingMat,wing,[side*.025,-.22,-.015],[.20,.51,.43],'folded_wing');
 const feathers=[];
 for(let row=0;row<4;row++)for(let col=0;col<6;col++){
  const y=.17-row*.145,z=.245-col*.105-row*.01,x=side*(.13+.04*Math.sin(col/5*Math.PI));
  const normal=new T.Vector3(side*.94,.12,.28).normalize(),geo=transformFeather(feather(.095+row*.009,.24+row*.055,.032,.035),new T.Vector3(x,y,z),normal,new T.Color('#3c3e50').multiplyScalar(.77+rand()*.20));feathers.push(geo);
 }
 for(let i=0;i<6;i++){
  const geo=feather(.075,.52+i*.028,.025,.07),obj=new T.Object3D();obj.position.set(side*.09,-.19,.16-i*.095);obj.rotation.set(-.33-i*.075,side*Math.PI/2,side*-.12);obj.updateMatrix();geo.applyMatrix4(obj.matrix);feathers.push(colored(geo,new T.Color('#353746').multiplyScalar(.83+rand()*.17)));
 }
 bakeFeathers(wing,feathers,wingMat,'layered_wing_feathers');
}
const tail=group('Tail',body,[0,-.45,-.51]);
for(let i=0;i<7;i++){const f=mesh(colored(feather(.105,.59-Math.abs(i-3)*.035,.025,.04),'#30323f'),wingMat,tail,[(i-3)*.055,0,0],[1,1,1],'tail_feather_'+i);f.rotation.set(1.03,0,(i-3)*.13);}
function tube(points,radius,mat,parent,name){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));return mesh(new T.TubeGeometry(curve,12,radius,7,false),mat,parent,[0,0,0],[1,1,1],name);}
for(const side of [-1,1]){
 const foot=group(side<0?'FootL':'FootR',rig,[side*.285,.205,.12]);
 tube([[0,.16,-.03],[0,.07,0],[0,-.02,.06]],.048,footMat,foot,'ankle');
 for(let i=0;i<3;i++){const spread=(i-1)*.087,end=[spread*1.5,-.137,.31-Math.abs(i-1)*.045];tube([[0,-.015,.025],[spread,-.10,.16],end],.032,footMat,foot,'toe_'+i);tube([end,[end[0],end[1]-.003,end[2]+.052],[end[0],end[1]-.032,end[2]+.067]],.018,beakMat,foot,'claw_'+i);}
 tube([[0,-.015,0],[side*.04,-.115,-.13],[side*.07,-.13,-.21]],.029,footMat,foot,'rear_toe');
}

const clips=[],v=(node,times,values)=>new T.VectorKeyframeTrack(node+'.position',times,values.flat()),s=(node,times,values)=>new T.VectorKeyframeTrack(node+'.scale',times,values.flat()),q=(node,times,eulers)=>new T.QuaternionKeyframeTrack(node+'.quaternion',times,eulers.flatMap(e=>new T.Quaternion().setFromEuler(new T.Euler(...e)).toArray()));
const pose=(duration,positions,rotations)=>[v('Pose',duration,positions),q('Pose',duration,rotations)];
const add=(name,time,tracks)=>clips.push(new T.AnimationClip(name,time,tracks));
add('Idle',4,[v('Body',[0,2,4],[[0,1.08,0],[0,1.105,0],[0,1.08,0]]),s('Body',[0,2,4],[[1.12,1,1],[1.133,1.012,1.012],[1.12,1,1]])]);
add('Work',3.8,[...pose([0,1,2.6,3.8],[[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,-.14,0],[0,.16,0],[0,-.1,0],[0,-.14,0]]),q('Head',[0,.8,1.5,2.3,3.8],[[.1,0,0],[.22,-.13,0],[.1,.08,0],[.25,.12,0],[.1,0,0]])]);
add('Rest',5,[v('Body',[0,2.5,5],[[0,.91,0],[0,.925,0],[0,.91,0]]),q('Head',[0,2.5,5],[[-.12,0,.04],[-.14,0,.04],[-.12,0,.04]]),s('EyeL',[0,5],[[1,.06,1],[1,.06,1]]),s('EyeR',[0,5],[[1,.06,1],[1,.06,1]])]);
add('Think',4,[q('Head',[0,1.3,2.7,4],[[0,0,-.18],[0,.22,.16],[0,-.14,.18],[0,0,-.18]]),v('Body',[0,2,4],[[0,1.08,0],[0,1.10,0],[0,1.08,0]])]);
add('Affection',3,[...pose([0,.3,.6,1,1.3,3],[[0,0,0],[0,.13,0],[0,0,0],[0,.09,0],[0,0,0],[0,0,0]],Array(6).fill([0,0,0])),q('WingL',[0,.3,.6,1,1.3,3],[[0,0,-.12],[0,0,-.5],[0,0,-.12],[0,0,-.4],[0,0,-.12],[0,0,-.12]]),q('WingR',[0,.3,.6,1,1.3,3],[[0,0,.12],[0,0,.5],[0,0,.12],[0,0,.4],[0,0,.12],[0,0,.12]])]);
// The stale pose is theatrical, never a new published presence state.
add('Stale',5,[...pose([0,5],[[0,.79,1.05],[0,.79,1.05]],[[-Math.PI/2,0,-.12],[-Math.PI/2,0,-.12]]),q('WingL',[0,5],[[0,0,-.72],[0,0,-.72]]),q('WingR',[0,5],[[0,0,.72],[0,0,.72]]),s('EyeL',[0,3.9,4.1,4.4,4.6,5],[[1,.05,1],[1,.05,1],[1,.4,1],[1,.4,1],[1,.05,1],[1,.05,1]]),s('EyeR',[0,5],[[1,.05,1],[1,.05,1]])]);
add('Jump',1.05,[...pose([0,.14,.40,.68,.80,1.05],[[0,0,0],[0,-.06,0],[0,.56,0],[0,0,0],[0,.06,0],[0,0,0]],[[0,0,0],[.1,0,0],[-.08,0,0],[.1,0,0],[0,0,0],[0,0,0]]),s('Body',[0,.14,.4,.68,.80,1.05],[[1.12,1,1],[1.165,.94,1.04],[1.086,1.04,.97],[1.187,.94,1.06],[1.12,1,1],[1.12,1,1]]),q('WingL',[0,.4,1.05],[[0,0,-.12],[0,0,-.72],[0,0,-.12]]),q('WingR',[0,.4,1.05],[[0,0,.12],[0,0,.72],[0,0,.12]])]);
add('Poke',1.1,[...pose([0,.15,.3,.55,.8,1.1],Array(6).fill([0,.79,1.05]),[[-Math.PI/2,0,-.12],[-Math.PI/2,.06,-.18],[-Math.PI/2,-.06,-.08],[-Math.PI/2,.04,-.13],[-Math.PI/2,0,-.12],[-Math.PI/2,0,-.12]]),s('EyeL',[0,.22,.7,1.1],[[1,.1,1],[1,.8,1],[1,.8,1],[1,.1,1]]),s('EyeR',[0,1.1],[[1,.05,1],[1,.05,1]])]);
add('Blink',.18,[s('EyeL',[0,.08,.18],[[1,1,1],[1,.04,1],[1,1,1]]),s('EyeR',[0,.08,.18],[[1,1,1],[1,.04,1],[1,1,1]])]);
root.traverse(o=>{if(o.geometry)o.geometry.deleteAttribute('uv');});
root.updateMatrixWorld(true);
const bytes=await new GLTFExporter().parseAsync(root,{binary:true,animations:clips,trs:true,copyright:'Original model for Ziwei Home; generated from repository modeling source'});
await writeFile(output+'raven.glb',Buffer.from(bytes));
let triangles=0,meshes=0;root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});
const manifest={format:'glTF 2.0 binary',generator:'scripts/build_raven_model.mjs',bytes:bytes.byteLength,meshes,triangles,animations:clips.map(c=>({name:c.name,duration:c.duration})),parts:['Pose','Body','Head','WingL','WingR','Tail','FootL','FootR','EyeL','EyeR'],reference:'Concept reference only; geometry is modeled here, without image-to-3D reconstruction.'};
await writeFile(output+'raven-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
