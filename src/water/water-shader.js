import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { SKY_PARS, AERIAL_VERT, AERIAL_FRAG_PARS } from '../sky/atmosphere-glsl.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';
import { SWASH_GLSL } from './swash.js';

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
uniform vec2 uSwellDir;    // direction the swell travels, local
uniform vec4 uOceanL;      // patch size of each ocean cascade (m)
uniform vec4 uGust;        // gust pattern: scale (1/m), drift east and north (m/s), strength
uniform float uBreakerOn;  // 1 when the breaker mesh is drawn (the heightfield tucks its breaking crests away)

const vec4 OCEAN = vec4(-45.0, 900.0, 0.0, 0.0);
${SWASH_GLSL}

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
#ifdef GUST_FULL
  float gust = mix(1.0, 0.45 + 1.1 * fbm3(q + vec2(3.1, 7.7)), uGust.w);
  float gustS = mix(1.0, 0.55 + 0.9 * fbm3(q * 3.1 + 11.0), uGust.w);
#else
  // Two octaves are plenty for patches hundreds of metres across (this runs per vertex).
  float gust = mix(1.0, 0.45 + 1.1 * (0.67 * vnoise(q + vec2(3.1, 7.7)) + 0.33 * vnoise(q * 2.03 + 20.2)), uGust.w);
  float gustS = mix(1.0, 0.55 + 0.9 * vnoise(q * 3.1 + 11.0), uGust.w);
#endif
  return vec4(swell, wind * mix(1.0, gust, 0.6), ripple * gust * gustS, ripple * gust * gustS);
}

// Waves slow down and bunch up in shallow water. With a wavelength that grows linearly
// with distance offshore (L = L0 + b s) the phase is the integral of 1/L. For 9 s waves:
// T sqrt(g h) is about 23 m in 0.7 m of water, 44 m at 2.5 m, 90 m at 10 m, so one or two
// crests in the surf zone, running in at about 3 m/s.
const float L0 = 22.0;
const float LB = 0.7;
float shorePhase(float s) { return log(1.0 + LB * max(s, 0.0) / L0) / LB; }

// (The wave clock and the sizes of the waves in a set are in swash.js, which the ground
// shares.)

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
  // The swash sheet on the sand (swash.js), where it is the water's surface:
  float sheet;    // how much the sheet makes the surface here (0..1)
  float film;     // its thickness (m)
  float front;    // the foamy front of an uprush
  float swVel;    // its speed up the beach (m/s, negative in the backwash)
  float swUp;     // 1 running up, 0 running back
  float edgeZ;    // how far above this spot the sheet's edge is (swash.js), and the front's
  float frontZ;
};

// The swash sheet is only worked out when this is set (the vertex shader's slope samples
// leave it out: the sheet lies on the sand, so its slope is the sand's).
bool gSwash = true;
Surf surfAt(vec2 p, vec4 d) {
  Surf o = Surf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, -1.0);   // L = 0: no surf here
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
  float win = smoothstep(-0.17, -0.12, v) * (1.0 - smoothstep(0.25, 0.34, v));
  // (Inside the stretch where the ribbon is fully up, so the sea never shows a half-tucked,
  // flattened crest: breaker.js rises from -0.08 and stays until 1.12.)
  float sink = win * smoothstep(0.02, 0.1, tau) * (1.0 - smoothstep(0.86, 0.98, tau)) * beachy * uBreakerOn;
  float hRaw = max(Ak * crest - 0.28 * A, -0.45 * depthHere);
  float h = max(Ak * crest * (1.0 - sink) - 0.28 * A - 0.05 * sink, -0.45 * depthHere);
  // Only a slight lean. A heightfield cannot curl over (the lip is its own mesh, breaker.js),
  // and squeezing the front into a few grid rows turns it into a staircase of teeth.
  float lean = Ak * 0.1 * crest * smoothstep(br + 25.0, br, s) * (1.0 - broken);

  // (The white lip drawn on the heightfield's own crest, from before the breaker existed.
  // Where the breaker draws the lip, this only laid a milky veil over the rising crest just
  // before the breaker took over, so it is nearly off then.)
  float lip = crest * smoothstep(br + 6.0, br - 1.0, s) * smoothstep(0.1, -0.01, v) * (1.0 - 0.9 * uBreakerOn);
  // The bore: a white front, the turbulent roller behind it churning for several metres
  // (v9: a band a fifth of a wavelength deep, where it was a metre or two), then foam that
  // thins into lace.
  // (Its leading edge ragged: lobes a metre or two across.)
  // (Only inside the break: this runs for every point near a beach, three times per vertex.)
  float vr = broken > 0.0 && abs(v) < 0.1 ? v + (vnoise(p * 0.45 + idx * 3.3) - 0.5) * 0.05 + (vnoise(p * 1.3) - 0.5) * 0.02 : v;
  float front = broken * smoothstep(-0.03, 0.0, vr) * (1.0 - smoothstep(0.05, 0.22, v)) * mix(0.7, 1.0, smoothstep(0.15, 0.0, v));
  float trail = broken * 0.8 * exp(-max(v, 0.0) / 0.3) * step(0.0, v);
  float resid = smoothstep(br + 14.0, 0.0, s) * 0.2;

  float sz = mix(0.85, 1.1, big) * offshoreFade;
  o.h = h * offshoreFade;
  // On the sand the surf's own wave train stops (its phase no longer changes there, so it
  // would flood the whole beach at once); the swash sheet takes over.
  float onLand = smoothstep(0.0, -1.2, s);
  o.h = mix(o.h, min(o.h, -0.6), onLand);
  // (Only the sea's vertex shader reads the swash map: every other shader that shares this
  // would need another texture unit, and the sea's fragment shader already uses 16.)
#if !defined(SWASH_READ) || defined(SKIP_SWASH)
  if (false) {
    vec4 sm = vec4(-1.0, -1.0, -60.0, 0.0);
#else
  if (gSwash && d.r > SW_RUNDOWN - 0.3 && d.r < uRunup * 1.6 + 0.3) {
    vec4 sm = swashMap(p);
#endif
    float film = max(sm.z, 0.0);
    // Its surface: the sand plus the water on it, and past its edge diving under the sand.
    float sheetH = d.r + (sm.x > 0.0 ? film : sm.x) - (1.0 - beachy) * 0.5;
    if (sheetH > o.h) {
      o.sheet = smoothstep(o.h, o.h + 0.02, sheetH) * beachy;
      o.h = sheetH;
    }
    o.film = film * beachy;
    o.front = swashFront(sm.y) * beachy;
    o.swVel = sm.w;
    o.swUp = step(0.0, sm.w);
    o.edgeZ = sm.x;
    o.frontZ = sm.y;
  }
  o.lean = lean * offshoreFade;
  // (On the sand the wave train's phase stops changing, so its bore front would light up the
  // whole beach at once as each crest passed: none of it there, the swash has its own.)
  float sea = smoothstep(-1.0, 0.0, s);
  o.fresh = max(lip, front * 1.1) * sz * sea;
  o.foam = max(trail, resid) * sz * sea;
  o.push = broken * smoothstep(-0.03, 0.0, v) * exp(-max(v, 0.0) / 0.1) * offshoreFade * sea;
  o.broken = broken * offshoreFade * sea;
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
  float width = 4.0 + 26.0 * exposed + 10.0 * vnoise(p * 0.04);
  float band = smoothstep(width, 0.0, c.r);
  float patchy = smoothstep(0.2, 0.7, fbm3(p * 0.09 + vec2(uTime * 0.1, 0.0)));
  float rock = c.a * (0.5 + 0.5 * pulse) * (0.35 + 0.75 * exposed) * mix(band * band, band, patchy);
  // Streaks of old foam drifting off the rock with the wind: noise stretched downwind, so
  // they lie parallel (wind rows), as foam lines on the sea do.
  if (c.a > 0.5 && c.r < 110.0) {
    const vec2 wdir = vec2(-0.866, 0.5), wperp = vec2(-0.5, -0.866);   // toward 300 degrees
    vec2 q = vec2(dot(p, wperp) * 0.09, dot(p, wdir) * 0.012 - uTime * 0.01);
    float streak = smoothstep(0.55, 0.85, vnoise(q) * 0.7 + vnoise(q * 3.1 + 5.0) * 0.3);
    rock = max(rock, streak * smoothstep(110.0, 15.0, c.r) * smoothstep(0.2, 0.7, exposed) * 0.45);
  }
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
// The same cell edges, searched over the four nearest cells instead of nine (v9, for the lace,
// which runs on every pixel of foam): the points stay within the middle of their cells, so
// the nearest two are almost always among those four.
float cells4(vec2 p, float t) {
  vec2 ip = floor(p), fp = fract(p);
  vec2 o0 = step(0.5, fp) - 1.0;
  float f1 = 9.0, f2 = 9.0;
  for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
    vec2 g = o0 + vec2(float(i), float(j));
    vec2 h = vec2(hash12(ip + g), hash12(ip + g + 19.19));
    vec2 o = 0.5 + 0.3 * sin(t + 6.2831 * h);
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
float reliefH(vec2 q, vec2 o, float fine, float fine2) {
  // Rotated octaves so the value noise's grid does not show as blocks.
  const mat2 R1 = mat2(0.8, -0.6, 0.6, 0.8), R2 = mat2(0.28, -0.96, 0.96, 0.28);
  float h = vnoise(q * 1.1 + o) * 0.5 + vnoise(R1 * q * 2.9 + 3.1 - o) * 0.32 + vnoise(R2 * q * 7.3 + 9.2) * 0.18 * fine;
  // (v5) Clumps of bubbles a few centimetres across, where a pixel is a few millimetres: the
  // swash's foam is seen from a couple of metres away.
  if (fine2 > 0.0) h += (vnoise(R1 * q * 21.0 + 5.7 + o * 2.0) - 0.5) * 0.14 * fine2 + (vnoise(R2 * q * 53.0 + 1.9) - 0.5) * 0.08 * fine2;
  return h;
}
vec3 foamRelief(vec2 q, float fp, float t) {
  vec2 o = vec2(t * 0.35, -t * 0.2);
  float fine = smoothstep(0.08, 0.02, fp);
  float fine2 = smoothstep(0.02, 0.008, fp);
  // The step for the slope follows the finest detail drawn.
  float e = mix(0.12, 0.008, fine2);
  float h0 = reliefH(q, o, fine, fine2);
  vec2 g = vec2(reliefH(q + vec2(e, 0.0), o, fine, fine2) - h0, reliefH(q + vec2(0.0, e), o, fine, fine2) - h0) / e;
  return vec3(mix(0.3, 1.0, smoothstep(0.34, 0.62, h0)), g * mix(0.6, 0.25, fine2));
}

// Foam lace at a map position (v9): a web. Foam gathers on the walls between cells of clear
// water (the bubbles' own cells, blown up to a metre or two by the flow), so thin foam is a net
// of lines with holes and denser foam is the same net with its walls thickened until the holes
// close. Two sizes of cells, warped so no two match and bent along slow swirls, in patches
// that come and go. (v4 to v8 drew ridges of warped noise here, which read as marbled paint
// from above.) Returns the pattern (x: foam appears where it is above 1 - amount) and the
// walls alone (y).
vec2 lacePattern(vec2 pf, float fp) {
    vec2 q = pf;
    vec2 w1 = vec2(vnoise(q * 0.12 + vec2(0.0, uTime * 0.02)), vnoise(q * 0.12 + vec2(5.2, 1.3) - uTime * 0.017)) - 0.5;
    vec2 qw = q + w1 * 4.5;
    // A finer warp bends the walls, so they wander instead of running straight cell to cell.
    // A middle warp bends each wall into a curve (at the scale of a cell, so it bends rather
    // than shears).
    vec2 w2 = vec2(vnoise(qw * 0.3 + 2.7), vnoise(qw * 0.3 + 9.1)) - 0.5;
    vec2 qq = qw + w2 * 1.6;
    // Cell walls: 1 on a wall, falling to 0 inside a cell. Cells about 2.2 m and 1.2 m
    // across, one or the other in patches (so the lace is coarse in places, fine in others),
    // and a finer net of 0.5 m cells through both.
    float coarse = smoothstep(0.42, 0.58, vnoise(qw * 0.07 + 8.8));
    // (Thin walls: a thread of foam, not a band. The pattern's threshold widens them as the
    // foam gets thicker. Each size only where it shows.)
    float c1 = fp < 0.6 && coarse > 0.0 ? 1.0 - smoothstep(0.0, 0.3, cells4(qq * 0.45, uTime * 0.1)) : 0.3;
    float c2 = fp < 0.4 && coarse < 1.0 ? 1.0 - smoothstep(0.0, 0.3, cells4(qq * 0.85 + 5.3, uTime * 0.12)) : 0.3;
    float big = mix(c2, c1, coarse);
    float small = fp < 0.22 ? 1.0 - smoothstep(0.0, 0.3, cells4(qq * 2.0 + 3.1, uTime * 0.16)) : 0.28;
    // Finer threads and bubbles up close.
    float near = smoothstep(0.06, 0.02, fp);
    float tiny = near > 0.0 ? 1.0 - smoothstep(0.0, 0.35, cells4(qq * 6.0 + 7.7, uTime * 0.3)) : 0.35;
    float walls = max(big, small * 0.8);
    walls = mix(walls, max(walls, tiny * 0.7), near);
    // The threads break up into strings of bubble clumps.
    float clumps = fp < 0.3 ? vnoise(qq * 3.3 + 1.9) * 0.6 + vnoise(qq * 8.1 + 6.2) * 0.4 : 0.5;
    walls *= mix(0.62, 1.12, clumps);
    // Where it is thick and where it is thin: patches a few metres across.
    float body = fbm3(qw * 0.1 + 11.0) * 0.7 + vnoise(qq * 0.33 + 4.4) * 0.3;
    float pattern = clamp(walls * 0.7 + (body - 0.5) * 0.85 + 0.1, 0.0, 1.0);
    return vec2(pattern, walls);
}

// Foam on the swash (v5), as cover for a given amount of foam. From above in the photos
// (topdown-foam-sand.jpg) it is blobs and streaks of bubbles, stretched along the flow (most
// in the backwash), in patches a metre or two across, with clear water between; as it thins
// the blobs open up into a net of bubble walls with holes. up: the way up the beach, str: how
// much the flow stretches it.
float swashCover(vec2 q, vec2 up, float str, float amount, float fp) {
  vec2 qa = vec2(dot(q, up), dot(q, vec2(-up.y, up.x)));
  qa.x /= 1.0 + str;
  float body = fbm3(q * 0.5 + 4.1) * 0.55 + fbm3(qa * 2.2 + 9.7) * 0.45;
  float fine = fp < 0.03 ? vnoise(qa * 9.0 + 2.7) : 0.5;
  float base = body + (fine - 0.5) * 0.18 * smoothstep(0.03, 0.012, fp);
  float soft = clamp(fwidth(base) * 1.5, 0.015, 0.12);
  float cover = smoothstep(1.0 - amount - soft, 1.0 - amount + soft, base);
  // Holes where it thins: bubble walls between them (warped cells, two sizes).
  float thin = cover * (1.0 - smoothstep(0.55, 0.9, amount));
  if (thin > 0.01 && fp < 0.035) {
    vec2 qw = qa + (vec2(vnoise(qa * 1.9 + 1.3), vnoise(qa * 1.9 + 7.9)) - 0.5) * 0.7;
    float w1 = 1.0 - smoothstep(0.0, 0.28, cells(qw * 3.4, uTime * 0.4));
    float w2 = fp < 0.018 ? 1.0 - smoothstep(0.0, 0.3, cells(qw * 9.5 + 3.1, uTime * 0.7)) : 0.5;
    float walls = max(w1, w2 * 0.8);
    float k = smoothstep(0.035, 0.018, fp);
    cover *= mix(1.0, walls, thin * k * smoothstep(1.0 - amount + 0.25, 1.0 - amount, base) * 0.9);
  }
  return cover;
}

float swashLace(vec2 q, float fp) {
  // Patches: a metre or two across, and within them clumps of a few decimetres.
  float body = fbm3(q * 0.55 + 4.1) * 0.65 + fbm3(q * 2.3 + 9.7) * 0.35;
  // The cells are warped, so they are not a tiling of even polygons.
  vec2 qw = q + (vec2(vnoise(q * 1.9 + 1.3), vnoise(q * 1.9 + 7.9)) - 0.5) * 0.7;
  float k1 = smoothstep(0.06, 0.03, fp), k2 = smoothstep(0.025, 0.012, fp);
  float c1 = k1 > 0.0 ? 1.0 - smoothstep(0.0, 0.3, cells(qw * 3.2, uTime * 0.4)) : 0.3;
  float c2 = k2 > 0.0 ? 1.0 - smoothstep(0.0, 0.3, cells(qw * 9.0 + 3.1, uTime * 0.7)) : 0.3;
  c1 = mix(0.3, c1, k1); c2 = mix(0.3, c2, k2);
  float grain = fp < 0.01 ? (vnoise(q * 55.0) - 0.5) * smoothstep(0.01, 0.004, fp) : 0.0;
  // The net shows most where the foam is patchy (body in the middle); inside a thick patch it
  // closes up, outside one it is gone.
  float net = 0.4 * c1 + 0.25 * c2 * (0.5 + c1);
  return clamp((body - 0.5) * 1.6 + 0.5 + (net - 0.24) * smoothstep(0.1, 0.5, body) + grain * 0.18, 0.0, 1.0);
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
// Sand stirred up in the swash, from the foam simulation (as underLight has it where the
// water is clear of the bed's colour).
float simSand(float s, float w) { return s * w * 0.9; }
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
  // The sand stays low: a rising wave's face and crest are clear water drawn up from in front
  // of it, the churned sand is in the bottom of the water and the white water after the break.
  float churn = mix(uTurbidity * nearSurf * smoothstep(0.2, 0.75, cloud), simSand * uTurbidity * (0.6 + 0.8 * cloud), simW)
              * mix(0.08, 1.0, smoothstep(0.45, 0.85, N.y)) * mix(1.0, 0.2, smoothstep(0.15, 0.9, world.y));
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
    // Out through the back of the wave. A ray that meets the back surface at a grazing angle
    // mostly reflects back into the water (total internal reflection past about 49 degrees),
    // so the sky only shows through where the ray leaves going up.
    float escape = mix(0.3, 1.0, smoothstep(0.02, 0.45, R.y));
    vec3 bb0 = uBackscatter;
    vec3 behind = (skyRadiance(Rout) * 0.5 + uSunIrr * shadow * pow(max(dot(Rout, L), 0.0), 3.0) * 0.1) * escape
                + (1.0 - escape) * uGordonF * bb0 / (uAbsorb + bb0) * (uSunIrr * max(L.y, 0.0) + uSkyIrr) / PI;
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

// The surface as the sea and the breaker both see it (shared so the two cannot drift apart:
// they sit side by side at every breaking wave).
export const SURFACE_GLSL = /* glsl */ `
uniform sampler2D uOceanB[4];
uniform float uOceanTail;    // slope variance of ripples too small for any cascade
uniform float uReflSpread;   // scale on the unresolved slope spread used for the reflection
uniform float uWaveMask;     // what a facet that would reflect below the horizon sees, as a share of the horizon sky
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

// Reflection of a surface whose waves are partly smaller than the pixel: the pixel sees many
// little mirrors whose normals spread by 'sub' round the mean N0. Four of them (the corners
// of that spread, which carry its variance), each weighted by how much of it faces the
// camera, each with its own Fresnel and its own patch of sky. Facets tilted toward the camera
// are seen more and reflect higher sky; ones that would reflect below the horizon see other
// waves. Tilted in N0's own tangent plane, so it works on a wave's face as on flat sea.
void roughReflect(vec3 N0, vec3 V, float sub, out float F, out vec3 refl) {
  float NoV = max(dot(N0, V), 1e-3);
  if (sub < 0.015) {
    F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
    vec3 Rd = reflect(-V, N0);
    Rd.y = abs(Rd.y);
    refl = skyRadiance(Rd);
    return;
  }
  vec3 t = V - N0 * dot(V, N0);
  t = dot(t, t) > 1e-8 ? normalize(t) : normalize(cross(N0, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(N0, t);
  float sa = sub * 0.7071 * uReflSpread;
  float wsum = 0.0, fsum = 0.0;
  vec3 lsum = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(k < 2 ? -1.0 : 1.0, (k == 0 || k == 2) ? -1.0 : 1.0) * sa;
    vec3 n = normalize(N0 + t * o.x + b * o.y);
    float nv = dot(n, V);
    if (nv <= 0.0) continue;
    float w = nv / max(dot(n, N0), 1e-3);
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
`;

export const WATER_VERT = /* glsl */ `
#define SWASH_READ
${COMMON}
// (Three of the four cascades: the finest is never displaced, and the sampler this saves
// lets the vertex shader read the swash map within the 16 texture units. water.js hands
// them over as their own uniform: three.js allocates units by the length of the array it is
// given, not by the shader's.)
uniform sampler2D uOceanV[3];
uniform float uGridScale;   // spreads the rings out when the camera is high
uniform vec2 uGridRot;      // cos, sin of the grid's turn (its middle segment faces the way the camera looks)
uniform float uGridK;       // ring spacing per metre of distance from the camera
${AERIAL_VERT}
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec2 vGrid;   // rest position on the map: every texture and wave is looked up here
varying vec4 vSeaW;   // ocean cascade weights
varying vec2 vSurfSlope;  // the surf's slope (map x, y)
varying vec4 vSheetA;     // the swash sheet: how much it is the surface, thickness, edge, front
varying vec2 vSheetB;     // its speed up the beach, and whether it is running up

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
  float spacing = max(length(position.xz), 1.0) * uGridK * uGridScale;
#ifdef NO_VSURF
  Surf sf = Surf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, -1.0);
#else
  Surf sf = surfAt(p, d);
#endif
  // The swash for the fragment shader, which does not work it out again.
  vSheetA = vec4(sf.sheet, sf.film, sf.edgeZ, sf.frontZ);
  vSheetB = vec2(sf.swVel, sf.swUp);
  // The swash sheet is a few centimetres of water on the sand: the open sea's waves do not
  // ride on it (it gets its own ripples in the fragment shader).
  sw *= 1.0 - sf.sheet;
  vSeaW = sw;
  // Each cascade only where it adds something: the swell is gone in the surf zone, and a
  // cascade whose patch is less than eight vertices across has been averaged away.
  vec3 D = vec3(0.0);
#ifndef NO_DISP
  if (sw.x > 0.001) D += sw.x * cascadeDisp(uOceanV[0], p, uOceanL.x, spacing);
  if (sw.y > 0.001 && spacing < uOceanL.y / 8.0) D += sw.y * cascadeDisp(uOceanV[1], p, uOceanL.y, spacing);
  if (sw.z > 0.001 && spacing < uOceanL.z / 8.0) D += sw.z * cascadeDisp(uOceanV[2], p, uOceanL.z, spacing);
#endif
  // The surf's slope for the fragment shader, by differences over the local vertex spacing.
  float se = clamp(spacing, 0.12, 6.0);
#ifdef NO_VSLOPE
  vSurfSlope = vec2(0.0);
#else
  if (sf.L > 0.0) {
    vec4 dx = dataAt(p + vec2(se, 0.0)), dy = dataAt(p + vec2(0.0, se));
    gSwash = false;
    float hx = surfAt(p + vec2(se, 0.0), dx).h, hy = surfAt(p + vec2(0.0, se), dy).h;
    gSwash = true;
    // On the sheet, the sand's own slope.
    vSurfSlope = mix(vec2(hx - sf.h, hy - sf.h), vec2(dx.r - d.r, dy.r - d.r), sf.sheet) / se;
  } else vSurfSlope = vec2(0.0);
#endif
  // Beyond the sheet's edge the surface dives under the sand, but only after a few millimetres
  // above it, so the geometry always covers where the fragment shader finds water (it works
  // out the edge per pixel).
  // (v9) The bore is a churning heap, not a flat sheet with white on it: its white water
  // stands up in lumps a metre or so across, up to a couple of decimetres, drifting shoreward
  // with it. Only near the camera, where there are vertices enough to draw it.
  float heapA = (1.0 - sf.sheet) * (sf.fresh * 0.22 + sf.push * 0.08) * (1.0 - smoothstep(20.0, 60.0, spacing * 400.0));
  if (heapA > 0.002) {
    vec2 hq = p - offshoreAt(p) * uTime * 1.2;
    float h0 = vnoise(hq * 0.8) * 0.65 + vnoise(hq * 2.1 + 5.0) * 0.35;
    float hx = vnoise((hq + vec2(0.15, 0.0)) * 0.8) * 0.65 + vnoise((hq + vec2(0.15, 0.0)) * 2.1 + 5.0) * 0.35;
    float hy = vnoise((hq + vec2(0.0, 0.15)) * 0.8) * 0.65 + vnoise((hq + vec2(0.0, 0.15)) * 2.1 + 5.0) * 0.35;
    sf.h += heapA * (h0 - 0.35);
    vSurfSlope += heapA * vec2(hx - h0, hy - h0) / 0.15;
  }
  float fv = sf.h - d.r;
  w.y = mix(sf.h + D.y, d.r + max(fv, 0.0) + 0.004 - 0.1 * smoothstep(-0.04, -0.12, fv), sf.sheet);
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
${SURFACE_GLSL}
uniform float uWhitecaps;
uniform float uFoam;
uniform sampler2D uSim;      // the foam simulation
uniform vec3 uSimRect;       // its square on the map: x0, y0, size
uniform float uSimOn;
uniform int uDebug;
uniform vec3 uWetSandAlb;    // the sand under the swash, wet (linear albedo, from the ground)
#include <logdepthbuf_pars_fragment>
varying vec3 vWorld;
varying vec2 vGrid;
varying vec4 vSeaW;
varying vec2 vSurfSlope;
varying vec4 vSheetA;
varying vec2 vSheetB;


void main() {
  #include <logdepthbuf_fragment>
#ifdef FRAG_FLAT
  gl_FragColor = vec4(0.05, 0.2, 0.3, 1.0);
  return;
#endif
  // Evaluate the waves where this point started, not where the waves pushed it, so shading
  // agrees with the geometry.
  vec2 p = vGrid;
  vec4 d = dataAt(p);
  float fp = max(length(fwidth(vWorld.xz)), 0.01);   // metres per pixel
  // The surf here, and the swash sheet from the vertices (its edge and front interpolate
  // exactly: see swash.js).
  gSwash = false;
  // On the sheet over the sand there is no surf to work out.
  Surf sf = Surf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, -1.0);
  if (vSheetA.x < 0.99 || d.g > -1.0) sf = surfAt(p, d);
  sf.sheet = vSheetA.x; sf.film = vSheetA.y; sf.swVel = vSheetB.x; sf.swUp = vSheetB.y;
  sf.front = sf.sheet * swashFront(vSheetA.w);
  if (sf.sheet > 0.0) sf.h = mix(sf.h, d.r + sf.film, sf.sheet);
  // (No reads of the ocean cascades where none of them rides, as on the swash sheet.)
  vec4 oc = dot(vSeaW, vec4(1.0)) > 1e-3 ? oceanSurface(p, vSeaW) : vec4(0.0);
  vec4 cd = coastAt(p);
  // The foam simulation (surf-sim.js): foam, churned sand, how fresh the foam is.
  vec2 simUv = (p - uSimRect.xy) / uSimRect.z;
  float simIn = uSimOn * step(0.0, min(min(simUv.x, simUv.y), min(1.0 - simUv.x, 1.0 - simUv.y)));
  float simW = simIn * smoothstep(0.0, 0.04, min(min(simUv.x, simUv.y), min(1.0 - simUv.x, 1.0 - simUv.y)));
  vec4 sim = simIn > 0.0 ? texture(uSim, simUv) : vec4(0.0);

  // Normal: the surf by finite differences, plus the open sea's slopes.
  float e = clamp(fp * 1.5, 0.12, 6.0);
#ifdef SURF_NORMAL_PIXEL
  float hx = surfAt(p + vec2(e, 0.0), dataAt(p + vec2(e, 0.0))).h - sf.h;
  float hy = surfAt(p + vec2(0.0, e), dataAt(p + vec2(0.0, e))).h - sf.h;
  vec2 slope = vec2(hx, hy) / e + oc.xy;
#else
  // The surf's slope comes from the vertices (its waves are metres long; the grid near the
  // camera is a few centimetres to a few decimetres apart).
  vec2 slope = vSurfSlope + oc.xy;
#endif
  // The swash sheet's own ripples: bumpy and turbulent behind the front of an uprush, long
  // streaks along the flow in the backwash, all carried along with the water.
#ifdef SKIP_RIPPLES
  if (false) {
#else
  if (sf.sheet > 0.01) {
#endif
    vec2 up = -offshoreAt(p);
    vec2 q = vec2(dot(p, up), dot(p, vec2(-up.y, up.x)));
    float flow = sf.swVel * uTime;
    vec2 qa = sf.swUp > 0.5 ? vec2(q.x * 3.0 - flow * 3.0, q.y * 3.0) : vec2(q.x * 1.2 - flow * 1.2, q.y * 9.0);
    float ee = 0.35;
    float n0 = fbm3(qa), nx = fbm3(qa + vec2(ee, 0.0)), ny = fbm3(qa + vec2(0.0, ee));
    vec2 g = vec2(nx - n0, ny - n0) / ee;
    g = vec2(g.x * (sf.swUp > 0.5 ? 3.0 : 1.2), g.y * (sf.swUp > 0.5 ? 3.0 : 9.0));
    vec2 gm = up * g.x + vec2(-up.y, up.x) * g.y;
    float amp = mix(0.006, 0.02, sf.swUp) * smoothstep(0.001, 0.015, sf.film) * sf.sheet * smoothstep(0.3, 0.05, fp);
    slope += gm * amp;
  }
  vec3 N = normalize(vec3(-slope.x, 1.0, slope.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = uSunDir;
  float sub = sqrt(oc.z);   // spread of the slopes this pixel cannot show

  float shadow = bakedShadow(vWorld, 0.05) * cloudShadow(vWorld, uSunDir);

  // Thin water on the sand (the swash sheet, under 12 cm) shows the ground's own sand through
  // it (see below), so the sea's model of its bed is not needed there: only the water's own
  // absorption and scattering, with the sand the swash carries.
  float filmE = mix(vWorld.y - d.r, sf.h - d.r, sf.sheet);
  Under uw;
  if (filmE < 0.12 && sf.sheet > 0.99) {
    float churn = simSand(sim.g, simW) * uTurbidity;
    vec3 bbT = uBackscatter + churn * uSedBack;
    uw = Under(vec3(0.0), max(filmE, 0.0), churn, 0.0, bbT, uAbsorb + churn * uSedAbsorb + bbT);
  } else
    uw = underLight(p, d, vWorld, N, V, fp, shadow, 0.9 + 5.5 * exp(-max(vWorld.y + 0.3, 0.0) * 1.1), 0.0, sim.g, simW);
  vec3 under = uw.light;
  float depth0 = uw.depth0, sed = uw.sed, through = uw.through;
  vec3 bb = uw.bb, K = uw.K;
  float sunY = max(L.y, 0.0);

  // Surface reflection and the sun glint.
  float NoV = max(dot(N, V), 1e-3);
  float F;
  vec3 refl;
  roughReflect(N, V, sub, F, refl);

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

  // (v9) Under foam the water is milky: bubbles carried down by the break hang in the top
  // metre and scatter light back up, white, so the water round the lace is pale and hazy, and
  // stays so for a while after the foam on top has thinned (the simulation's foam, softened).
  float bubbles = 0.0;
#ifdef SKIP_MILK
  if (false) {
#else
  if ((simW > 0.0 && sim.r > 0.02) || sf.fresh > 0.0) {
#endif
    float fa = max(sim.r * simW, sf.fresh);
    bubbles = smoothstep(0.02, 0.6, fa) * (0.55 + 0.45 * vnoise((p - sim.ba * simW) * 0.25 + 3.7)) * (1.0 - sf.sheet);
    vec3 milk = uGordonF * 0.5 * (uSunIrr * sunY * mix(0.4, 1.0, shadow) + uSkyIrr) / PI * vec3(0.9, 0.97, 1.0);
    under = mix(under, milk, bubbles * 0.55);
  }
  vec3 col = under * (1.0 - F) + refl * F + spec;

  // Sunlight through the thin top of a steep wave.
  float crestGlow = smoothstep(0.3, 1.4, sf.h) * pow(1.0 - NoV, 1.5);
  col += uGordonF * bb / K * uSunIrr * sunY * shadow * crestGlow * 0.5;

  // Foam: a lacy pattern thresholded by how much foam this spot should have.
  // (The band at the rock only where the simulation does not reach, and there is rock.)
  float older = simW < 0.999 ? mix(max(sf.foam, cd.a > 0.001 ? rockFoamBand(p, d, cd) : 0.0), sim.r, simW) : sim.r;
  // The front of an uprush is a band of foam and bubbles.
  float amount = clamp(max(max(sf.fresh, older), sf.front * 0.92) * uFoam, 0.0, 1.0);
  float fresh = max(sf.fresh, smoothstep(0.45, 0.95, sim.r) * simW);
  float caps = clamp(oc.w * uWhitecaps, 0.0, 1.0);
  // Foam lace, drawn where the foam started from (the simulation carries that along), so it
  // stretches into streaks with the water. Bubbles in cells, the foam along their walls,
  // warped so no two cells match, and a slower variation in how dense it is.
  float pattern = 0.0, ridge = 0.0;
  vec2 travel = sim.ba * simW;
  // On the swash and in the shallows, the net of bubbles.
  float swFoam = smoothstep(1.0, 0.3, vWorld.y - d.r) * smoothstep(0.25, 0.6, d.b) * smoothstep(7.0, 2.0, d.g);
  // (Whitecaps only use the lace up close; further out they take a flat 0.6, v9.)
  if (amount > 0.002 || (caps > 0.002 && fp < 0.6)) {
    // On a steep face the ground position barely changes going up, so fold the height in.
    vec2 lp = swFoam < 0.999 ? lacePattern(p - travel + vec2(1.7, -1.3) * vWorld.y, fp) : vec2(0.0);
    pattern = lp.x; ridge = lp.y;
  }
  float soft = clamp(fwidth(pattern) * 1.5, 0.045, 0.15);
  float lace = smoothstep(1.0 - amount - soft, 1.0 - amount + soft, pattern);
#ifdef SKIP_SWFOAM
  swFoam = 0.0;
#endif
  // On the swash sheet even the thickest foam is a single layer of bubbles, with clear water
  // showing between its clumps: it never closes up into a white carpet.
  float onSheet = swFoam * sf.sheet;
  if (swFoam > 0.001 && amount > 0.002)
    lace = mix(lace, swashCover(p - travel, -offshoreAt(p), sf.swUp > 0.5 ? 0.6 : 2.5, amount * mix(1.0, 0.84, onSheet), fp), swFoam);
  fresh *= 1.0 - 0.8 * onSheet;
  // Fresh foam is a thick, lumpy body torn by a few holes; older foam is lace.
  float lumps = 0.5, lumpsMid = 0.5;
  if (fresh > 0.01) {
    vec2 pl = p - travel;
    // (Each scale only where it shows.)
    if (fp < 0.22) lumps = fbm3(pl * 1.6 + vec2(uTime * 0.4, 0.0)) * 0.6 + vnoise(pl * 5.0 - uTime * 0.6) * 0.4;
    // (v9) Lumps and streaks of a metre to several, for where the small ones are below a pixel.
    if (fp > 0.05) lumpsMid = fbm3(pl * vec2(0.28, 0.5) + vec2(uTime * 0.12, 3.0)) * 0.65 + vnoise(pl * 0.9 - uTime * 0.25) * 0.35;
    float lz = mix(lumpsMid, lumps, smoothstep(0.2, 0.06, fp));
    // (Even the thickest leaves holes: churned water shows between the heaps.)
    lace = max(lace, fresh * smoothstep(0.3, 0.52, lz + fresh * 0.12 + pattern * 0.2));
  }
  // Far off, where the lace is smaller than a pixel, what it covers on average: thin lace is
  // mostly holes (v9: it was taken as 80% of the amount, a white carpet from the clifftop).
  // And even thick white water from the clifftop is streaks and clumps, not a sheet: broken
  // up a few metres across, the more so the thinner it is.
  float farCover = amount * amount * (3.0 - 2.0 * amount) * 0.85;
  float farW = smoothstep(0.3, 1.5, fp);
  float brk = 0.5;
  if (farW > 0.0 && amount > 0.002) {
    vec2 pb = p - travel;
    brk = fbm3(pb * 0.16 + vec2(2.0, 7.0)) * 0.65 + vnoise(pb * 0.45 + 5.0) * 0.35;
    farCover *= clamp(mix(0.25, 0.75, amount) + (brk - 0.5) * mix(2.2, 1.3, amount) + 0.3, 0.0, 1.0);
  }
  float foam = mix(lace, farCover, farW) * smoothstep(0.0, 0.06, amount);
  foam = max(foam, smoothstep(0.9, 1.05, amount) * (1.0 - onSheet) * (1.0 - 0.6 * farW) * mix(0.5, 1.0, farW));
  // Whitecaps: bright where the crest is breaking now, thinning into streaks as the foam ages.
  float capLace = smoothstep(1.0 - caps - 0.1, 1.0 - caps + 0.25, mix(pattern, 0.6, smoothstep(0.1, 0.6, fp)));
  foam = max(foam, capLace * smoothstep(0.02, 0.3, caps) * 0.9);
  // Thin old foam lets the water show through; sand in the break stains it beige.
  vec3 foamAlb = mix(vec3(0.8), vec3(0.7, 0.66, 0.56), clamp(sim.g * simW * 0.5, 0.0, 0.4));
  // Thick fresh foam is a heap of lumps that shade each other and face the sun or not;
  // old foam is a flat film with a little texture.
  // (Relief only where a pixel is small enough to show it: further off it is just noise.)
  float relW = fresh * smoothstep(0.25, 0.04, fp) * (1.0 - 0.75 * onSheet);
  vec3 rel = relW > 0.01 ? foamRelief(p - travel, fp, uTime) : vec3(1.0, 0.0, 0.0);
  vec3 Nf = normalize(N + vec3(-rel.y, 0.0, rel.z) * relW);
  // (Old lace is a thin film of bubbles, greyer than the heaped white water, v9.)
  float heap = mix(1.0, 0.68 + 0.25 * pattern, 1.0 - fresh);
  // (Wrapped: light travels through white water before it comes back out, v9.)
  vec3 foamRad = foamAlb * heap / PI * (uSunIrr * max((dot(Nf, L) + 0.5) / 1.5, 0.15) * shadow + uSkyIrr);
  // In the crevices between lumps the sun does not reach: only the sky above them and the
  // light scattered through the foam around (a fifth of the sun's), with the water showing
  // through. About a tenth of the lit tops, so the heap keeps its shape at noon instead of
  // clipping to a flat white.
  vec3 crevice = foamAlb / PI * (uSunIrr * max(L.y, 0.0) * shadow * 0.2 + uSkyIrr * 0.6);
  foamRad = mix(mix(col, crevice, 0.6), foamRad, mix(1.0, rel.x, relW));
  // Further off, the same lumps a metre to a few across: their shaded sides and the gaps
  // between them. (Dimming the lit foam does nothing at this exposure, it is well above
  // white in the noon sun: the texture has to be shade, a tenth of the light, and water.)
  float midW = smoothstep(0.05, 0.2, fp);
  float gaps = midW * max(fresh, 0.35) * (1.0 - smoothstep(0.28, 0.62, mix(lumpsMid, brk, farW)));
  // Up close, the troughs between the heaps of the bore, in their own shade.
  gaps = max(gaps, (1.0 - midW) * fresh * (1.0 - smoothstep(0.3, 0.6, lumpsMid)) * 0.7);
  foamRad = mix(foamRad, mix(col, crevice, 0.55), gaps * 0.85);
  // Up close on the sheet, the bubbles themselves: bright rims and darker middles, a few
  // millimetres to a couple of centimetres across.
  if (onSheet > 0.01 && fp < 0.012) {
    vec2 qb = (p - travel) * 38.0;
    float bub = smoothstep(0.0, 0.35, cells(qb, uTime * 1.3)) * 0.6 + smoothstep(0.0, 0.3, cells(qb * 2.7 + 5.0, -uTime)) * 0.4;
    foamRad *= mix(1.0, 0.72 + 0.45 * (1.0 - bub), onSheet * smoothstep(0.012, 0.005, fp));
  }
  // Old foam is a thin film of bubbles: the water shows through its threads (v9: more, so
  // lace reads as a web on the water rather than paint on it).
  float thinFilm = mix(mix(0.38, 0.6, smoothstep(0.01, 0.08, fp)), 1.0, max(fresh, smoothstep(0.35, 0.85, amount)));
  float fo = foam * thinFilm;
  // (v9) The border of a patch of white water is thinner than its middle: the outer part lets
  // the water through (a hard white edge read as a decal on the water).
  if (fresh > 0.01) fo *= mix(1.0, mix(0.55, 1.0, smoothstep(0.45, 0.75, lumps * 0.7 + lumpsMid * 0.3 + fresh * 0.2)), smoothstep(0.1, 0.02, fp) * (1.0 - onSheet));

  // Shallow water, the swash sheet above all, is mostly the sand seen through it: the ground
  // draws that sand (wet), and this adds what the water does to it. With the blend
  // (src a + dst (1 - a)) the sand comes through with weight dstK: less the more of the
  // light the surface reflects and the deeper the water. The sea's own model of the bed takes
  // over below about 30 cm.
  float film = mix(vWorld.y - d.r, sf.h - d.r, sf.sheet);
  float shallowW = 1.0 - smoothstep(0.12, 0.45, film);
  vec3 X = col;
  float dstK = 0.0;
  if (shallowW > 0.0) {
    float muV = max(-refract(-V, N, 1.0 / 1.333).y, 0.2);
    vec3 T = exp(-K * max(film, 0.0) * (1.0 / muV + 1.0 / max(sunY, 0.3)));
    vec3 column = uGordonF * bb / K * (uSunIrr * sunY * mix(0.35, 1.0, shadow) + uSkyIrr) / PI;
    // Caustics from the sheet's ripples on the sand under it.
    float cs = sf.sheet * smoothstep(0.003, 0.02, film) * smoothstep(0.03, 0.012, fp);
    // (Only adds: the sand's own light is the ground's, so a caustic can only brighten it.)
    // Stretched along the flow (the ripples on a running sheet are long across it), and
    // coming and going in patches.
    vec3 caus = vec3(0.0);
#ifdef SKIP_CAUS
    cs = 0.0;
#endif
    if (cs > 0.0) {
      vec2 up = -offshoreAt(p);
      vec2 qc = vec2(dot(p, up) * 2.2 - sf.swVel * uTime * 2.2, dot(p, vec2(-up.y, up.x)) * 5.0);
      float cc = max(caustics(qc, uTime * 2.5) - 0.2, 0.0) * smoothstep(0.35, 0.7, fbm3(p * 0.8 + uTime * 0.2));
      caus = uWetSandAlb / PI * uSunIrr * sunY * shadow * cc * 0.3 * cs * T;
    }
    vec3 thin = refl * F + spec + (1.0 - F) * (column * (1.0 - T) + caus);
    X = mix(col, thin, shallowW);
    dstK = shallowW * (1.0 - F) * dot(T, vec3(0.2126, 0.7152, 0.0722));
  }
  vec3 Xf = X * (1.0 - fo) + foamRad * fo;
  float alpha = 1.0 - dstK * (1.0 - fo);
  // The sheet's edge: where its edge height above the sand crosses zero, a little soft.
  // Its edge is ragged: fingers and scallops a few centimetres to a few decimetres across.
  float rag = sf.sheet > 0.0 && vSheetA.z > -0.03 && vSheetA.z < 0.03
    ? (vnoise(p * 2.7 + uTime * 0.3) - 0.5) * 0.012 + (vnoise(p * 9.0 - uTime * 0.5) - 0.5) * 0.006 * smoothstep(0.05, 0.01, fp) : 0.0;
  float edgeA = mix(smoothstep(0.0, 0.002, film), smoothstep(0.0, 0.0025, vSheetA.z + rag + 0.0012 * fo), sf.sheet);
  vec3 srcCol = Xf / max(alpha, 1e-3);
  alpha *= edgeA;
  // (No discard: it would stop the GPU from rejecting the sea's pixels under the ground early.)

  gl_FragColor = vec4(srcCol * vApT + vApIns, alpha);
  // Debug views skip the exposure and tone curve so their values read straight (4: the light
  // from under the surface, is scaled to the same exposure by hand).
  if (uDebug > 0 && uDebug != 4) {
    if (uDebug == 1) gl_FragColor = vec4(vec3(sed), 1.0);
  if (uDebug == 2) gl_FragColor = vec4(vec3(through), 1.0);
  if (uDebug == 3) gl_FragColor = vec4(amount, caps, fresh, 1.0);
  if (uDebug == 8) gl_FragColor = vec4(sim.rg, length(sim.ba) * 0.05, 1.0);
  // 10: the swash (v5): sheet, foam amount, the film's thickness / 10 cm.
  if (uDebug == 10) gl_FragColor = vec4(sf.sheet, amount, sf.film * 10.0, 1.0);
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
