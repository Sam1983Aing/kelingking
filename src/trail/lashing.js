import { bambooSection } from './bamboo.js';

// Cord follows the actual bowed, tapered bamboo, in world metres. Each diagonal winding
// follows the convex outline of both poles in its plane: curved where it bears on wood,
// straight and taut between the two contact arcs. No independently scaled floating cuffs.
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => mul(a, 1 / (Math.hypot(...a) || 1));
const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };

function hull(points) {
  points.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const turn = (a,b,c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const half = list => { const h=[]; for(const p of list) { while(h.length>1 && turn(h.at(-2),h.at(-1),p)<=0) h.pop(); h.push(p); } return h; };
  return [...half(points).slice(0,-1), ...half([...points].reverse()).slice(0,-1)];
}

function outline(A, B, origin, N, U, V, offset, cord) {
  const points=[];
  for(const pole of [A,B]) {
    const axisDot = dot(pole.axis,N);
    const center = add(pole.center,mul(pole.axis,(offset-dot(sub(pole.center,origin),N))/axisDot));
    const localCenter = sub(center,origin);
    for(let i=0;i<48;i++) {
      const angle=i/48*TAU, D=add(mul(U,Math.cos(angle)),mul(V,Math.sin(angle)));
      const radial=(pole.radius+cord*0.82)/Math.sqrt(Math.max(0.04,1-dot(D,pole.axis)**2));
      const p=add(localCenter,mul(D,radial)); points.push([dot(p,U),dot(p,V)]);
    }
  }
  const polygon=hull(points), lengths=[0];
  for(let i=0;i<polygon.length;i++) lengths.push(lengths.at(-1)+Math.hypot(...sub(polygon[(i+1)%polygon.length],polygon[i])));
  return fraction => {
    const s=((fraction%1)+1)%1*lengths.at(-1);
    let i=0; while(lengths[i+1]<s) i++;
    const t=(s-lengths[i])/(lengths[i+1]-lengths[i]);
    const p=add(polygon[i],mul(sub(polygon[(i+1)%polygon.length],polygon[i]),t));
    return add(origin,add(mul(N,offset),add(mul(U,p[0]),mul(V,p[1]))));
  };
}

// The immutable vertex pool is shared by every joint. Only indices for nearby joints are
// submitted; one draw call, with no distant cord vertices sent through the shader.
export function buildLashings(posts, rails, descriptors) {
  const position=[], normal=[], trail=[], random=[], index=[], coarse=[], joints=[];
  const cord=0.0028, radial=8;
  const surfaceNormal = (p, pole) => norm(sub(sub(p,pole.center),mul(pole.axis,dot(sub(p,pole.center),pole.axis))));
  const gap = (p,pole) => Math.hypot(...sub(sub(p,pole.center),mul(pole.axis,dot(sub(p,pole.center),pole.axis))))-pole.radius;
  function tube(path, radius, rand, A, B, taperEnd=false) {
    const base=position.length/3;
    let frame=norm(cross(norm(sub(path[1],path[0])),[0,0,1])), along=0;
    if(Math.hypot(...frame)<0.5) frame=[0,1,0];
    for(let i=0;i<path.length;i++) {
      const p=path[i], tangent=norm(sub(path[Math.min(i+1,path.length-1)],path[Math.max(0,i-1)]));
      frame=norm(sub(frame,mul(tangent,dot(frame,tangent)))); const binormal=cross(tangent,frame);
      if(i) along+=Math.hypot(...sub(p,path[i-1]));
      const outward=surfaceNormal(p,gap(p,A)<gap(p,B)?A:B);
      const taper=taperEnd ? 1-0.72*smooth(0.7,1,i/(path.length-1)) : 1;
      for(let j=0;j<=radial;j++) {
        const angle=j/radial*TAU, n=add(mul(frame,Math.cos(angle)),mul(binormal,Math.sin(angle)));
        const r=radius*taper*(1+0.045*Math.cos(angle*3-along*850));
        position.push(...add(p,mul(n,r))); normal.push(...n);
        trail.push(angle,along,0.55+0.45*Math.max(0,dot(n,outward)),0); random.push(rand);
      }
      if(i) for(let j=0;j<radial;j++) {
        const a=base+(i-1)*(radial+1)+j, b=a+1, d=a+radial+1, c=d+1;
        index.push(a,d,c,a,c,b);
      }
    }
    // Beyond arm's length a winding is less than two pixels thick. Share its vertex pool,
    // connecting alternate rings and four radial sides, with the exact same endpoints.
    let previous=0;
    for(let i=2;i<path.length+2;i+=2) {
      const next=Math.min(i,path.length-1);
      if(next<=previous) break;
      for(let j=0;j<radial;j+=2) {
        const a=base+previous*(radial+1)+j, b=a+2;
        const d=base+next*(radial+1)+j, c=d+2;
        coarse.push(a,d,c,a,c,b);
      }
      previous=next;
    }
  }
  for(let k=0;k<descriptors.length;k+=5) {
    const [pi,ri,pt,rt,rand]=descriptors.subarray(k,k+5);
    const A=bambooSection(posts.matrices.subarray(pi*16,pi*16+16),posts.rand[pi],pt,true);
    const B=bambooSection(rails.matrices.subarray(ri*16,ri*16+16),rails.rand[ri],rt);
    // The shortest line between the two local axes is the actual wood contact.
    const d=sub(B.center,A.center), ab=dot(A.axis,B.axis), den=Math.max(0.02,1-ab*ab);
    const ta=(dot(d,A.axis)-ab*dot(d,B.axis))/den, tb=ab*ta-dot(d,B.axis);
    A.center=add(A.center,mul(A.axis,ta)); B.center=add(B.center,mul(B.axis,tb));
    const origin=mul(add(A.center,B.center),0.5), U=norm(cross(A.axis,B.axis));
    const first=index.length, firstCoarse=coarse.length, sign=ab>=0?1:-1;
    const Ns=[norm(add(A.axis,mul(B.axis,sign))), Math.abs(ab)<0.55 ? norm(sub(A.axis,mul(B.axis,sign))) : norm(add(mul(A.axis,1.15),mul(B.axis,sign*0.9)))];
    const front=norm(sub(B.center,A.center)), K=add(B.center,mul(front,B.radius+cord*1.8));
    const ends=[];
    for(let winding=0;winding<2;winding++) {
      const N=Ns[winding], V=norm(cross(N,U)), turns=2, steps=Math.ceil(turns*28), path=[];
      // End each winding on the exposed face so its lead reaches the knot without cutting
      // through a pole or spanning the joint from its hidden back.
      const endOutline=outline(A,B,origin,N,U,V,turns*cord*1.15,cord);
      let endFraction=0, closest=Infinity;
      for(let i=0;i<96;i++) { const dist=Math.hypot(...sub(endOutline(i/96),K)); if(dist<closest) { closest=dist; endFraction=i/96; } }
      const phase=endFraction-turns;
      for(let i=0;i<=steps;i++) {
        const t=i/steps, offset=(t-0.5)*turns*cord*2.3;
        path.push(outline(A,B,origin,N,U,V,offset,cord)(phase+t*turns));
      }
      tube(path,cord,rand,A,B); ends.push(path[0],path.at(-1));
    }
    // A small locking knot on the exposed rail face, reached by taut, short leads.
    const X=norm(cross(front,B.axis)), Y=B.axis;
    const knotPoint=(x,y,z) => add(K,add(mul(X,x),add(mul(Y,y),mul(front,z))));
    for(const end of ends) tube([end,add(mul(end,0.45),mul(K,0.55)),K],cord,rand,A,B);
    const knot=[];
    for(let i=0;i<=32;i++) { const t=i/32*TAU; knot.push(knotPoint(Math.sin(t)*0.007,Math.sin(t*2)*0.005,Math.cos(t)*cord)); }
    tube(knot,cord*1.06,rand,A,B);
    const tail=[];
    for(let i=0;i<=8;i++) { const t=i/8; tail.push(add(knotPoint(0.002+t*0.003,0,cord),[t*0.002,-t*(0.027+rand*0.018),t*t*0.004])); }
    tube(tail,cord*0.9,rand,A,B,true);
    joints.push({ center:origin, start:first, count:index.length-first, coarseStart:firstCoarse, coarseCount:coarse.length-firstCoarse });
  }
  return { position:new Float32Array(position), normal:new Float32Array(normal), trail:new Float32Array(trail), random:new Float32Array(random), index:new Uint32Array(index), coarse:new Uint32Array(coarse), joints };
}
