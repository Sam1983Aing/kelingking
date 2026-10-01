// Fixed right-wall, opposite-side and contact cameras, with matching clay views.
//   node tools/cliff-foot-review.mjs after http://localhost:5183/
// Output: captures/v27-<label>/ (renders and terrain ray readbacks).
import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const label=process.argv[2]||'before',base=process.argv[3]||'http://localhost:5183/';
const out=`captures/v27-${label}`;mkdirSync(out,{recursive:true});
const b=await launch();
try {
 const p=await b.open(base+'?record=1&q=1024&pr=1&notext&t=17',{width:1600,height:1000});
 await p.waitFor('window.__scroll?.ready',180000);await p.eval('__scroll.begin(true);0');
 const views=[
  ['report',[122,199,3.6],5,5,60],
  ['left',[127.22918226426727,188.47823644725858,4.52715532545565],180,-11,54],
  ['near',[139,244,4.7],35,5,60],
  ['contact',[141,248,4.8],55,-11,54],
 ];
 const rows=[];
 for(const [name,pos,yaw,pitch,fov]of views){
  await p.eval(`__app.setPose(${JSON.stringify(pos)},${yaw},${pitch},0,${fov});__app.advance(0);__app.terrain.uniforms.uClay.value=0;__app.plants.group.visible=true;for(let i=0;i<4;i++)__app.renderFrame();0`);
  writeFileSync(`${out}/${name}.jpg`,await p.screenshot({format:'jpeg',quality:93}));
  const hits=await p.eval(`(async()=>{const T=await import('three'),A=__app,G=A.terrain.mesh.geometry,R=new T.Raycaster(),rows=[];for(let y=.35;y<=.78;y+=.1)for(let x=.1;x<.96;x+=.2){R.setFromCamera(new T.Vector2(x*2-1,1-y*2),A.camera);const H=R.intersectObject(A.terrain.mesh,false)[0];if(H)rows.push({screen:[x,y],p:H.point.toArray(),face:H.faceIndex,grid:H.faceIndex<G.userData.gridTris,normal:H.face.normal.toArray(),rock:[H.face.a,H.face.b,H.face.c].map(v=>Array.from(G.attributes.aRock.array.slice(v*4,v*4+4)))});}return {hits:rows,triangles:G.index.count/3,vertices:G.attributes.position.count,drawCalls:A.renderer.info.render.calls};})()`);rows.push({name,pos,yaw,pitch,fov,...hits});
  await p.eval('__app.terrain.uniforms.uClay.value=1;__app.plants.group.visible=false;for(let i=0;i<4;i++)__app.renderFrame();0');
  writeFileSync(`${out}/${name}-clay.jpg`,await p.screenshot({format:'jpeg',quality:93}));
 }
 writeFileSync(`${out}/hits.json`,JSON.stringify(rows,null,2));
 console.log('saved',out,'console',p.log.filter(l=>/error|exception/i.test(l)));
}finally{b.close();}
