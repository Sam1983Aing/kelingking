// World-space cross sections of the same bamboo deformation used by the trail shader.
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const norm = a => { const l=Math.hypot(...a)||1; return a.map(v=>v/l); };
const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };

// Keep this deformation in step with TR_BAMBOO in trail.js. The rails' last 20 cm are
// straight at a joint; the body bows, while its ends can actually bear on the posts.
export function bambooSection(m, random, t, post = false) {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const at = h => {
    const taper = post ? 1.1 - 0.2*h : 1.03 - 0.06*h;
    const envelope = post ? 1 : smooth(0.1, 0.2, h) * (1-smooth(0.8, 0.9, h));
    const bow = (0.012 + 0.014*((random*7.3)%1)) * Math.sin(Math.PI*h) * envelope;
    const angle = random*37;
    const local = [Math.cos(angle)*bow/sx, h-0.5, Math.sin(angle)*bow/sx];
    const center = [0,1,2].map(i => m[12+i] + m[i]*local[0] + m[4+i]*local[1] + m[8+i]*local[2]);
    return { center, radius: sx*taper };
  };
  const p = at(t), e = 0.0005;
  return { ...p, axis: norm(sub(at(t+e).center, at(t-e).center)), length: sy };
}

export function bambooAtHeight(m, random, height) {
  let t = (height - m[13]) / m[5] + 0.5;
  for (let i=0; i<2; i++) t += (height-bambooSection(m,random,t,true).center[1]) / m[5];
  return { ...bambooSection(m,random,t,true), t };
}

