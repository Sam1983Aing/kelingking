import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { SKY_PARS, AERIAL_VERT, AERIAL_FRAG_PARS } from '../sky/atmosphere-glsl.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';

// GLSL for the sea. Two sources of waves:
//   the open sea   a wave spectrum turned into tiling surfaces by an FFT (ocean.js): swell,
//                  wind waves, ripples, and the whitecaps where their crests break
//   the surf       a shore-driven wave train, from the terrain data texture:
//                  R = terrain height, G = metres offshore from the waterline, B = beach
//                  weight, A = sand hanging in the water
// The open sea gives way to the surf in front of the beaches and fades against the rock.
// Local coordinates in here are metres with x = east, y = north (world z = -north).

export const COMMON = /* glsl */ `
uniform sampler2D uData;
uniform sampler2D uShoreDir;   // unit direction pointing offshore, packed 0..1
uniform sampler2D uCoast;      // distance to the rock's foot, its exposure, openness to the swell, rock/sand (worker.js)
uniform vec3 uExtent;      // x0, y0, size of the terrain data in local metres
uniform float uTime;
uniform float uPeriod;     // seconds between waves
uniform float uSwell;      // wave height out at sea (m)
uniform float uBreakAt;    // distance offshore where waves break on the beach (m)
uniform float uSurge;      // how high the swash runs up (m of water level)
uniform vec2 uSwellDir;    // direction the swell travels, local
uniform vec4 uOceanL;      // patch size of each ocean cascade (m)
uniform vec4 uGust;        // gust pattern: scale (1/m), drift east and north (m/s), strength
uniform float uBreakerOn;  // 1 when the breaker mesh is drawn (the heightfield tucks its breaking crests away)

const vec4 OCEAN = vec4(-45.0, 900.0, 0.0, 0.0);

vec2 offshoreAt(vec2 p) {
  vec2 uv = clamp((p - uExtent.xy) / uExtent.z, 0.0, 1.0);
  vec2 d = texture2D(uShoreDir, uv).rg * 2.0 - 1.0;
  return d / max(length(d), 1e-3);
}

vec4 coastAt(vec2 p) {
  vec2 uv = (p - uExtent.xy) / uExtent.z;
  vec4 c = texture2D(uCoast, clamp(uv, 0.0, 1.0));
  float e = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  return mix(vec4(200.0, 0.0, 1.0, 1.0), c, smoothstep(0.0, 0.02, e));
}

vec4 dataAt(vec2 p) {
  vec2 uv = (p - uExtent.xy) / uExtent.z;
  vec4 d = texture2D(uData, clamp(uv, 0.0, 1.0));
  float e = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  return mix(OCEAN, d, smoothstep(0.0, 0.02, e));
}

// Hash from Dave Hoskins, "Hash without Sine" (MIT).
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
  return (0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 17.1) + 0.125 * vnoise(p * 4.07 + 31.7)) / 0.875;
}

// How much of each ocean cascade a point gets. Full out at sea. The swell runs straight into
// the rock but fades over the last few metres; in front of the beaches it gives way to the
// surf. Wind waves and ripples ride on everything, calmer inside the surf. Gusts make patches
// of rougher and smoother water (and keep the tiles from showing).
vec4 seaWeights(vec2 p, vec4 d) {
  float s = d.g;
  float nearBeach = smoothstep(0.25, 0.85, d.b);
  float swell = mix(smoothstep(-2.0, 30.0, s), smoothstep(uBreakAt + 40.0, uBreakAt + 160.0, s), nearBeach);
  float wind = mix(smoothstep(-2.0, 14.0, s), 0.25 + 0.75 * smoothstep(uBreakAt, uBreakAt + 70.0, s), nearBeach);
  float ripple = mix(smoothstep(-3.0, 4.0, s), 0.45 + 0.55 * smoothstep(0.0, uBreakAt, s), nearBeach);
  vec2 q = p * uGust.x - uGust.yz * uTime * uGust.x;
  float gust = mix(1.0, 0.45 + 1.1 * fbm3(q + vec2(3.1, 7.7)), uGust.w);
  float gustS = mix(1.0, 0.55 + 0.9 * fbm3(q * 3.1 + 11.0), uGust.w);
  return vec4(swell, wind * mix(1.0, gust, 0.6), ripple * gust * gustS, ripple * gust * gustS);
}

// Waves slow down and bunch up in shallow water. With a wavelength that grows linearly
// with distance offshore (L = L0 + b s) the phase is the integral of 1/L. For 9 s waves:
// T sqrt(g h) is about 23 m in 0.7 m of water, 44 m at 2.5 m, 90 m at 10 m, so one or two
// crests in the surf zone, running in at about 3 m/s.
const float L0 = 22.0;
const float LB = 0.7;
float shorePhase(float s) { return log(1.0 + LB * max(s, 0.0) / L0) / LB; }

// Wave timing on the beach: not a metronome. The clock runs a little fast and slow, so the
// gaps between waves vary, and the heights come in sets of three or four bigger ones. (The
// 0.3 s only sets which moment of the break the hero frames, frozen at 17 s, catch: the lip
// in mid-throw, as in wave-breaking-closeup.jpg.)
float waveClock(float t) { t += 0.3; return t + 1.6 * sin(t * 0.0937) + 0.9 * sin(t * 0.2167 + 1.3); }
float setSize(float idx) { return (0.78 + 0.3 * sin(idx * 0.861 + 0.7)) * mix(0.75, 1.25, hash12(vec2(idx, 3.1))); }

// The shore-driven wave train, in front of the beaches.
struct Surf {
  float h;        // height
  float lean;     // shoreward lean of the crest
  float fresh;    // white water being made right now: the plunging lip and the bore's front
  float foam;     // what it leaves behind (used where the foam simulation does not reach)
  float push;     // how hard the bore is carrying water up the beach (0..1)
  float broken;   // inside the break
  float hRaw;     // height before the breaking crest is tucked away under the breaker mesh
  float tau;      // how far this wave is through breaking: 0 starting to throw, 1 collapsed
  float vph;      // where this point is on its wave (phase, 0 at the crest, < 0 in front)
  float L;        // wavelength here (m)
  float wf;       // width of the wave's front (phase)
  float sink;     // how much of the crest is tucked away (breaker.js draws it instead)
};

Surf surfAt(vec2 p, vec4 d) {
  Surf o = Surf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 30.0, 0.1, 0.0);
  float s = d.g;
  if (s > 280.0 || s < -30.0) return o;
  float sand = d.b;
  float beachy = smoothstep(0.25, 0.85, sand);
  if (beachy <= 0.0) return o;
  float jag = vnoise(p * 0.012) * 0.45 + vnoise(p * 0.035) * 0.16 + vnoise(p * 0.11) * 0.03;
  float clock = waveClock(uTime) / uPeriod;
  float phase0 = shorePhase(s) + clock + jag;
  // Index the nearest crest, so a wave's own size never changes across its crest. The
  // size hands over to the next wave in the trough, blended, so the surface stays
  // continuous (a jump there is a vertical step that the grid draws as a row of teeth).
  float idx = floor(phase0 + 0.5);
  float v0 = phase0 - idx;               // < 0 in front of the crest, > 0 behind it
  float nb = idx + (v0 > 0.0 ? 1.0 : -1.0);
  float hand = 0.5 * smoothstep(0.25, 0.5, abs(v0));
  // Each wave has its own wobble along the shore, so no two crests are parallel.
  float wob = mix(vnoise(p * 0.03 + idx * 5.13), vnoise(p * 0.03 + nb * 5.13), hand) - 0.5;
  float v = v0 + wob * 0.12;
  float bigK = setSize(idx) * mix(0.6, 1.2, vnoise(p * 0.04 + idx * 7.31));
  float bigN = setSize(nb) * mix(0.6, 1.2, vnoise(p * 0.04 + nb * 7.31));
  float big = mix(bigK, bigN, hand);

  // Bigger waves break further out.
  float br = uBreakAt * (0.7 + 0.35 * big);
  // The shoreward wave train only forms in front of beaches. On rock the open swell runs
  // straight into the cliff, so there are no rings around the headland.
  float offshoreFade = (1.0 - smoothstep(110.0, 200.0, s)) * beachy;
  float grow = 0.2 + 2.0 * smoothstep(br + 70.0, br, s);
  float broken = smoothstep(br + 1.0, br - 5.0, s);
  float shrink = mix(1.0, 0.18 + 0.3 * clamp(s / max(br, 1.0), 0.0, 1.0), broken);
  float A = uSwell * grow * big * offshoreFade * shrink;
  float Ak = uSwell * grow * bigK * offshoreFade * shrink;
  // A wave cannot be much taller than the water is deep (it breaks at about 0.8 of the
  // depth), and its trough never reaches the seabed.
  float depthHere = max(-d.r, 0.0);
  A = min(A, 0.85 * depthHere + 0.35);
  Ak = min(Ak, 0.85 * depthHere + 0.35);

  float Lhere = L0 + LB * max(s, 0.0);
  float wf = max(mix(0.14, 0.07, smoothstep(br + 45.0, br, s)), 1.8 / Lhere);   // front at least ~2 m wide
  float w = v < 0.0 ? wf : 0.24;
  float crest = exp(-(v * v) / (w * w)) * smoothstep(0.44, 0.32, abs(v));
  // Breaking: this wave's crest reaches its break point, throws its lip and collapses over
  // 8 m of travel (about 2.5 s). The breaker mesh (breaker.js) draws the face and the lip
  // then, from 0.45 of a wavelength behind the crest to 0.12 in front, and the heightfield's
  // own crest is tucked under it.
  float brK = uBreakAt * (0.7 + 0.35 * bigK);
  float sCrest = s - v * Lhere;
  float tau = (brK + 5.0 - sCrest) / 8.0;
  float win = smoothstep(-0.17, -0.12, v) * (1.0 - smoothstep(0.36, 0.45, v));
  float sink = win * smoothstep(0.02, 0.12, tau) * (1.0 - smoothstep(0.95, 1.1, tau)) * beachy * uBreakerOn;
  float hRaw = max(Ak * crest - 0.28 * A, -0.45 * depthHere);
  float h = max(Ak * crest * (1.0 - sink) - 0.28 * A - 0.05 * sink, -0.45 * depthHere);
  // Only a slight lean. A heightfield cannot curl over (the lip is its own mesh, breaker.js),
  // and squeezing the front into a few grid rows turns it into a staircase of teeth.
  float lean = Ak * 0.1 * crest * smoothstep(br + 25.0, br, s) * (1.0 - broken);

  float lip = crest * smoothstep(br + 6.0, br - 1.0, s) * smoothstep(0.1, -0.01, v);
  // The bore: a white front a metre or two deep, then foam that thins into lace.
  float front = broken * smoothstep(-0.03, 0.0, v) * (1.0 - smoothstep(0.04, 0.12, v));
  float trail = broken * 0.8 * exp(-max(v, 0.0) / 0.3) * step(0.0, v);
  float resid = smoothstep(br + 14.0, 0.0, s) * 0.2;

  // Swash: when a bore reaches the sand the water level surges up the beach.
  float us = fract(clock + jag);
  float surge = uSurge * sand * (smoothstep(0.82, 1.0, us) + (1.0 - smoothstep(0.0, 0.55, us)) * step(us, 0.55));
  surge *= 0.75 + 0.5 * vnoise(p * 0.09);
  float sw = surge * (1.0 - smoothstep(br * 0.4, br, s));
  h += sw;
  hRaw += sw;

  float sz = mix(0.85, 1.1, big) * offshoreFade;
  o.h = h * offshoreFade;
  o.lean = lean * offshoreFade;
  o.fresh = max(lip, front * 1.1) * sz;
  o.foam = max(trail, resid) * sz;
  o.push = broken * smoothstep(-0.03, 0.0, v) * exp(-max(v, 0.0) / 0.1) * offshoreFade;
  o.broken = broken * offshoreFade;
  o.hRaw = hRaw * offshoreFade;
  o.tau = tau;
  o.vph = v;
  o.L = Lhere;
  o.wf = wf;
  o.sink = sink;
  return o;
}

// White water at the rock where the foam simulation does not reach: a band at the foot that
// pulses with the swell, wider where the rock faces it.
float rockFoamBand(vec2 p, vec4 d, vec4 c) {
  float pulse = exp(-pow(fract(uTime / uPeriod + vnoise(p * 0.02) * 1.3) - 0.15, 2.0) / 0.06);
  float exposed = c.g;
  float width = 3.0 + 18.0 * exposed + 8.0 * vnoise(p * 0.04);
  float band = smoothstep(width, 0.0, c.r);
  float patchy = smoothstep(0.2, 0.7, fbm3(p * 0.09 + vec2(uTime * 0.1, 0.0)));
  float rock = c.a * (0.5 + 0.5 * pulse) * (0.35 + 0.75 * exposed) * mix(band * band, band, patchy);
  return max(rock, c.a * smoothstep(1.5, 0.0, c.r) * 0.9);
}
`;


// Shared by the sea and the breaker: caustics and the foam's lace.
export const FOAM_GLSL = /* glsl */ `
// Caustics: animated cell edges (F2 - F1 of a jittered grid), two layers.
float cells(vec2 p, float t) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 9.0, f2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 h = vec2(hash12(ip + g), hash12(ip + g + 19.19));
    vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * h);
    float dd = length(g + o - fp);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  return f2 - f1;
}
float caustics(vec2 p, float t) {
  float a = 1.0 - smoothstep(0.0, 0.14, cells(p * 0.9, t * 0.9));
  float b = 1.0 - smoothstep(0.0, 0.16, cells(p * 1.3 + 7.3, -t * 0.7));
  return a * a + b * b * 0.7;
}


// Relief of thick white water (a heap of bubbles and churned water) at a position in metres:
// x how much light gets into this spot (the crevices between lumps are dark), yz a tilt of
// the surface in two directions, for its lumps to face toward or away from the sun. Three
// scales of lumps, 1 m down to 15 cm, the smallest only where a pixel is small enough.
float reliefH(vec2 q, vec2 o, float fine) {
  // Rotated octaves so the value noise's grid does not show as blocks.
  const mat2 R1 = mat2(0.8, -0.6, 0.6, 0.8), R2 = mat2(0.28, -0.96, 0.96, 0.28);
  return vnoise(q * 1.1 + o) * 0.5 + vnoise(R1 * q * 2.9 + 3.1 - o) * 0.32 + vnoise(R2 * q * 7.3 + 9.2) * 0.18 * fine;
}
vec3 foamRelief(vec2 q, float fp, float t) {
  vec2 o = vec2(t * 0.35, -t * 0.2);
  float e = 0.12;
  float fine = smoothstep(0.08, 0.02, fp);
  float h0 = reliefH(q, o, fine);
  vec2 g = vec2(reliefH(q + vec2(e, 0.0), o, fine) - reliefH(q - vec2(e, 0.0), o, fine),
                reliefH(q + vec2(0.0, e), o, fine) - reliefH(q - vec2(0.0, e), o, fine)) / (2.0 * e);
  return vec3(mix(0.35, 1.0, smoothstep(0.2, 0.6, h0)), g * 0.6);
}

// Foam lace at a map position: two levels of warping (big swirls, then filaments bent along
// them), ridges of noise for the filaments, small cells for bubbles up close, and a slow
// variation in how dense it is. Returns the pattern (x) and the big ridges (y).
vec2 lacePattern(vec2 pf, float fp) {
    vec2 q = pf * 0.9;
    vec2 w1 = vec2(fbm3(q * 0.18 + vec2(0.0, uTime * 0.03)), fbm3(q * 0.18 + vec2(5.2, 1.3) - uTime * 0.025));
    vec2 qw = q + (w1 - 0.5) * 6.0;
    vec2 w2 = vec2(fbm3(qw * 0.5 + 2.7), fbm3(qw * 0.5 + 9.1));
    vec2 qq = qw + (w2 - 0.5) * 2.2;
    float ridge = 1.0 - abs(2.0 * fbm3(qq * 0.45) - 1.0);
    float ridge2 = 1.0 - abs(2.0 * fbm3(qq * 1.1 + 4.4) - 1.0);
    float near = smoothstep(0.12, 0.03, fp);
    float ridge3 = near > 0.0 ? 1.0 - abs(2.0 * fbm3(qq * 3.2 + 7.7 + w2 * 3.0) - 1.0) : 0.6;
    float walls = fp < 0.05 ? 1.0 - smoothstep(0.0, 0.25, cells(qq * 3.0, uTime * 0.35)) : 0.4;
    float body = fbm3(qw * 0.12 + 11.0);
    // Up close the fine threads and bubbles carry it; the big strokes would read as paint.
    float pattern = clamp(pow(ridge, 3.0) * mix(0.45, 0.22, near) + pow(ridge2, 5.0) * 0.3
                    + mix(0.12, pow(ridge3, 6.0) * 0.5 + walls * 0.2, near)
                    + (body - 0.5) * mix(0.9, 0.6, near) + 0.08, 0.0, 1.0);
    return vec2(pattern, ridge);
}
`;

// Light coming up out of the water toward the viewer (shared by the sea and the breaker).
// Follow the refracted view ray down to the seabed. A ray that runs nearly flat (looking
// through the face of a standing wave) leaves through the back of the wave after 'thick'
// metres instead, and picks up the light coming through it; forceExit = 1 always does (a
// thin lip with air behind it).
export const UNDER_GLSL = /* glsl */ `
uniform vec3 uSkyIrr;        // irradiance from the sky on flat water
uniform vec3 uAbsorb;        // absorption per metre, per channel (red dies first)
uniform vec3 uBackscatter;   // backscattering per metre of clear water
uniform vec3 uSedAbsorb;     // per unit of suspended sand
uniform float uSedBack;      // backscattering per unit of suspended sand (white)
uniform float uGordonF;      // reflectance of deep water = F * bb / (a + bb)
uniform vec3 uSandAlbedo;
uniform vec3 uReefAlbedo;
uniform float uTurbidity;    // stirred-up sand near the surf
uniform float uMurk;         // the milky plumes (sand in the water of the bays)
struct Under { vec3 light; float depth0; float sed; float through; vec3 bb; vec3 K; };
Under underLight(vec2 p, vec4 d, vec3 world, vec3 N, vec3 V, float fp, float shadow, float thick, float forceExit, float simSand, float simW) {
  vec3 L = uSunDir;
  vec3 R = refract(-V, N, 1.0 / 1.333);
  float down = max(-R.y, 0.0);
  float depth0 = max(world.y - d.r, 0.0);
  float tBed = depth0 / max(down, 0.02);
  float tExit = mix(mix(1e4, thick, smoothstep(0.45, 0.08, down)), thick, forceExit);
  float tRay = min(min(tBed, tExit), 60.0);
  float through = smoothstep(0.0, 0.3, (tBed - tExit) / max(tExit, 0.1));
  vec2 bedP = p + vec2(R.x, -R.z) * tRay;
  vec4 bd = dataAt(bedP);
  float depth = mix(max(world.y - bd.r, 0.0), depth0, through);

  // Suspended sand: stirred up where waves break, and hanging in the bays as milky plumes.
  float nearSurf = bd.b * smoothstep(70.0, 4.0, bd.g);
  float cloud = nearSurf > 0.0 || simSand > 0.0 ? fbm3(bedP * 0.03 + vec2(uTime * 0.02, -uTime * 0.015)) : 0.5;
  // The plumes: where the map says there is sand in the water, cut by drifting, warped noise
  // into clouds with billowing edges, thicker in their middles.
  float plume = 0.0;
  if (d.a > 0.001) {
    vec2 pq = p * 0.0055 + vec2(uTime * 0.0006, -uTime * 0.0004);
    vec2 pw = vec2(fbm3(pq * 1.7 + 3.3), fbm3(pq * 1.7 + 8.1));
    float pBig = fbm3(pq + pw * 1.4);
    float pFine = fbm3(p * 0.045 + pw * 3.0 + uTime * 0.003);
    float pEdge = d.a * 1.15 + (pBig - 0.5) * 1.1 + (pFine - 0.5) * 0.35 - 0.12;
    plume = uMurk * smoothstep(0.25, 0.75, pEdge) * (0.55 + 0.6 * pBig);
  }
  // Coarse sand churned up in the surf (beige: the grains absorb some blue) and the fine
  // silt of the plumes (white: it only scatters).
  float churn = mix(uTurbidity * nearSurf * smoothstep(0.2, 0.75, cloud), simSand * uTurbidity * (0.6 + 0.8 * cloud), simW)
              * mix(0.08, 1.0, smoothstep(0.45, 0.85, N.y));
  float sed = churn + plume;

  // Absorption and backscattering, clear water plus sand.
  vec3 a = uAbsorb + churn * uSedAbsorb + plume * 0.012;
  vec3 bb = uBackscatter + sed * uSedBack;
  vec3 K = a + bb;
  vec3 Lr = refract(-L, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  float sunY = max(L.y, 0.0);
  float muS = max(-Lr.y, 0.3);
  vec3 Td = exp(-K * depth / muS);
  vec3 Tv = exp(-K * tRay);

  // Reef and weed: along the foot of the rock, and patches on the sand in the bays.
  float reef = (1.0 - bd.b) * smoothstep(40.0, 2.0, bd.g) * 0.85;
  if (depth > 3.0 && depth < 22.0) reef = max(reef, smoothstep(0.52, 0.7, fbm3(bedP * 0.018 + 4.0)) * smoothstep(3.0, 9.0, depth) * smoothstep(22.0, 12.0, depth));
  vec3 bedAlbedo = mix(uSandAlbedo, uReefAlbedo, reef);
  float causFade = exp(-depth / 4.0) * (1.0 - reef * 0.6) * smoothstep(0.5, 0.08, fp) * (1.0 - clamp(sed * 3.0, 0.0, 1.0));
  float caus = causFade > 0.01 ? mix(1.0, 0.85 + 0.4 * caustics(bedP, uTime * 1.3), causFade) : 1.0;
  vec3 Ebed = uSunIrr * sunY * shadow * caus * Td + uSkyIrr * exp(-K * depth * 1.2);
  vec3 bedRad = bedAlbedo / PI * Ebed;
  vec3 Rout = normalize(vec3(R.x, max(R.y, 0.08), R.z));
  if (through > 0.001) {
    vec3 behind = skyRadiance(Rout) * 0.5 + uSunIrr * shadow * pow(max(dot(Rout, L), 0.0), 3.0) * 0.1;
    bedRad = mix(bedRad, behind, through);
  }
  // The water column: what the water itself sends back (deep water reflectance, Gordon's
  // F bb / (a + bb)), filling in as the bed fades with depth.
  vec3 E = uSunIrr * sunY * mix(0.35, 1.0, shadow) + uSkyIrr;
  vec3 column = uGordonF * bb / K * E / PI;
  vec3 under = bedRad * Tv + column * (1.0 - Tv * mix(Td, vec3(1.0), through));

  return Under(under, depth0, sed, through, bb, K);
}
`;

export const WATER_VERT = /* glsl */ `
${COMMON}
uniform sampler2D uOceanA[4];
uniform float uGridScale;   // spreads the rings out when the camera is high
uniform vec2 uGridRot;      // cos, sin of the grid's turn (its middle segment faces the way the camera looks)
uniform float uGridK;       // ring spacing per metre of distance from the camera
${AERIAL_VERT}
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec2 vGrid;   // rest position on the map: every texture and wave is looked up here
varying vec4 vSeaW;   // ocean cascade weights

// A cascade's displacement, prefiltered to what the grid can draw here: at the mip level
// where a texel is twice the vertex spacing, anything shorter has been averaged away.
vec3 cascadeDisp(sampler2D tex, vec2 p, float L, float spacing) {
  float lod = max(log2(2.0 * spacing * 256.0 / L), 0.0);
  return textureLod(tex, p / L, lod).xyz;
}

void main() {
  vec3 w = position;
  w.xz = vec2(uGridRot.x * w.x - uGridRot.y * w.z, uGridRot.y * w.x + uGridRot.x * w.z) * uGridScale + cameraPosition.xz;
  vec2 p = vec2(w.x, -w.z);
  vGrid = p;
  vec4 d = dataAt(p);
  vec4 sw = seaWeights(p, d);
  vSeaW = sw;
  float spacing = max(length(position.xz), 1.0) * uGridK * uGridScale;
  vec3 D = sw.x * cascadeDisp(uOceanA[0], p, uOceanL.x, spacing)
         + sw.y * cascadeDisp(uOceanA[1], p, uOceanL.y, spacing)
         + sw.z * cascadeDisp(uOceanA[2], p, uOceanL.z, spacing);
  Surf sf = surfAt(p, d);
  w.y = sf.h + D.y;
  w.x += D.x;
  w.z -= D.z;
  // Lean the crest shoreward.
  vec2 toShore = -offshoreAt(p);
  w.xz += vec2(toShore.x, -toShore.y) * sf.lean;
  // The sea curves away with the Earth, so the horizon sits where it really is (0.4 degrees
  // below level from the clifftop) and the haze sees the true distance. Left flat across
  // the island, where the terrain is flat too.
  float far = max(length(w.xz - cameraPosition.xz) - 2000.0, 0.0);
  w.y -= far * far / (2.0 * 6.36e6);
  vWorld = w;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // The rings go all the way round the camera: the half behind it needs no haze.
  vApT = vec3(1.0); vApIns = vec3(0.0);
  if (gl_Position.w > 0.0) aerialVertex(w);
  #include <logdepthbuf_vertex>
}
`;

export const WATER_FRAG = /* glsl */ `
#include <common>
${COMMON}
${SKY_PARS}
${AERIAL_FRAG_PARS}
${SUN_SHADOW_GLSL}
${CLOUD_SHADOW_GLSL}
${FOAM_GLSL}
${UNDER_GLSL}
uniform sampler2D uOceanB[4];
uniform float uOceanTail;    // slope variance of ripples too small for any cascade
uniform float uWhitecaps;
uniform float uFoam;
uniform float uReflSpread;   // scale on the unresolved slope spread used for the reflection
uniform float uWaveMask;     // what a facet that would reflect below the horizon sees, as a share of the horizon sky
uniform sampler2D uSim;      // the foam simulation
uniform vec3 uSimRect;       // its square on the map: x0, y0, size
uniform float uSimOn;
uniform int uDebug;
#include <logdepthbuf_pars_fragment>
varying vec3 vWorld;
varying vec2 vGrid;
varying vec4 vSeaW;

// The open sea at this pixel: mean slope (xy), the spread of slopes too small to see here
// (z, from the mipmaps: mean of the squares minus square of the mean), whitecap foam (w).
vec4 oceanSurface(vec2 p, vec4 sw) {
  vec4 b0 = texture(uOceanB[0], p / uOceanL.x);
  vec4 b1 = texture(uOceanB[1], p / uOceanL.y);
  vec4 b2 = texture(uOceanB[2], p / uOceanL.z);
  vec4 b3 = texture(uOceanB[3], p / uOceanL.w);
  vec2 s = sw.x * b0.xy + sw.y * b1.xy + sw.z * b2.xy + sw.w * b3.xy;
  float v = sw.x * sw.x * max(b0.z - dot(b0.xy, b0.xy), 0.0)
          + sw.y * sw.y * max(b1.z - dot(b1.xy, b1.xy), 0.0)
          + sw.z * sw.z * max(b2.z - dot(b2.xy, b2.xy), 0.0)
          + sw.w * sw.w * (max(b3.z - dot(b3.xy, b3.xy), 0.0) + uOceanTail);
  float foam = max(b1.w * smoothstep(0.5, 1.0, sw.y), b2.w * 0.5 * smoothstep(0.6, 1.1, sw.z)) + b0.w * sw.x * 0.5;
  return vec4(s, v, foam);
}

void main() {
  #include <logdepthbuf_fragment>
  // Evaluate the waves where this point started, not where the waves pushed it, so shading
  // agrees with the geometry.
  vec2 p = vGrid;
  vec4 d = dataAt(p);
  float fp = max(length(fwidth(vWorld.xz)), 0.01);   // metres per pixel
  Surf sf = surfAt(p, d);
  vec4 oc = oceanSurface(p, vSeaW);
  vec4 cd = coastAt(p);
  // The foam simulation (surf-sim.js): foam, churned sand, how fresh the foam is.
  vec2 simUv = (p - uSimRect.xy) / uSimRect.z;
  float simIn = uSimOn * step(0.0, min(min(simUv.x, simUv.y), min(1.0 - simUv.x, 1.0 - simUv.y)));
  float simW = simIn * smoothstep(0.0, 0.04, min(min(simUv.x, simUv.y), min(1.0 - simUv.x, 1.0 - simUv.y)));
  vec4 sim = simIn > 0.0 ? texture(uSim, simUv) : vec4(0.0);

  // Normal: the surf by finite differences, plus the open sea's slopes.
  float e = clamp(fp * 1.5, 0.12, 6.0);
  float hx = surfAt(p + vec2(e, 0.0), dataAt(p + vec2(e, 0.0))).h - sf.h;
  float hy = surfAt(p + vec2(0.0, e), dataAt(p + vec2(0.0, e))).h - sf.h;
  vec2 slope = vec2(hx, hy) / e + oc.xy;
  vec3 N = normalize(vec3(-slope.x, 1.0, slope.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = uSunDir;
  float sub = sqrt(oc.z);   // spread of the slopes this pixel cannot show

  float shadow = bakedShadow(vWorld, 0.05) * cloudShadow(vWorld, uSunDir);

  Under uw = underLight(p, d, vWorld, N, V, fp, shadow, 0.9 + 5.5 * exp(-max(vWorld.y + 0.3, 0.0) * 1.1), 0.0, sim.g, simW);
  vec3 under = uw.light;
  float depth0 = uw.depth0, sed = uw.sed, through = uw.through;
  vec3 bb = uw.bb, K = uw.K;
  float sunY = max(L.y, 0.0);

  // Surface reflection and the sun glint.
  float NoV = max(dot(N, V), 1e-3);
  float F;
  vec3 refl;
  if (sub < 0.015) {
    F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
    vec3 Rd = reflect(-V, N);
    Rd.y = abs(Rd.y);
    refl = skyRadiance(Rd);
  } else {
    // Waves smaller than the pixel: the pixel sees many little mirrors whose slopes spread
    // by 'sub' around the mean. Four of them (the corners of that spread, which carry its
    // variance), each weighted by how much of it faces the camera, each with its own
    // Fresnel and its own patch of sky. Facets tilted toward the camera are seen more and
    // reflect higher sky; ones that would reflect below the horizon see other waves.
    vec2 hv = normalize(vec2(V.x, -V.z) + vec2(1e-5, 0.0));   // toward the camera, on the map
    vec2 hp = vec2(-hv.y, hv.x);
    float sa = sub * 0.7071 * uReflSpread;
    float wsum = 0.0, fsum = 0.0;
    vec3 lsum = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(k < 2 ? -1.0 : 1.0, (k == 0 || k == 2) ? -1.0 : 1.0) * sa;
      vec2 sl = slope + hv * o.x + hp * o.y;
      vec3 n = normalize(vec3(-sl.x, 1.0, sl.y));
      float nv = dot(n, V);
      if (nv <= 0.0) continue;
      float w = nv / n.y;
      float f = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
      vec3 rd = reflect(-V, n);
      float seen = smoothstep(-0.05, 0.03, rd.y);
      rd.y = max(rd.y, 0.01);
      vec3 l = mix(skyRadiance(vec3(rd.x, 0.02, rd.z)) * uWaveMask, skyRadiance(rd), seen);
      wsum += w; fsum += w * f; lsum += w * f * l;
    }
    F = fsum / max(wsum, 1e-4);
    refl = lsum / max(fsum, 1e-5);
  }

  float rough = clamp(sqrt(0.0025 + oc.z) + fp * 0.002, 0.05, 0.6);
  float a2 = rough * rough;
  vec3 Hh = normalize(V + L);
  float NoH = max(dot(N, Hh), 0.0);
  float NoL = max(dot(N, L), 0.0);
  float D = a2 / (PI * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
  float k = rough * 0.5;
  float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 spec = uSunIrr * shadow * D * Fs * G / (4.0 * NoV + 1e-4);

  vec3 col = under * (1.0 - F) + refl * F + spec;

  // Sunlight through the thin top of a steep wave.
  float crestGlow = smoothstep(0.3, 1.4, sf.h) * pow(1.0 - NoV, 1.5);
  col += uGordonF * bb / K * uSunIrr * sunY * shadow * crestGlow * 0.5;

  // Foam: a lacy pattern thresholded by how much foam this spot should have.
  float older = mix(max(sf.foam, rockFoamBand(p, d, cd)), sim.r, simW);
  float amount = clamp(max(sf.fresh, older) * uFoam, 0.0, 1.0);
  float fresh = max(sf.fresh, smoothstep(0.25, 0.9, sim.r) * simW);
  float caps = clamp(oc.w * uWhitecaps, 0.0, 1.0);
  // Foam lace, drawn where the foam started from (the simulation carries that along), so it
  // stretches into streaks with the water. Bubbles in cells, the foam along their walls,
  // warped so no two cells match, and a slower variation in how dense it is.
  float pattern = 0.0, ridge = 0.0;
  vec2 travel = sim.ba * simW;
  if (amount > 0.002 || caps > 0.002) {
    // On a steep face the ground position barely changes going up, so fold the height in.
    vec2 lp = lacePattern(p - travel + vec2(1.7, -1.3) * vWorld.y, fp);
    pattern = lp.x; ridge = lp.y;
  }
  float soft = clamp(fwidth(pattern) * 1.5, 0.02, 0.15);
  float lace = smoothstep(1.0 - amount - soft, 1.0 - amount + soft, pattern);
  // Fresh foam is a thick, lumpy body torn by a few holes; older foam is lace.
  float lumps = 0.5;
  if (fresh > 0.01) {
    vec2 pl = p - travel;
    lumps = fbm3(pl * 1.6 + vec2(uTime * 0.4, 0.0)) * 0.6 + vnoise(pl * 5.0 - uTime * 0.6) * 0.4;
    lace = max(lace, fresh * smoothstep(0.18, 0.42, lumps + fresh * 0.25 + pattern * 0.2));
  }
  float foam = mix(lace, amount * 0.8, smoothstep(0.25, 1.5, fp)) * smoothstep(0.0, 0.06, amount);
  foam = max(foam, smoothstep(0.9, 1.05, amount));
  // Whitecaps: bright where the crest is breaking now, thinning into streaks as the foam ages.
  float capLace = smoothstep(1.0 - caps - 0.1, 1.0 - caps + 0.25, mix(pattern, 0.6, smoothstep(0.1, 0.6, fp)));
  foam = max(foam, capLace * smoothstep(0.02, 0.3, caps) * 0.9);
  // The swash leaves a thin, bright line where its edge runs up the sand.
  float film0 = vWorld.y - d.r;
  float edge = smoothstep(0.0, 0.012, film0) * (1.0 - smoothstep(0.02, 0.08, film0)) * d.b;
  foam = max(foam, edge * 0.85 * (0.6 + 0.4 * (edge > 0.0 ? vnoise(p * 1.7) : 0.0)));
  // Thin old foam lets the water show through; sand in the break stains it beige.
  vec3 foamAlb = mix(vec3(0.8), vec3(0.7, 0.66, 0.56), clamp(sim.g * simW * 0.5, 0.0, 0.4));
  // Thick fresh foam is a heap of lumps that shade each other and face the sun or not;
  // old foam is a flat film with a little texture.
  // (Relief only where a pixel is small enough to show it: further off it is just noise.)
  float relW = fresh * smoothstep(0.25, 0.04, fp);
  vec3 rel = relW > 0.01 ? foamRelief(p - travel, fp, uTime) : vec3(1.0, 0.0, 0.0);
  vec3 Nf = normalize(N + vec3(-rel.y, 0.0, rel.z) * relW);
  float heap = mix(1.0, 0.8 + 0.25 * pattern, 1.0 - fresh);
  vec3 foamRad = foamAlb * heap / PI * (uSunIrr * max(dot(Nf, L), 0.15) * shadow + uSkyIrr);
  // In the crevices between lumps: shaded foam and the water showing through, not dirt.
  foamRad = mix(mix(col, foamRad * 0.45, 0.5), foamRad, mix(1.0, rel.x, relW));
  // Old foam is a thin film of bubbles: up close the water shows through it.
  float thinFilm = mix(mix(0.55, 0.75, smoothstep(0.01, 0.08, fp)), 1.0, max(fresh, smoothstep(0.3, 0.8, amount)));
  col = mix(col, foamRad, foam * thinFilm);

  // Fade out over the last few centimetres so the wet sand shows through the swash.
  float film = vWorld.y - d.r;
  float alpha = max(smoothstep(0.0, 0.12, film), foam * smoothstep(0.0, 0.03, film));

  gl_FragColor = vec4(col * vApT + vApIns, alpha);
  // Debug views skip the exposure and tone curve so their values read straight (4: the light
  // from under the surface, is scaled to the same exposure by hand).
  if (uDebug > 0 && uDebug != 4) {
    if (uDebug == 1) gl_FragColor = vec4(vec3(sed), 1.0);
  if (uDebug == 2) gl_FragColor = vec4(vec3(through), 1.0);
  if (uDebug == 3) gl_FragColor = vec4(amount, caps, fresh, 1.0);
  if (uDebug == 8) gl_FragColor = vec4(sim.rg, length(sim.ba) * 0.05, 1.0);
  if (uDebug == 4) gl_FragColor = vec4(under, 1.0);
  if (uDebug == 5) gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
  if (uDebug == 6) gl_FragColor = vec4(vec3(sub * 4.0), 1.0);
  if (uDebug == 7) { vec4 cd = coastAt(p); gl_FragColor = vec4(smoothstep(30.0, 0.0, cd.r) * cd.a, cd.g, cd.b, 1.0); }
    return;
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Label: water (2), distance, and whether the bed is shallow enough to show.
  if (uLabel > 0.5) {
    float dist = log2(max(distance(vWorld, cameraPosition), 1.0)) / 20.0;
    gl_FragColor = vec4(2.0 / 255.0, dist, depth0 < 12.0 ? 1.0 : 0.0, 1.0);
  }
}
`;
