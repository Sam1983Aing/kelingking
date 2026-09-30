import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// node tools/wave-cycle.mjs v26-stairs clip 13 18 http://localhost:5183/ stairs
// Fixed-clock captures; sheet = 4 fps, clip = 24 fps with an MP4.
// Every sample updates the water before drawing, including paused-time geometry and foam.
const label=process.argv[2]||'wave-cycle',mode=process.argv[3]||'clip';
if (!/^[a-z0-9-]+$/i.test(label) || !['sheet','clip'].includes(mode)) throw new Error('Use a plain output name and sheet or clip.');
const t0=+(process.argv[4]||14),span=+(process.argv[5]||12);
const base=process.argv[6]||'http://localhost:5183/';
const dir=`captures/${label}`;mkdirSync(dir,{recursive:true});
const b=await launch();
try {
 const p=await b.open(base+'?record=1&q=1024&pr=1&notext&t='+t0,{width:1500,height:960});
 await p.waitFor('window.__scroll?.ready');await p.eval('__scroll.begin(true);0');
 const screens=await p.eval('__scroll.pace.screensAt(3.78)');
 await p.eval(`for(let i=0;i<40;i++)__scroll.frame(1/30,${screens},true);0`);
 const scrollPose=await p.eval('({position:__app.camera.position.toArray(),forward:__app.camera.getWorldDirection(new __app.camera.position.constructor()).toArray()})');
 console.log('scroll camera',scrollPose);
 const view=process.argv[7]||'stairs';
 // Review camera: the September 30 sand-level report, from the scroll at 4.05.
 const cameras={
  review:'[127.23179203160545,188.4760190272445,4.549650273586554],255.629,-10.554,0,53.9478359620796',
  stairs:'[138.87580572491748,179.83731935783217,21.42465014142438],274,-12,0,50',
  sand:'[130,188,4.8],274,-5,0,55',
  shore:'[88,223.3,1.3],282,-4,-2,26',
  near:'[88,223.3,3.5],282,-8,-2,32',
  top:'[100,232,55],180,-90,0,72',
 };
 if (!cameras[view]) throw new Error('Unknown view: '+view);
 await p.eval('__app.setPose('+cameras[view]+');__app.advance(0);0');
 const pose=await p.eval('({position:__app.camera.position.toArray(),forward:__app.camera.getWorldDirection(new __app.camera.position.constructor()).toArray(),fov:__app.camera.fov})');
 const fps=mode==='clip'?24:4,n=Math.round(span*fps)+1, rows=[];
 for(let f=0;f<n;f++){
  const t=t0+f/fps;await p.eval(`__app.setTime(${t});__app.advance(0);__app.renderFrame();0`);
  writeFileSync(`${dir}/f${String(f).padStart(4,'0')}.jpg`,await p.screenshot({format:'jpeg',quality:90}));
  if(f%Math.max(1,Math.floor(fps/4))===0)rows.push(await p.eval(`(()=>{const r=__app.water.breaker.readColumns();return {t:${t},crest:Array.from(r.crest),stage:Array.from(r.stage)};})()`));
  if(f%fps===0)console.log('time',t.toFixed(2));
 }
 writeFileSync(`${dir}/columns.json`,JSON.stringify({view,t0,span,fps,pose,console:p.log.filter(l=>/error|exception/i.test(l)),rows}));
 if(mode==='clip'){
 const e=spawnSync('ffmpeg',['-y','-loglevel','error','-framerate',String(fps),'-i',`${dir}/f%04d.jpg`,'-c:v','libx264','-pix_fmt','yuv420p','-crf','19',`${dir}.mp4`]);if(e.status)throw new Error(e.stderr.toString());
 }
 console.log('errors',p.log.filter(l=>/error|exception/i.test(l)));
}finally{b.close();}
