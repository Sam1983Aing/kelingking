// Fixed right-wall, opposite-side and contact cameras, with matching clay views.
//   node tools/cliff-contact-review.mjs final http://localhost:5183/
// Output: captures/v29-<label>/ (renders and terrain ray readbacks).
import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const label=process.argv[2]||'before',base=(process.argv[3]||'http://localhost:5183/').replace(/\/?$/, '/');
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use a plain output label.');
const out=`captures/v29-${label}`;mkdirSync(out,{recursive:true});
const b=await launch();
try {
 const p=await b.open(base+'?record=1&q=1024&pr=1&notext&t=17',{width:1600,height:1000});
 await p.waitFor('window.__scroll?.ready',180000);await p.eval('__scroll.begin(true);0');
 const views=[
  ['report',[122,199,3.6],5,5,60],
  ['left',[127.22918226426727,188.47823644725858,4.52715532545565],180,-11,54],
  ['near',[139,244,4.7],35,5,60],
  ['contact',[141,248,4.8],55,-11,54],
  ['stairsContact',[127.23,188.48,4.55],130,-10,54],
 ];
 const rows=[];
 for(const [name,pos,yaw,pitch,fov]of views){
  await p.eval(`__app.setPose(${JSON.stringify(pos)},${yaw},${pitch},0,${fov});__app.advance(0);__app.terrain.uniforms.uClay.value=0;__app.plants.group.visible=true;for(let i=0;i<4;i++)__app.renderFrame();0`);
  writeFileSync(`${out}/${name}.jpg`,await p.screenshot({format:'jpeg',quality:93}));
  const hits=await p.eval(`(async()=>{const T=await import('three'),A=__app,G=A.terrain.mesh.geometry,R=new T.Raycaster(),rows=[];for(let y=.35;y<=.78;y+=.1)for(let x=.1;x<.96;x+=.2){R.setFromCamera(new T.Vector2(x*2-1,1-y*2),A.camera);const H=R.intersectObject(A.terrain.mesh,false)[0];if(H)rows.push({screen:[x,y],p:H.point.toArray(),face:H.faceIndex,grid:H.faceIndex<G.userData.gridTris,normal:H.face.normal.toArray(),rock:[H.face.a,H.face.b,H.face.c].map(v=>Array.from(G.attributes.aRock.array.slice(v*4,v*4+4)))});}return {hits:rows,triangles:G.index.count/3,vertices:G.attributes.position.count,drawCalls:A.renderer.info.render.calls};})()`);rows.push({name,pos,yaw,pitch,fov,...hits});
  await p.eval('__app.terrain.uniforms.uClay.value=1;__app.plants.group.visible=false;for(let i=0;i<4;i++)__app.renderFrame();0');
  writeFileSync(`${out}/${name}-clay.jpg`,await p.screenshot({format:'jpeg',quality:93}));
 }
 // Adjacent cameras expose overlaps that a single still can hide.
 if (process.argv.includes('--motion')) {
  await p.eval('__app.terrain.uniforms.uClay.value=0;__app.plants.group.visible=true;0');
  const fps=24,frames=73,tracks=[
   {name:'cove-turn',from:[122,199,3.6],to:[119,208,4.0],yaw:[5,15],pitch:[5,-4],fov:60},
   {name:'stair-contact',from:[127.23,188.48,4.55],to:[123,201,4.1],yaw:[180,168],pitch:[-11,-9],fov:54},
  ];
  for(const track of tracks){
   const dir=`${out}/${track.name}-frames`;mkdirSync(dir,{recursive:true});
   for(let i=0;i<frames;i++){
    const t=i/(frames-1),e=t*t*(3-2*t),mix=(a,b)=>a+(b-a)*e;
    const pos=track.from.map((v,d)=>mix(v,track.to[d]));
    await p.eval(`__app.setPose(${JSON.stringify(pos)},${mix(...track.yaw)},${mix(...track.pitch)},0,${track.fov});__app.advance(0);__app.renderFrame();0`);
    writeFileSync(`${dir}/f${String(i).padStart(4,'0')}.jpg`,await p.screenshot({format:'jpeg',quality:90}));
   }
   const r=spawnSync('ffmpeg',['-y','-loglevel','error','-framerate',String(fps),'-i',`${dir}/f%04d.jpg`,'-c:v','libx264','-pix_fmt','yuv420p','-crf','19',`${out}/${track.name}.mp4`]);
   if(r.status!==0)throw new Error(r.stderr.toString());
  }
  writeFileSync(`${out}/motion.json`,JSON.stringify({fps,framesPerTrack:frames,seaTime:17,tracks},null,2));
 }
 // Preserve the earlier closure fix beside the 28m stair bank.
 await p.eval('__app.terrain.uniforms.uClay.value=0;__app.plants.group.visible=true;0');
 await p.eval('const screens=__scroll.pace.screensAt(3.665);for(let i=0;i<30;i++)__scroll.frame(1/24,screens,true);0');
 writeFileSync(`${out}/closure.jpg`,await p.screenshot({format:'jpeg',quality:93}));
 const closure=await p.eval(`{const A=__app,T=A.THREE,R=new T.Raycaster();R.setFromCamera(new T.Vector2(-.68,.16),A.camera);const hits=R.intersectObject(A.terrain.mesh,false);({tau:__scroll.cam.tau,camera:A.camera.position.toArray(),terrainHits:hits.slice(0,3).map(h=>({distance:h.distance,point:h.point.toArray()}))});}`);
 writeFileSync(`${out}/closure.json`,JSON.stringify(closure,null,2));
 writeFileSync(`${out}/hits.json`,JSON.stringify(rows,null,2));
 console.log('saved',out,'console',p.log.filter(l=>/error|exception/i.test(l)));
}finally{b.close();}
