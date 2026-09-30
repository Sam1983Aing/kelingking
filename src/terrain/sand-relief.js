// Shallow wind-sorted relief, in metres. Shared by the heightfield and the
// exposed beach floor so collision queries, baked shadows and geometry agree.
// It vanishes before the swash band; the wet beach profile remains unchanged.
const fract = x => x - Math.floor(x);
const hash = (x,y) => {
  let a=fract(x*0.1031), b=fract(y*0.1031), c=a;
  const d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33);
  a+=d;b+=d;c+=d;return fract((a+b)*c);
};
const noise = (x,y) => {
  const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j;
  const a=u*u*(3-2*u),b=v*v*(3-2*v);
  return (hash(i,j)*(1-a)+hash(i+1,j)*a)*(1-b)
    +(hash(i,j+1)*(1-a)+hash(i+1,j+1)*a)*b;
};
export function sandRelief(x,y,h) {
  const t=Math.max(0,Math.min(1,(h-1.5)/0.55)), dry=t*t*(3-2*t);
  if(dry===0)return 0;
  const u=0.83*x+0.56*y, v=-0.56*x+0.83*y;
  return dry*(0.30*(noise(u*0.13+7.2,v*0.21-3.7)-0.5)
    +0.10*(noise(u*0.39-2.6,v*0.34+11.1)-0.5));
}
