// The breaking wave on the beach: its face and the lip it throws, which a heightfield cannot
// draw (a height per map point cannot fold over).
//
// A ribbon runs along each beach's waterline (worker.js, breakerLines): one column of vertices
// every half metre, each column a cross-section of the wave from 0.45 of a wavelength behind
// the crest to a little in front of it. Every frame, each column finds the crest of the wave
// that is breaking there (the surf in water-shader.js, stepped to where its phase is zero),
// reads how far that wave is through breaking, and bends into that stage:
//   0     the unbroken crest, exactly the heightfield's own shape
//   0.35  the face steepens to vertical and the lip starts to throw
//   0.5   the lip curls forward over a hollow face (the tube)
//   0.8   the lip lands in the trough in front
//   1     it collapses into the white water of the bore
// Along the beach each column is at its own stage (the crest reaches its break point at
// different times), so the wave peels. While a wave breaks the heightfield tucks its crest
// under the ribbon (surfAt, sink), so the two never fight.
//
// The cross-section is x forward (toward the beach), y up from the trough, in metres:
//   back slope     the heightfield's Gaussian back
//   outer lip      an elliptical arc from the crest top, curling forward and down
//   lip edge
//   inner lip      the underside, back up to the top of the tube
//   face           the inside of the tube down to half height, then a concave quarter circle
//                  into the trough (unbroken: the heightfield's Gaussian front)
//   floor          the trough in front, under the lip

import * as THREE from 'three';
import { COMMON, FOAM_GLSL, UNDER_GLSL, SURFACE_GLSL } from './water-shader.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { SKY_PARS, AERIAL_VERT, AERIAL_FRAG_PARS } from '../sky/atmosphere-glsl.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';

export const PROFILE = /* glsl */ `
// Cross-section at stage tau for a wave of height H (crest over trough), back length Lb and
// unbroken front width Lf (m). Returns x, y, the water thickness behind the point (m; the lip
// is thin, the body of the wave is not), and how much the point follows the heightfield's own
// shape (1) rather than the breaker's (0).
vec4 breakerProfile(float v, float tau, float H, float Lb, float Lf, float xMax) {
  float a = H * (0.2 + 0.4 * smoothstep(0.1, 0.7, tau));      // how far forward the lip reaches
  float b = H * 0.5, yc = H * 0.5;
  float xc = H * (0.02 + 0.3 * tau);                           // the crest moves forward as it throws
  float sweep = 160.0 * smoothstep(0.05, 0.75, tau);           // degrees the lip has curled through
  float thTip = radians(90.0 - sweep);
  float t0 = H * 0.28 * smoothstep(0.0, 60.0, sweep);          // lip thickness at its root
  float m = smoothstep(0.08, 0.45, tau);                       // how far the face has become a tube
  float ai = max(a - t0, 0.08 * H), bi = max(b - t0, 0.08 * H);
  float xF = min(max(Lf, xc + a + 0.7 * H), xMax);
  float faceEnd = min(mix(xc + Lf, xc - ai + yc, m), xF - 0.1);
  if (v < 0.25) {
    float x = -Lb * (1.0 - v / 0.25);
    return vec4(x + xc * v / 0.25, H * exp(-3.5 * (x / Lb) * (x / Lb)), 50.0, 1.0);
  }
  if (v < 0.45) {
    float u = (v - 0.25) / 0.2;
    float th = mix(radians(90.0), thTip, u);
    return vec4(xc + a * cos(th), yc + b * sin(th), mix(max(t0, 0.3 * H), t0 * 0.15, u), 0.0);
  }
  if (v < 0.47) {
    float u = (v - 0.45) / 0.02;
    return vec4(xc + mix(a, ai, u) * cos(thTip), yc + mix(b, bi, u) * sin(thTip), t0 * 0.15, 0.0);
  }
  if (v < 0.82) {
    float u = (v - 0.47) / 0.35;
    vec2 tube;
    float thick;
    if (u < 0.35) {
      float th = mix(thTip, radians(90.0), u / 0.35);
      tube = vec2(xc + ai * cos(th), yc + bi * sin(th));
      thick = mix(t0 * 0.15, t0, u / 0.35);
    } else if (u < 0.7) {
      float th = mix(radians(90.0), radians(180.0), (u - 0.35) / 0.35);
      tube = vec2(xc + ai * cos(th), yc + bi * sin(th));
      thick = H;
    } else {
      float ph = mix(0.0, radians(90.0), (u - 0.7) / 0.3);
      tube = vec2(xc - ai + yc * (1.0 - cos(ph)), yc - yc * sin(ph));
      thick = H;
    }
    float gu = max((u - 0.35) / 0.65, 0.0);
    vec2 g = vec2(xc + Lf * gu, H * exp(-(gu / 0.5) * (gu / 0.5)));
    return vec4(mix(g, tube, m), mix(H, thick, m), 1.0 - m);
  }
  // The floor stays at the trough (the heightfield's front slope is tucked away under it).
  float u = (v - 0.82) / 0.18;
  return vec4(mix(faceEnd, xF, u), 0.0, 50.0, 1.0 - m);
}
`;


// Finding the breaking wave for one column of the ribbon (shared with the spray, spray.js).
export const BREAK_GLSL = /* glsl */ `
${PROFILE}
float hAt(vec2 p) { return surfAt(p, dataAt(p)).hRaw; }
struct BreakCol { vec2 pc; vec2 n; float tau; float on; float L; float Lb; float Lf; float xMax; float hB; float hF; float H; };
BreakCol findBreak(vec2 p0, vec2 n0) {
  // The crest of the wave nearest the middle of the break here: start there and step up or
  // down the shore distance (along its gradient, which the waterline's own normal is not,
  // where the beach curves) until the wave's phase is zero.
  vec2 q = p0 + n0 * uBreakAt * 0.8;
  Surf c;
  for (int i = 0; i < 4; i++) {
    c = surfAt(q, dataAt(q));
    q += offshoreAt(q) * clamp(-c.vph, -0.45, 0.45) * c.L;
  }
  BreakCol b;
  b.pc = q;
  c = surfAt(q, dataAt(q));
  b.n = offshoreAt(q);            // the cross-section runs square to the crest
  b.tau = c.tau;
  b.on = step(-0.08, c.tau) * step(c.tau, 1.14) * step(0.001, c.L * step(0.0, c.hRaw + 5.0));
  b.L = c.L;
  b.Lb = 0.45 * c.L; b.Lf = 2.0 * c.wf * c.L; b.xMax = 0.12 * c.L;
  b.hB = hAt(q + b.n * b.Lb);
  float H0 = max(c.hRaw - b.hB, 0.05);
  b.hF = hAt(q - b.n * min(max(b.Lf, 1.6 * H0), b.xMax));
  b.H = max(c.hRaw - mix(b.hB, b.hF, 0.5), 0.05);
  return b;
}
// The same, worked out once per column per frame by the column pass (createBreaker) and read
// back here by the ribbon's vertices and the spray.
uniform sampler2D uBreakCol0;   // crest x, y, direction out to sea x, y
uniform sampler2D uBreakCol1;   // stage, on, wavelength, height
uniform sampler2D uBreakCol2;   // height behind, height in front, unbroken front width
BreakCol readBreak(float col) {
  ivec2 t = ivec2(int(col + 0.5), 0);
  vec4 a = texelFetch(uBreakCol0, t, 0), b = texelFetch(uBreakCol1, t, 0), d = texelFetch(uBreakCol2, t, 0);
  BreakCol r;
  r.pc = a.xy; r.n = a.zw;
  r.tau = b.x; r.on = b.y; r.L = b.z; r.H = b.w;
  r.hB = d.x; r.hF = d.y; r.Lf = d.z;
  r.Lb = 0.45 * r.L; r.xMax = 0.12 * r.L;
  return r;
}
`;

const VERT = /* glsl */ `
${COMMON}
${BREAK_GLSL}
${AERIAL_VERT}
#include <common>
attribute vec4 aLine;      // waterline x, y (map), offshore direction x, y
attribute vec3 aProf;      // v across the wave, distance along the beach, column
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vMap;
varying vec4 vInfo;        // v, stage, water thickness behind, wave height
varying float vAlong;      // distance along the beach (m)
varying float vTear;

void main() {
  float v = aProf.x;
  BreakCol bc = readBreak(aProf.z);
  // A stretch of beach that is not breaking now costs next to nothing: its whole column goes
  // to one point a metre under the sea (the triangles to it have no area, or lie under the
  // sea where the ribbon starts or stops, and are faded out there anyway).
  if (bc.on < 0.5) {
    vec3 w0 = vec3(aLine.x, -1.0, -aLine.y);
    vWorld = w0; vNormal = vec3(0.0, 1.0, 0.0); vMap = aLine.xy; vInfo = vec4(aProf.x, 0.0, 0.0, 0.0);
    vAlong = aProf.y; vTear = 1.0;
    gl_Position = projectionMatrix * (viewMatrix * vec4(w0, 1.0));
    vApT = vec3(1.0); vApIns = vec3(0.0);
    return;
  }
  // Where neighbouring columns found different waves (their crests far apart), the triangles
  // between them would stretch across the gap: those are dropped (vTear, in the fragment).
  float cMax = float(textureSize(uBreakCol0, 0).x) - 1.0;
  vec2 pPrev = texelFetch(uBreakCol0, ivec2(int(max(aProf.z - 1.0, 0.0) + 0.5), 0), 0).xy;
  vec2 pNext = texelFetch(uBreakCol0, ivec2(int(min(aProf.z + 1.0, cMax) + 0.5), 0), 0).xy;
  vTear = step(4.0, max(distance(pPrev, bc.pc), distance(pNext, bc.pc)));
  // Next to a column that is off (collapsed under the sea), sink this one too, or the
  // triangles between them stand up as thin slivers that catch the light.
  float nbOn = texelFetch(uBreakCol1, ivec2(int(max(aProf.z - 1.0, 0.0) + 0.5), 0), 0).y
             * texelFetch(uBreakCol1, ivec2(int(min(aProf.z + 1.0, cMax) + 0.5), 0), 0).y;
  vec2 pc = bc.pc, n = bc.n;
  float tau = bc.tau, on = bc.on, L = bc.L, Lb = bc.Lb, Lf = bc.Lf, xMax = bc.xMax, hB = bc.hB, hF = bc.hF, H = bc.H;
  Surf c;
  // Each bit of the lip at its own point in the throw (a real lip is never ruler straight).
  float jit = vnoise(vec2(aProf.y * 0.35, 1.7)) - 0.5 + (vnoise(vec2(aProf.y * 1.3, 4.1)) - 0.5) * 0.5;
  float st = mix(0.0, clamp(tau + jit * 0.12 * smoothstep(0.1, 0.3, tau), 0.0, 1.2), on);
  float tauC = max(tau, 0.0);
  vec4 pr = breakerProfile(v, st, H, Lb, Lf, xMax);
  float xF = min(max(Lf, H * (0.02 + 0.3 * st) + H * (0.2 + 0.4 * smoothstep(0.1, 0.7, st)) + 0.7 * H), xMax);
  vec2 pm = pc - n * pr.x;
  float yRef = mix(hB, hF, clamp((pr.x + Lb) / (Lb + xF), 0.0, 1.0));
  Surf sp = surfAt(pm, dataAt(pm));
  float yHf = sp.hRaw;
  float y = mix(yRef + pr.y, yHf, pr.w);
  // (Where the sea in front stands higher than the foot of the face, carrying the last wave's
  // bore, it covers the foot: the water in front of a breaking wave does that.)
  // Collapse into the bore: the thrown water lands as a lumpy heap of white water, then
  // settles into the heightfield's own bore (so the ribbon can switch off without a jump).
  float heap = smoothstep(0.7, 0.85, tau) * (1.0 - smoothstep(0.9, 1.05, tau));
  float lumps = vnoise(vec2(aProf.y * 0.9, v * 8.0 + tau * 3.0)) * 0.6 + vnoise(vec2(aProf.y * 2.7, v * 21.0)) * 0.4;
  y += heap * H * 0.35 * lumps * smoothstep(0.2, 0.45, v) * (1.0 - smoothstep(0.75, 0.95, v));
  y = mix(y, yHf, smoothstep(0.88, 1.05, tau));
  // The ribbon hands over to the sea by sinking under it, at its back and front edges and at
  // the start and end of each break: where the two are nearly the same shape, whichever is
  // higher shows, and the depth test draws the seam. (A blend or a dither there showed as a
  // band, because the two are never shaded exactly alike.)
  // In time: up from -0.08 (before the sea starts tucking its crest at 0.02) to 1.12 (after
  // it has put it back by 1.06). While the two have the same shape the ribbon stays 10 cm
  // under the sea, so they do not fight over the same pixels (the two meshes sample a steep
  // bore at different points, and 3 cm was not enough).
  float keepUp = smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.78, 0.85, v))
               * smoothstep(-0.08, -0.02, tau) * (1.0 - smoothstep(1.08, 1.13, tau)) * on * nbOn;
  y -= 0.1 * (1.0 - smoothstep(0.02, 0.1, tau)) + 0.1 * smoothstep(0.86, 0.98, tau);
  // As the sea puts its crest back after the collapse, everything of the ribbon behind the
  // white heap (its back and the top of the landed lip) goes under it, or it lies there as a
  // flat pane over a sea that is still half tucked.
  y -= 0.4 * smoothstep(0.84, 0.96, tau) * (1.0 - smoothstep(0.35, 0.5, v));
  // And in space: on its back, beyond where the sea tucks its crest away (a third of a
  // wavelength behind the crest, surfAt's window), the ribbon lies 10 cm under the sea too.
  y -= 0.1 * smoothstep(0.25, 0.34, -pr.x / L);
  y = mix(sp.h - 0.15, y, keepUp);

  // Normal from the cross-section's slope and the waterline's direction.
  float e = 0.004;
  vec4 pa = breakerProfile(max(v - e, 0.0), st, H, Lb, Lf, xMax), pb = breakerProfile(min(v + e, 1.0), st, H, Lb, Lf, xMax);
  vec2 d2 = pb.xy - pa.xy;
  // The curve runs from the back to the front, water on its right: its left normal points out
  // of the water (up on the back, down under the lip, forward on the face of the tube).
  vec2 n2 = normalize(vec2(-d2.y, d2.x) + vec2(0.0, 1e-6));
  vec3 fwd = vec3(-n.x, 0.0, n.y);            // toward the beach, in world space
  vec3 nrm = normalize(fwd * n2.x + vec3(0.0, n2.y, 0.0));

  vec3 w = vec3(pm.x, y, -pm.y);
  vWorld = w;
  vNormal = nrm;
  vMap = pm;
  vInfo = vec4(v, tau * on, pr.z, H);
  vAlong = aProf.y;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  vApT = vec3(1.0); vApIns = vec3(0.0);
  aerialVertex(w);
}
`;

const FRAG = /* glsl */ `
#include <common>
${COMMON}
${SKY_PARS}
${AERIAL_FRAG_PARS}
${SUN_SHADOW_GLSL}
${CLOUD_SHADOW_GLSL}
${FOAM_GLSL}
${UNDER_GLSL}
${SURFACE_GLSL}
uniform float uFoam;
uniform sampler2D uSim;
uniform vec3 uSimRect;
uniform float uSimOn;
uniform int uDebug;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vMap;
varying vec4 vInfo;
varying float vAlong;
varying float vTear;

// Whitewater on the breaking wave itself (v9): the lip tearing into white water, and foam
// running down the face in streaks. rp: metres along the beach and down the cross-section.
// Long, narrow streaks down the face, torn into shreds, with soft edges (it was the sea's
// lace laid on the face, which read as stained glass and white flames).
float faceFoam(vec2 rp, float tau, float amount) {
  float streak = fbm3(vec2(rp.x * 1.6, rp.y * 0.22 - tau * 1.5)) * 0.55 + vnoise(vec2(rp.x * 4.8 + 3.0, rp.y * 0.5 - tau)) * 0.2;
  float shred = fbm3(rp * vec2(0.9, 0.7) + vec2(4.0, -tau * 2.5)) * 0.25;
  float p = streak + shred;
  // (Soft, and thin where there is little: a streak is a film of bubbles, not paint.)
  return smoothstep(1.0 - amount - 0.2, 1.0 - amount + 0.2, p) * mix(0.55, 1.0, smoothstep(0.2, 0.7, amount));
}

void main() {
  if (vTear > 0.001) discard;
  // The floor in front of the tube lies on the sea's own trough (tucked under it): let the
  // sea draw it, so there is no seam where the ribbon ends.
  if (vInfo.x > 0.86) discard;
  // The lip tears apart at its edge: holes and a ragged rim over the last part of it.
  if (vInfo.y > 0.2 && vInfo.x > 0.38 && vInfo.x < 0.52) {
    float rim = 1.0 - abs(vInfo.x - 0.455) / 0.07;
    float holes = vnoise(vec2(vAlong * 2.3, vInfo.x * 40.0 + vInfo.y * 5.0)) * 0.65 + vnoise(vec2(vAlong * 7.9, vInfo.x * 110.0)) * 0.35;
    if (holes < rim * 0.75 * smoothstep(0.2, 0.45, vInfo.y)) discard;
  }
#ifdef BFLAT
  gl_FragColor = vec4(0.1, 0.4, 0.5, 1.0); return;
#endif
  float v = vInfo.x, tau = vInfo.y, H = vInfo.w;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  // The normal points out of the water; seen from its other side (through the thin lip, or
  // along the edge), turn it to the camera.
  if (dot(N, V) < 0.0) N = -N;
  float fp = max(length(fwidth(vWorld)), 0.005);
  // The sea's own surface rides on the breaker: the ocean's slopes (tilted onto the ribbon),
  // and the spread of the slopes too small to draw, for the reflection and the glint. The
  // same as the sea beside it (SURFACE_GLSL), so where they meet they look alike: with a
  // plain mirror the ribbon came out darker than the sea's own crest next to it.
  vec4 d = dataAt(vMap);
  vec4 oc = oceanSurface(vMap, seaWeights(vMap, d));
  vec3 tA = normalize(cross(N, vec3(0.0, 0.0, 1.0)) + 1e-4), tB = cross(N, tA);
  N = normalize(N + tA * oc.x + tB * oc.y);
  vec3 L = uSunDir;
  float shadow = bakedShadow(vWorld, 0.05) * cloudShadow(vWorld, uSunDir);

  vec2 simUv = (vMap - uSimRect.xy) / uSimRect.z;
  vec4 sim = uSimOn > 0.5 ? texture(uSim, clamp(simUv, 0.0, 1.0)) : vec4(0.0);

  // Light up out of the water, as for the sea around it (the same function). Through the thin
  // lip the camera sees the face of the wave behind it: the same light, dimmed a little by
  // the lip's own water and brightened by the sun coming through it.
  // (Only once a lip has been thrown and only where it is thin: before that, the top of the
  // face is the body of the wave, and shading it as see-through made it pale.)
  float lip = smoothstep(0.23, 0.27, v) * (1.0 - smoothstep(0.6, 0.66, v)) * smoothstep(0.12, 0.3, tau)
            * smoothstep(0.8, 0.3, vInfo.z);
  float thick = 0.9 + 5.5 * exp(-max(vWorld.y + 0.3, 0.0) * 1.1);
  Under uw = underLight(vMap, d, vWorld, N, V, fp, shadow, thick, 0.0, sim.g, uSimOn);
  vec3 Tl = exp(-uw.K * max(vInfo.z, 0.05) * 2.0);
  vec3 sunThrough = uSunIrr * shadow * pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 6.0) * uGordonF * uw.bb / uw.K / PI * 3.0;
  vec3 under = mix(uw.light, uw.light * Tl + (uGordonF * uw.bb / uw.K * (uSunIrr * max(L.y, 0.0) + uSkyIrr) / PI) * (1.0 - Tl) + sunThrough, lip);
  // (v9) The thrown lip and the inside of the tube: a sheet of water with daylight all round
  // it, and the tube's face lit through the lip above it. Both glow teal from the light
  // scattered in the water, where they went navy (the light model looked for a sea bed or the
  // back of the wave, and found neither in the dark).
  float tube = smoothstep(0.46, 0.52, v) * smoothstep(0.1, 0.35, tau) * (1.0 - smoothstep(0.78, 0.92, tau));
  float lit = max(tube, lip * smoothstep(0.26, 0.36, v));
  if (lit > 0.0) {
    // (Clear water there would still be navy: what lights it is the bubbles and sand the
    // break has mixed in, which scatter the light back, a white 0.025 per metre.)
    vec3 bbL = uw.bb + 0.025, KL = uw.K + 0.025;
    vec3 glow = uGordonF * bbL / KL * (uSunIrr * max(L.y, 0.0) * shadow * 0.8 + uSkyIrr) / PI;
    under = mix(under, max(under, glow * 0.9 + sunThrough * 0.4), lit);
  }

  float NoV = max(dot(N, V), 1e-3);
  float F;
  vec3 refl;
  roughReflect(N, V, sqrt(oc.z), F, refl);
  // (v9) Under the curling lip the reflection points down, at the water and the white water
  // in front, not at the dark horizon the sea's model assumes for other waves.
  float downR = smoothstep(0.0, -0.25, reflect(-V, N).y);
  refl = mix(refl, under * 1.6 + uSkyIrr / PI * 0.15, downR);
  float rough = clamp(sqrt(0.0025 + oc.z) + fp * 0.002, 0.05, 0.6);
  float a2 = rough * rough;
  vec3 Hh = normalize(V + L);
  float NoH = max(dot(N, Hh), 0.0), NoL = max(dot(N, L), 0.0);
  float D = a2 / (PI * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
  float k = rough * 0.5;
  float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 spec = uSunIrr * shadow * D * Fs * G / (4.0 * NoV + 1e-4);
  vec3 col = under * (1.0 - F) + refl * F + spec;
  // Sunlight through the thin top of the wave: the same as the sea's (water-shader.js), so
  // the ribbon and the sea look alike where they have the same shape.
  float crestGlow = smoothstep(0.3, 1.4, vWorld.y) * pow(1.0 - NoV, 1.5);
  col += uGordonF * uw.bb / uw.K * uSunIrr * max(L.y, 0.0) * shadow * crestGlow * 0.5;

  // White water: the lip's edge tears into foam as it throws; the crest feathers; on impact
  // and in the collapse everything turns white; foam from earlier waves streaks the face. The
  // lace is laid out on the ribbon itself (along the beach, and across the wave), so it
  // stretches with the water instead of smearing down a steep face.
  vec2 rp = vec2(vAlong, v * max(H, 0.5) * 6.0);
  float tear = vnoise(vec2(vAlong * 1.7, tau * 6.0)) * 0.5 + vnoise(vec2(vAlong * 5.3, v * 30.0)) * 0.5;
  float edge = smoothstep(0.36, 0.45, v + tear * 0.05) * (1.0 - smoothstep(0.5, 0.58, v - tear * 0.06)) * smoothstep(0.12, 0.45, tau);
  // Feathering: a thin broken fringe along the very top as the crest starts to spill.
  float feather = smoothstep(0.235, 0.25, v) * (1.0 - smoothstep(0.26, 0.29, v)) * smoothstep(0.05, 0.2, tau) * (1.0 - smoothstep(0.45, 0.6, tau)) * step(0.45, tear);
  // (The collapse hands its white water over to the sea's own bore: it fades out before the
  // ribbon switches off, so no section of it ends in a hard edge.)
  float impact = smoothstep(0.62, 0.8, tau) * smoothstep(0.2, 0.4, v);
  // (Old foam drawn up the face as it steepens: faint, and only once it is steep, v9.)
  float streak = sim.r * smoothstep(0.62, 0.8, v) * 0.22 * smoothstep(0.05, 0.3, tau);
  float amount = clamp(max(max(edge * (0.55 + 0.6 * tear), feather * 0.6), max(impact, streak)) * uFoam, 0.0, 1.0);
  // (The patterns only where there is foam to draw: most of the face has none.)
  float foam = 0.0;
  if (amount > 0.002) foam = max(faceFoam(rp, tau, amount), smoothstep(0.92, 1.0, amount));
  // The foam already on the water here (the simulation's, drawn as the sea draws it, in map
  // coordinates, so the lace lines up where the ribbon meets the sea).
  // Only on the back and the floor: the lip and the face are the breaker's own.
  float seaFoam = clamp(sim.r * uFoam, 0.0, 1.0) * max(1.0 - smoothstep(0.18, 0.24, v), smoothstep(0.82, 0.9, v));
  if (seaFoam > 0.002) {
    vec2 slp = lacePattern(vMap - sim.ba, fp);
    foam = max(foam, smoothstep(1.0 - seaFoam - 0.12, 1.0 - seaFoam + 0.12, slp.x) * smoothstep(0.0, 0.06, seaFoam));
  }
  // White water is a heap of bubbles: its lumps shade each other and face the sun or not
  // (in the noon sun it would otherwise just be clipped white).
  float relW = smoothstep(0.25, 0.04, fp) * step(0.01, foam);
  // (Lumps of a decimetre and up: at 2.2 times the scale the finest octaves were centimetre
  // grain, which read as polystyrene. v9.)
  vec3 rel = relW > 0.01 ? foamRelief(rp * 1.1 + vec2(0.0, tau * 2.0), fp * 3.0, uTime) : vec3(1.0, 0.0, 0.0);
  vec3 Nf = normalize(N + (tA * rel.y + tB * rel.z) * relW);
  // (v9) Light goes a long way through white water before it comes back out, so a side turned
  // from the sun is still lit (wrapped): it was grey-lavender, lit by the sky alone.
  vec3 foamRad = vec3(0.78) / PI * (uSunIrr * max((dot(Nf, L) + 0.7) / 1.7, 0.15) * shadow + uSkyIrr);
  // In the crevices: no sun, only sky and light scattered through the foam (as the sea's).
  vec3 crevice = vec3(0.78) / PI * (uSunIrr * max(L.y, 0.0) * shadow * 0.2 + uSkyIrr * 0.6);
  foamRad = mix(mix(col, crevice, 0.6), foamRad, mix(1.0, rel.x, relW));
  // Thin white water shows the water through it.
  col = mix(col, foamRad, foam * mix(0.7, 1.0, smoothstep(0.3, 0.9, amount)));

  gl_FragColor = vec4(col * vApT + vApIns, 1.0);
  // Debug views skip the exposure and tone curve so their values read straight.
  if (uDebug == 9) { gl_FragColor = vec4(v, tau, vInfo.z / 4.0, 1.0); return; }
  if (uDebug == 1) { gl_FragColor = vec4(vec3(uw.sed), 1.0); return; }
  if (uDebug == 2) { gl_FragColor = vec4(vec3(uw.through), 1.0); return; }
  if (uDebug == 4) { gl_FragColor = vec4(under * 0.08, 1.0); return; }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uLabel > 0.5) gl_FragColor = vec4(2.0 / 255.0, log2(max(distance(vWorld, cameraPosition), 1.0)) / 20.0, 1.0, 1.0);
}
`;

// The column pass: one texel per column, findBreak once, three float outputs.
const COLUMN_FRAG = /* glsl */ `#version 300 es
precision highp float;
#define texture2D texture
${COMMON}
${BREAK_GLSL}
uniform sampler2D uColLine;     // waterline x, y, direction out to sea x, y
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
void main() {
  vec4 l = texelFetch(uColLine, ivec2(gl_FragCoord.xy), 0);
  BreakCol b = findBreak(l.xy, l.zw);
  o0 = vec4(b.pc, b.n);
  o1 = vec4(b.tau, b.on, b.L, b.H);
  o2 = vec4(b.hB, b.hF, b.Lf, 0.0);
}`;

export function createBreaker(renderer, waterUniforms) {
  const U = waterUniforms;
  U.uBreakCol0 = { value: null };
  U.uBreakCol1 = { value: null };
  U.uBreakCol2 = { value: null };
  const material = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });
  // Opaque, and drawn in chunks sorted near to far every frame (sortChunks). Seen along the
  // beach the ribbon's columns stack up on the same pixels, and blended, in the order they
  // happen to run, every layer was shaded: 1.7 ms at the beach frame for a small patch of
  // wave. Drawn near to far with depth writes, the hidden layers fail the depth test before
  // they are shaded. (The material is in a one-element array so three.js draws the groups.)
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [material]);
  mesh.frustumCulled = false;
  let chunks = [];
  mesh.visible = false;

  // Rows across the wave, with more of them on the lip.
  const NV = 96;
  const vs = Array.from({ length: NV }, (_, i) => i / (NV - 1));

  // ---------------------------------------------------------------- the column pass
  const gl = renderer.getContext();
  const VERT_FS = `#version 300 es
  void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const prog = (() => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT_FS], [gl.FRAGMENT_SHADER, COLUMN_FRAG]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('breaker column shader: ' + gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('breaker column program: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  })();
  const vao = gl.createVertexArray();
  let nCols = 0, lineTex = null, target = null, lastT = null;
  const texOf = (t) => { if (!renderer.properties.get(t).__webglTexture) renderer.initTexture(t); return renderer.properties.get(t).__webglTexture; };
  function runColumns() {
    if (!nCols || !U.uData.value || !U.uShoreDir.value) return;
    const u = prog.u;
    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.properties.get(target).__webglFramebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.viewport(0, 0, nCols, 1);
    gl.useProgram(prog.p);
    [['uColLine', texOf(lineTex)], ['uData', texOf(U.uData.value)], ['uShoreDir', texOf(U.uShoreDir.value)]]
      .forEach(([name, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[name], i); });
    const e = U.uExtent.value;
    gl.uniform3f(u.uExtent, e.x, e.y, e.z);
    gl.uniform1f(u.uTime, U.uTime.value);
    gl.uniform1f(u.uPeriod, U.uPeriod.value);
    gl.uniform1f(u.uSwell, U.uSwell.value);
    gl.uniform1f(u.uBreakAt, U.uBreakAt.value);
    if (u.uRunup) gl.uniform1f(u.uRunup, U.uRunup.value);
    if (u.uSwashT) gl.uniform1f(u.uSwashT, U.uSwashT.value);
    if (u.uBreakerOn) gl.uniform1f(u.uBreakerOn, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    renderer.resetState();
  }

  return {
    mesh,
    material,
    get columns() { return nCols; },
    // Order the chunks near to far from the camera.
    sortChunks(camera) {
      if (!chunks.length) return;
      const cx = camera.position.x, cy = -camera.position.z;
      for (const c of chunks) c.d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
      chunks.sort((a, b) => a.d - b.d);
      const g = mesh.geometry;
      g.groups.length = 0;
      for (const c of chunks) g.groups.push(c.group);
    },
    // Work out every column's wave for the current time (once per frame, when it moves).
    update(time, force = false) {
      if (!force && time === lastT) return;
      lastT = time;
      runColumns();
    },
    // Build the ribbon along the waterlines from the worker (x, y, nx, ny, along; NaN ends a run).
    // Returns the columns in order (x, y, nx, ny), for the spray.
    setLines(lines) {
      const runs = [];
      let run = [];
      for (let k = 0; k < lines.length; k += 5) {
        if (Number.isNaN(lines[k])) { if (run.length > 1) runs.push(run); run = []; continue; }
        run.push(k);
      }
      if (run.length > 1) runs.push(run);
      nCols = 0;
      for (const r of runs) nCols += r.length;
      const cols = new Float32Array(nCols * 4);
      const line = new Float32Array(nCols * NV * 4), prof = new Float32Array(nCols * NV * 3);
      const index = [];
      let base = 0;
      for (const r of runs) {
        r.forEach((k, c) => {
          cols.set([lines[k], lines[k + 1], lines[k + 2], lines[k + 3]], (base + c) * 4);
          for (let j = 0; j < NV; j++) {
            const o = (base + c) * NV + j;
            line.set([lines[k], lines[k + 1], lines[k + 2], lines[k + 3]], o * 4);
            prof[o * 3] = vs[j]; prof[o * 3 + 1] = lines[k + 4]; prof[o * 3 + 2] = base + c;
          }
          if (c > 0) for (let j = 0; j < NV - 1; j++) {
            const a = (base + c - 1) * NV + j, b = a + 1, d = (base + c) * NV + j, e = d + 1;
            index.push(a, d, b, b, d, e);
          }
        });
        base += r.length;
      }
      const g = new THREE.BufferGeometry();
      // The shader places every vertex; position only has to exist.
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nCols * NV * 3), 3));
      g.setAttribute('aLine', new THREE.BufferAttribute(line, 4));
      g.setAttribute('aProf', new THREE.BufferAttribute(prof, 3));
      g.setIndex(index);
      // Chunks of 16 columns (8 m of beach), each a group of the index buffer.
      chunks = [];
      {
        let colBase = 0, triStart = 0;
        for (const r of runs) {
          for (let c0 = 1; c0 < r.length; c0 += 16) {
            const c1 = Math.min(r.length, c0 + 16);
            const count = (c1 - c0) * (NV - 1) * 6;
            let x = 0, y = 0;
            for (let c = c0; c < c1; c++) { x += cols[(colBase + c) * 4] + cols[(colBase + c) * 4 + 2] * 12; y += cols[(colBase + c) * 4 + 1] + cols[(colBase + c) * 4 + 3] * 12; }
            chunks.push({ x: x / (c1 - c0), y: y / (c1 - c0), d: 0, group: { start: triStart, count, materialIndex: 0 } });
            triStart += count;
          }
          colBase += r.length;
        }
      }
      for (const c of chunks) g.addGroup(c.group.start, c.group.count, 0);
      chunks.forEach((c, i) => { c.group = g.groups[i]; });
      mesh.geometry.dispose();
      mesh.geometry = g;
      mesh.visible = nCols > 0;
      // The column pass: its input (the waterline) and its three outputs.
      lineTex?.dispose();
      target?.dispose();
      if (nCols > 0) {
        lineTex = new THREE.DataTexture(cols, nCols, 1, THREE.RGBAFormat, THREE.FloatType);
        lineTex.needsUpdate = true;
        target = new THREE.WebGLRenderTarget(nCols, 1, { count: 3, type: THREE.FloatType, format: THREE.RGBAFormat,
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
        renderer.initRenderTarget(target);
        U.uBreakCol0.value = target.textures[0];
        U.uBreakCol1.value = target.textures[1];
        U.uBreakCol2.value = target.textures[2];
        lastT = null;
      }
      return { runs: runs.length, columns: nCols, cols };
    },
  };
}
