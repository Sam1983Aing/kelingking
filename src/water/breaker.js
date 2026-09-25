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
import { COMMON, FOAM_GLSL, UNDER_GLSL } from './water-shader.js';
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
  b.on = step(0.02, c.tau) * step(c.tau, 1.08) * step(0.001, c.L * step(0.0, c.hRaw + 5.0));
  b.L = c.L;
  b.Lb = 0.45 * c.L; b.Lf = 2.0 * c.wf * c.L; b.xMax = 0.12 * c.L;
  b.hB = hAt(q + b.n * b.Lb);
  float H0 = max(c.hRaw - b.hB, 0.05);
  b.hF = hAt(q - b.n * min(max(b.Lf, 1.6 * H0), b.xMax));
  b.H = max(c.hRaw - mix(b.hB, b.hF, 0.5), 0.05);
  return b;
}
`;

const VERT = /* glsl */ `
${COMMON}
${BREAK_GLSL}
${AERIAL_VERT}
#include <common>
attribute vec4 aLine;      // waterline x, y (map), offshore direction x, y
attribute vec2 aProf;      // v across the wave, distance along the beach
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vMap;
varying vec4 vInfo;        // v, stage, water thickness behind, wave height
varying float vAlong;      // distance along the beach (m)

void main() {
  float v = aProf.x;
  BreakCol bc = findBreak(aLine.xy, aLine.zw);
  vec2 pc = bc.pc, n = bc.n;
  float tau = bc.tau, on = bc.on, L = bc.L, Lb = bc.Lb, Lf = bc.Lf, xMax = bc.xMax, hB = bc.hB, hF = bc.hF, H = bc.H;
  Surf c;
  float st = mix(0.0, tau, on);
  vec4 pr = breakerProfile(v, st, H, Lb, Lf, xMax);
  float xF = min(max(Lf, H * (0.02 + 0.3 * st) + H * (0.2 + 0.4 * smoothstep(0.1, 0.7, st)) + 0.7 * H), xMax);
  vec2 pm = pc - n * pr.x;
  float yRef = mix(hB, hF, clamp((pr.x + Lb) / (Lb + xF), 0.0, 1.0));
  float yHf = hAt(pm);
  float y = mix(yRef + pr.y, yHf, pr.w);
  // Collapse into the bore: the thrown water lands as a lumpy heap of white water, then
  // settles into the heightfield's own bore (so the ribbon can switch off without a jump).
  float heap = smoothstep(0.7, 0.85, tau) * (1.0 - smoothstep(0.9, 1.05, tau));
  float lumps = vnoise(vec2(aProf.y * 0.9, v * 8.0 + tau * 3.0)) * 0.6 + vnoise(vec2(aProf.y * 2.7, v * 21.0)) * 0.4;
  y += heap * H * 0.35 * lumps * smoothstep(0.2, 0.45, v) * (1.0 - smoothstep(0.75, 0.95, v));
  y = mix(y, yHf, smoothstep(0.88, 1.05, tau));
  // Off: tucked just under the sea, out of sight.
  y = mix(yHf - 0.2, y, on);

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
uniform sampler2D uOceanB[4];
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

void main() {
  float v = vInfo.x, tau = vInfo.y, H = vInfo.w;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  // The normal points out of the water; seen from its other side (through the thin lip, or
  // along the edge), turn it to the camera.
  if (dot(N, V) < 0.0) N = -N;
  float fp = max(length(fwidth(vWorld)), 0.005);
  // Ripples ride on the breaker too: the small cascades' slopes, tilted onto the surface.
  vec2 rs = texture(uOceanB[2], vMap / uOceanL.z).xy * 0.6 + texture(uOceanB[3], vMap / uOceanL.w).xy * 0.6;
  vec3 tA = normalize(cross(N, vec3(0.0, 0.0, 1.0)) + 1e-4), tB = cross(N, tA);
  N = normalize(N + tA * rs.x + tB * rs.y);
  vec3 L = uSunDir;
  float shadow = bakedShadow(vWorld, 0.05) * cloudShadow(vWorld, uSunDir);

  vec2 simUv = (vMap - uSimRect.xy) / uSimRect.z;
  vec4 sim = uSimOn > 0.5 ? texture(uSim, clamp(simUv, 0.0, 1.0)) : vec4(0.0);

  // Light up out of the water, as for the sea around it (the same function). Through the thin
  // lip the camera sees the face of the wave behind it: the same light, dimmed a little by
  // the lip's own water and brightened by the sun coming through it.
  float lip = smoothstep(0.23, 0.27, v) * (1.0 - smoothstep(0.6, 0.66, v)) * step(0.05, tau);
  vec4 d = dataAt(vMap);
  float thick = 0.9 + 5.5 * exp(-max(vWorld.y + 0.3, 0.0) * 1.1);
  Under uw = underLight(vMap, d, vWorld, N, V, fp, shadow, thick, 0.0, sim.g, uSimOn);
  vec3 Tl = exp(-uw.K * max(vInfo.z, 0.05) * 2.0);
  vec3 sunThrough = uSunIrr * shadow * pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 6.0) * uGordonF * uw.bb / uw.K / PI * 3.0;
  vec3 under = mix(uw.light, uw.light * Tl + (uGordonF * uw.bb / uw.K * (uSunIrr * max(L.y, 0.0) + uSkyIrr) / PI) * (1.0 - Tl) + sunThrough, lip);
  // Light that came in through the top of the crest glows in the upper part of the wave.
  float glowUp = smoothstep(0.2, 1.0, (vWorld.y + 0.3) / max(H, 0.3)) * smoothstep(0.05, 0.3, tau);
  under += uGordonF * uw.bb / uw.K * uSunIrr * max(L.y, 0.0) * shadow * glowUp * 0.6 / PI;

  float NoV = max(dot(N, V), 1e-3);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 Rd = reflect(-V, N);
  Rd.y = abs(Rd.y);
  vec3 refl = skyRadiance(Rd);
  float rough = 0.08;
  float a2 = rough * rough;
  vec3 Hh = normalize(V + L);
  float NoH = max(dot(N, Hh), 0.0), NoL = max(dot(N, L), 0.0);
  float D = a2 / (PI * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
  float k = rough * 0.5;
  float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 spec = uSunIrr * shadow * D * Fs * G / (4.0 * NoV + 1e-4);
  vec3 col = under * (1.0 - F) + refl * F + spec;

  // White water: the lip's edge tears into foam as it throws; the crest feathers; on impact
  // and in the collapse everything turns white; foam from earlier waves streaks the face. The
  // lace is laid out on the ribbon itself (along the beach, and across the wave), so it
  // stretches with the water instead of smearing down a steep face.
  vec2 rp = vec2(vAlong, v * max(H, 0.5) * 6.0);
  vec2 lp = lacePattern(rp * 1.3 + vec2(0.0, -tau * 3.0), 0.02);
  float tear = vnoise(vec2(vAlong * 1.7, tau * 6.0)) * 0.5 + vnoise(vec2(vAlong * 5.3, v * 30.0)) * 0.5;
  float edge = smoothstep(0.36, 0.45, v + tear * 0.05) * (1.0 - smoothstep(0.5, 0.58, v - tear * 0.06)) * smoothstep(0.12, 0.45, tau);
  float feather = smoothstep(0.2, 0.26, v) * (1.0 - smoothstep(0.3, 0.38, v)) * smoothstep(0.05, 0.2, tau) * (1.0 - smoothstep(0.5, 0.7, tau));
  float impact = smoothstep(0.62, 0.95, tau) * smoothstep(0.2, 0.4, v);
  float streak = sim.r * smoothstep(0.62, 0.8, v) * 0.5;
  float amount = clamp(max(max(edge * (0.55 + 0.6 * tear), feather * 0.6), max(impact, streak)) * uFoam, 0.0, 1.0);
  float foam = smoothstep(1.0 - amount - 0.08, 1.0 - amount + 0.08, lp.x);
  foam = max(foam, smoothstep(0.9, 1.0, amount));
  // White water is a heap of bubbles: its lumps shade each other and face the sun or not
  // (in the noon sun it would otherwise just be clipped white).
  vec3 rel = foamRelief(rp * 0.8 + vec2(0.0, tau * 2.0), fp, uTime);
  vec3 Nf = normalize(N + tA * rel.y + tB * rel.z);
  vec3 foamRad = vec3(0.78) * rel.x / PI * (uSunIrr * max(dot(Nf, L), 0.15) * shadow + uSkyIrr * rel.x);
  col = mix(col, foamRad, foam);

  gl_FragColor = vec4(col * vApT + vApIns, 1.0);
  // Debug views skip the exposure and tone curve so their values read straight.
  if (uDebug == 9) { gl_FragColor = vec4(v, tau, vInfo.z / 4.0, 1.0); return; }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uLabel > 0.5) gl_FragColor = vec4(2.0 / 255.0, log2(max(distance(vWorld, cameraPosition), 1.0)) / 20.0, 1.0, 1.0);
}
`;

export function createBreaker(waterUniforms) {
  const material = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  mesh.visible = false;

  // Rows across the wave, with more of them on the lip.
  const NV = 96;
  const vs = Array.from({ length: NV }, (_, i) => i / (NV - 1));

  return {
    mesh,
    material,
    // Build the ribbon along the waterlines from the worker (x, y, nx, ny, along; NaN ends a run).
    setLines(lines) {
      const cols = [];
      const runs = [];
      let run = [];
      for (let k = 0; k < lines.length; k += 5) {
        if (Number.isNaN(lines[k])) { if (run.length > 1) runs.push(run); run = []; continue; }
        run.push(k);
      }
      if (run.length > 1) runs.push(run);
      let nCols = 0;
      for (const r of runs) nCols += r.length;
      const line = new Float32Array(nCols * NV * 4), prof = new Float32Array(nCols * NV * 2);
      const index = [];
      let base = 0;
      for (const r of runs) {
        r.forEach((k, c) => {
          for (let j = 0; j < NV; j++) {
            const o = (base + c) * NV + j;
            line.set([lines[k], lines[k + 1], lines[k + 2], lines[k + 3]], o * 4);
            prof[o * 2] = vs[j]; prof[o * 2 + 1] = lines[k + 4];
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
      g.setAttribute('aProf', new THREE.BufferAttribute(prof, 2));
      g.setIndex(index);
      mesh.geometry.dispose();
      mesh.geometry = g;
      mesh.visible = nCols > 0;
      return { runs: runs.length, columns: nCols };
    },
  };
}
