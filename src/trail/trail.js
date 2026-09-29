// The path in the page (v6): the treads, logs, posts, rails and rope the worker built
// (geometry.js), lit like the ground. Each material is three.js's standard one, patched as the
// ground's is (terrain-mesh.js): the sun from the atmosphere, cut by the baked shadow of the
// island and the clouds', the sky as a light probe, light bounced up from the ground below,
// and the haze added before the tone curve. The surfaces are scanned (surfaces.js, CC0), mapped
// in world metres or in each piece's own frame, so they need no texture coordinates; until the
// scans load, or without them, the shader's own noise stands in.

import * as THREE from 'three';
import { SKY_PARS, AERIAL_VERT_PACKED, AERIAL_FRAG_PACKED } from '../sky/atmosphere-glsl.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { TRAIL_SURFACES } from './surfaces.js';
import { loadSurfaceTextures } from '../terrain/surface-textures.js';

const srgbGain = (s) => s.target.map((t, i) => Math.pow(t, 2.2) / Math.pow(s.avg[i], 2.2));

// Thin, weathered blue cord. The post piece crosses over the face of the rail as well as wrapping
// the post; the rail piece adds the tight turns on either side. lane 1 reaches the second,
// overlapping rail. There are three small variations per lane, shared by the instances.
function lashingGeometry(kind, variant, lane = 0) {
  let seed = 9173 + variant * 4409 + lane * 739 + (kind === 'rail' ? 77 : 0);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pos = [], nrm = [], tr = [], idx = [];
  const tube = (path, radius, radial, bridgeInset = 0) => {
    const n = path.length, base = pos.length / 3;
    // Frames along the path by parallel transport.
    const tan = path.map((p, i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...t) || 1;
      return t.map((v) => v / l);
    });
    let N = Math.abs(tan[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let along = 0;
    for (let i = 0; i < n; i++) {
      const t = tan[i];
      const d = N[0] * t[0] + N[1] * t[1] + N[2] * t[2];
      N = [N[0] - t[0] * d, N[1] - t[1] * d, N[2] - t[2] * d];
      const nl = Math.hypot(...N) || 1; N = N.map((v) => v / nl);
      const B = [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]];
      if (i > 0) along += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
        const nx = N[0] * c + B[0] * s2, ny = N[1] * c + B[1] * s2, nz = N[2] * c + B[2] * s2;
        pos.push(path[i][0] + nx * radius, path[i][1] + ny * radius, path[i][2] + nz * radius);
        nrm.push(nx, ny, nz);
        tr.push(a, along, bridgeInset > 0 ? 1 : 0, bridgeInset);
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * radial + j, b = base + i * radial + (j + 1) % radial;
        const c = base + (i + 1) * radial + (j + 1) % radial, d = base + (i + 1) * radial + j;
        idx.push(a, d, c, a, c, b);
      }
    }
  };
  const cord = 0.0025, TAU = Math.PI * 2;
  if (kind === 'post') {
    const postR = 0.0432, railR = 0.0287, inset = lane ? 0.109 : 0.055;
    // Adjacent rail spans meet at a post. Stagger the outer rail's bands vertically so the two
    // lashings do not become duplicate concentric rings.
    const bandY = (lane ? 0.049 : 0.036) + (variant - 1) * 0.0018;
    const band = (sign, turns) => {
      const phase = rnd() * TAU, steps = Math.ceil(turns * 12);
      const path = [];
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, th = phase + t * turns * TAU;
        path.push([postR * Math.cos(th), sign * (bandY + 0.006 * t), postR * Math.sin(th)]);
      }
      tube(path, cord, 4);
    };
    band(1, lane ? 1.0 : [1.5, 1.0, 1.5][variant]);
    band(-1, 1.0);

    // Two taut diagonal strands run from the post over the exposed face of the rail. Their
    // curved middle follows the rail's circular section; one passes over the other at the X.
    const railSurface = railR + cord + 0.0008;
    for (let cross = 0; cross < 2; cross++) {
      const dir = cross ? -1 : 1, path = [];
      const sideX = 0.026, postZ = Math.sqrt(postR * postR - sideX * sideX) + cord;
      path.push([-dir * sideX, bandY, postZ]);
      path.push([-dir * 0.031, railSurface + 0.001, inset]);
      for (let j = 0; j <= 8; j++) {
        const t = j / 8, y = railSurface * (1 - 2 * t);
        const x = dir * 0.030 * (2 * t - 1);
        const z = inset + Math.sqrt(Math.max(0, railSurface * railSurface - y * y))
          + (cross ? 0.005 * Math.pow(Math.sin(Math.PI * t), 8) : 0);
        path.push([x, y, z]);
      }
      path.push([dir * 0.031, -railSurface - 0.001, inset]);
      path.push([dir * sideX, -bandY, postZ]);
      tube(path, cord * 0.92, 4, inset);
    }

    // Compact overhand knot on the inner face, with one short end falling under its own weight.
    const knotY = -bandY - 0.004, knotZ = postR + cord * 2;
    tube([[0.002, knotY + 0.003, knotZ], [0.009, knotY + 0.006, knotZ + 0.003],
      [0.014, knotY, knotZ + 0.002], [0.009, knotY - 0.003, knotZ]], cord * 1.15, 4);
    const tail = 0.024 + 0.012 * rnd();
    tube([[0.010, knotY - 0.003, knotZ], [0.015, knotY - tail * 0.5, knotZ + 0.001],
      [0.017 + 0.004 * (rnd() - 0.5), knotY - tail, knotZ - 0.003]], cord * 0.86, 3);
  } else {
    // Uneven tight turns around the rail, immediately beside the crossing instead of broad cuffs.
    const turns = [[1.5, 1.25], [1.25, 1.5], [1.75, 1.0]][variant];
    for (const [side, n] of [[1, turns[0]], [-1, turns[1]]]) {
      const path = [], steps = Math.ceil(n * 12), phase = rnd() * TAU;
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, th = phase + t * n * TAU;
        path.push([side * (0.034 + 0.006 * n * t), 0.0287 * Math.sin(th), 0.0287 * Math.cos(th)]);
      }
      tube(path, cord, 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aTrail', new THREE.Float32BufferAttribute(tr, 4));
  g.setIndex(idx);
  return g;
}

function patch(src, find, repl) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`trail shader patch matched ${n} times: ${find.slice(0, 60)}`);
  return src.replace(find, () => repl);
}

const VERT_PARS = /* glsl */ `
varying vec3 vWorldPos;
varying vec4 vTrail;      // treads: across (-1..1, beyond on a skirt), metres along, face kind
varying vec3 vLocal;      // instances: position in the shape's own frame, in metres
varying vec3 vLocalN;     // and the normal in it
varying vec3 vScale;      // the shape's size (m)
varying mat3 vRot;        // its own axes in the world
varying float vRand;
varying float vWear;      // one weathering value per tread, shared by all its top vertices
attribute vec4 aTrail;
attribute float aRand;
attribute float aWear;
${AERIAL_VERT_PACKED}
`;

const VERT_BEGIN = /* glsl */ `
vTrail = aTrail;
vWear = aWear;
vLocalN = normal;
#ifdef USE_INSTANCING
  vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#ifdef TR_ROPE
  // The post frame scales with its radius. Keep the crossing's rail end centred on the actual
  // rail offset, fading the correction away where the strand meets the post band.
  if (aTrail.z > 0.5) {
    float towardRail = smoothstep(0.038, aTrail.w, position.z);
    transformed.z += towardRail * aTrail.w * (1.0 / max(sc.z, 1e-3) - 1.0);
  }
#endif
  vLocal = position * sc;
  vScale = sc;
  vRot = mat3(instanceMatrix[0].xyz / sc.x, instanceMatrix[1].xyz / sc.y, instanceMatrix[2].xyz / sc.z);
  vRand = aRand;
#ifdef TR_BAMBOO
  {
    // (v13) A bamboo pole is not a ruler: fatter at the foot and thinner at the top, bowed a
    // centimetre or two whichever way it grew, and cut on a slant where it was sawn.
    float hy = position.y + 0.5;
#ifdef BAMBOO_POST
    float taper = mix(1.1, 0.9, hy);
#else
    float taper = mix(1.03, 0.97, hy);
#endif
    float ang = aRand * 37.0;
    vec2 bow = vec2(cos(ang), sin(ang)) * (0.012 + 0.014 * fract(aRand * 7.3)) * sin(3.14159 * hy) / max(sc.x, 1e-3);
    transformed.xz = transformed.xz * taper + bow;
    // The cut: the top face tilted about 25 degrees, toward a direction of its own.
    float cutA = aRand * 91.0;
    transformed.y += step(0.499, position.y) * 0.47 * sc.x / max(sc.y, 1e-3) * (cos(cutA) * position.x + sin(cutA) * position.z);
  }
#endif
#else
  vLocal = position;
  vScale = vec3(1.0);
  vRot = mat3(1.0);
  vRand = 0.0;
#endif
`;

const VERT_WORLD = /* glsl */ `
{
  vec4 wp4 = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wp4 = instanceMatrix * wp4;
#endif
  vWorldPos = (modelMatrix * wp4).xyz;
}
`;

const FRAG_PARS = /* glsl */ `
${SKY_PARS}
${AERIAL_FRAG_PACKED}
${CLOUD_SHADOW_GLSL}
uniform vec3 uExtent;
uniform vec3 uSunDirW;
uniform vec3 uGroundAlb;     // what the ground around the path sends back up
uniform vec2 uSections;      // where the concrete ends and where the ridge path ends (m along)
uniform float uClayT;
precision highp sampler2DArray;
uniform sampler2DArray uTrColor;
uniform sampler2DArray uTrNormal;
uniform sampler2DArray uTrMask;
uniform vec3 uTrGain[${TRAIL_SURFACES.length}];
uniform float uTrTile[${TRAIL_SURFACES.length}];
uniform float uTrScans;      // 1 once the scans are in
${SUN_SHADOW_GLSL}
varying vec3 vWorldPos;
varying vec4 vTrail;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vScale;
varying mat3 vRot;
varying float vRand;
varying float vWear;
#define T_CONCRETE 0
#define T_DIRT 1
#define T_WOOD 2
#define T_BARK 3
struct TS { vec3 color; vec3 dn; float rough; float ao; };
// One read of a scan at uv (tiles), with explicit gradients; its normal turned into the world by
// the directions of u and of the map's green (UDN).
void tsRead(int L, vec2 uv, vec2 gx, vec2 gy, vec3 axU, vec3 axV, float w, inout TS s) {
  vec3 c = textureGrad(uTrColor, vec3(uv, float(L)), gx, gy).rgb;
  vec3 n = textureGrad(uTrNormal, vec3(uv, float(L)), gx, gy).xyz * 2.0 - 1.0;
  vec2 m = textureGrad(uTrMask, vec3(uv, float(L)), gx, gy).rg;
  s.color += c * uTrGain[L] * w; s.dn += (axU * n.x + axV * n.y) * w; s.rough += m.r * w; s.ao += m.g * w;
}
// World-space triplanar (as the ground's): x and z faces with v up, y faces seen from above.
TS tsTri(int L, vec3 P, vec3 N, vec2 off) {
  TS s = TS(vec3(0.0), vec3(0.0), 0.0, 0.0);
  float k = 1.0 / uTrTile[L];
  vec3 w = pow(abs(N), vec3(4.0)); w /= w.x + w.y + w.z; w = max(w - 0.05, 0.0); w /= w.x + w.y + w.z;
  vec3 dx = dFdx(P), dy = dFdy(P);
  if (w.x > 0.0) tsRead(L, vec2(P.z, -P.y) * k + off, vec2(dx.z, -dx.y) * k, vec2(dy.z, -dy.y) * k, vec3(0, 0, 1), vec3(0, 1, 0), w.x, s);
  if (w.y > 0.0) tsRead(L, P.xz * k + off, dx.xz * k, dy.xz * k, vec3(1, 0, 0), vec3(0, 0, -1), w.y, s);
  if (w.z > 0.0) tsRead(L, vec2(P.x, -P.y) * k + off, vec2(dx.x, -dx.y) * k, vec2(dy.x, -dy.y) * k, vec3(1, 0, 0), vec3(0, 1, 0), w.z, s);
  return s;
}
// In a piece's own frame, with the grain (the map's v) along its longest side: timber posts and
// rails. The face's other side is u. End grain gets a patch of the same scan.
TS tsGrain(int L, float off) {
  TS s = TS(vec3(0.0), vec3(0.0), 0.0, 0.0);
  float k = 1.0 / uTrTile[L];
  int g = vScale.x >= vScale.y && vScale.x >= vScale.z ? 0 : (vScale.y >= vScale.z ? 1 : 2);
  vec3 G = g == 0 ? vec3(1, 0, 0) : (g == 1 ? vec3(0, 1, 0) : vec3(0, 0, 1));
  vec3 aN = abs(vLocalN);
  vec3 F = aN.x > aN.y && aN.x > aN.z ? vec3(1, 0, 0) : (aN.y > aN.z ? vec3(0, 1, 0) : vec3(0, 0, 1));
  vec3 U = abs(dot(F, G)) > 0.5 ? (g == 1 ? vec3(1, 0, 0) : vec3(0, 1, 0)) : cross(F, G);
  vec3 V = abs(dot(F, G)) > 0.5 ? cross(F, U) : G;
  vec2 uv = vec2(dot(vLocal, U) + off, dot(vLocal, V) + off * 1.7) * k;
  tsRead(L, uv, dFdx(uv), dFdy(uv), vRot * U, vRot * V, 1.0, s);
  return s;
}
// Round a cylinder along its own y (logs): u around it, v along it.
TS tsBark(int L, float off) {
  TS s = TS(vec3(0.0), vec3(0.0), 0.0, 0.0);
  float k = 1.0 / uTrTile[L];
  float a = atan(vLocal.x, vLocal.z);
  vec2 uv = vec2(a * vScale.x + off, vLocal.y + off * 3.1) * k;
  // Gradients of the distance round it from the position's, not the angle's, which jumps where
  // it wraps round (a line of the smallest mip level down the back of every log).
  float r2 = max(dot(vLocal.xz, vLocal.xz), 1e-8);
  vec2 gx = vec2(vScale.x * (vLocal.z * dFdx(vLocal.x) - vLocal.x * dFdx(vLocal.z)) / r2, dFdx(vLocal.y)) * k;
  vec2 gy = vec2(vScale.x * (vLocal.z * dFdy(vLocal.x) - vLocal.x * dFdy(vLocal.z)) / r2, dFdy(vLocal.y)) * k;
  vec3 around = normalize(vec3(vLocal.z, 0.0, -vLocal.x));
  tsRead(L, uv, gx, gy, vRot * around, vRot * vec3(0, 1, 0), 1.0, s);
  return s;
}
float trShadow = 1.0;
float trSelf = 1.0;     // (v10) the step above's own shadow, at the back of a tread
vec3 trNormal = vec3(0.0, 1.0, 0.0);
float trRough = 0.9;
float trAO = 1.0;

float th(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float th3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float tn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1, 0)), u.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), u.x), u.y); }
float tn3(vec3 p) { vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(th3(i), th3(i + vec3(1, 0, 0)), u.x), mix(th3(i + vec3(0, 1, 0)), th3(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(th3(i + vec3(0, 0, 1)), th3(i + vec3(1, 0, 1)), u.x), mix(th3(i + vec3(0, 1, 1)), th3(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z); }
// fbm whose octaves stop once they are smaller than a couple of pixels (fp: metres per pixel).
float fb(vec2 p, float scale, float fp) {
  float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 5; i++) {
    float keep = smoothstep(2.0 * fp, 4.0 * fp, scale / f);
    if (keep <= 0.0) break;
    s += a * keep * (tn(p * f + float(i) * 17.3) - 0.5);
    a *= 0.5; f *= 2.03;
  }
  return 0.5 + s;
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

// The surface of this piece: albedo, and the normal, roughness and occlusion into the globals.
vec3 trailSurface(vec3 P, vec3 N, float fp) {
  vec2 g = vec2(P.x, -P.z);
  vec3 col = vec3(0.5);
  trNormal = N;
#if defined(TR_CONCRETE)
  // Grey cast concrete (concrete_floor_02), a little warm, with the grime of a few years
  // outdoors: lighter where feet wear the middle of each tread, darker towards the edges, the
  // sides stained with soil.
  float kind = vTrail.z;
  float edge = smoothstep(0.55, 1.0, abs(vTrail.x));
  float worn = (1.0 - edge) * step(kind, 0.5);
  float n2 = fb(g * 0.21 + 3.0, 5.0, fp);
  // Dust and soil settle in broad, broken patches. The second scale interrupts each stain
  // so the scan does not read as one clean aggregate tile repeated on every going.
  float grit = smoothstep(0.35, 0.64, tn(g * 0.74 + vec2(19.1, 7.4)))
    * (0.50 + 0.50 * tn(g * 2.6 + vec2(3.7, 11.3)));
  if (uTrScans > 0.5) {
    TS t = tsTri(T_CONCRETE, P, N, vec2(0.0));
    col = t.color * (0.9 + 0.2 * n2);
    trNormal = normalize(N + t.dn * 0.8);
    trRough = t.rough; trAO = t.ao;
  } else {
    float n1 = fb(g * 1.3 + P.y * 0.7, 0.8, fp);
    col = lin(vec3(0.60, 0.59, 0.56)) * (0.82 + 0.36 * n1) * (0.9 + 0.2 * n2);
    trRough = 0.88;
  }
  col *= mix(1.0, 1.1, worn * 0.7);
  col *= mix(vec3(1.0), vec3(0.78, 0.76, 0.72), edge * 0.8);
  col *= mix(vec3(1.0), vec3(0.42, 0.39, 0.35), grit * (0.62 + 0.30 * edge));
  col *= mix(vec3(0.84, 0.82, 0.79), vec3(1.07, 1.06, 1.04), clamp(vWear, 0.0, 1.0));
  trRough = mix(trRough, 0.96, grit * 0.35);
  // (v10) Grit and soil collect at the back of each tread, against the riser above: from
  // above, the flight reads as steps (it was a smooth pale ramp).
  // Plus a darker line in the corner itself. And the concrete greyer than the scan came out in
  // the noon sun (it read as white; the photo's steps are a light grey).
  if (kind < 0.5) {
    float bw = vTrail.w + 0.04 * (n2 - 0.5);
    col *= mix(vec3(0.5, 0.47, 0.42), vec3(1.0), smoothstep(0.015, 0.13, bw)) * mix(0.7, 1.0, smoothstep(0.0, 0.02, bw));
    // The noon sun stands a little north of overhead here in April: each riser throws a strip
    // of shadow about 5 cm deep over the back of the tread below it.
    trSelf = smoothstep(0.045, 0.06, bw + 0.01 * (n2 - 0.5));
    // Looking down a flight the nosings hide the backs of the treads, so what shows each step
    // is its front edge: chipped and grimy, rounded off, and so darker (the photo's lines).
    float fw = kind + 0.015 * (n2 - 0.5);
    float nose = 1.0 - smoothstep(0.012, 0.045, fw);
    col *= mix(1.0, 0.5, nose);
    trSelf = min(trSelf, mix(1.0, 0.45, 1.0 - smoothstep(0.0, 0.02, fw)));
  }
  col *= 0.8;
  trRough -= 0.1 * worn;
  if (kind > 2.5) col *= mix(vec3(1.0), vec3(0.7, 0.62, 0.52), 0.5 * n2);   // risers: soil splashed up
  if (kind > 0.5 && kind < 1.5) col *= vec3(0.74, 0.7, 0.64);               // the sides, down in the soil
#elif defined(TR_DIRT)
  // The dirt path (rocky_trail): pale, dusty and stony on the ridge (trail-top-railing.jpg),
  // browner earth lower down, shaded and damp (trail-mid-descent-b.jpg). Trodden smoother and
  // paler along the middle; the skirts blend into the ground beside it.
  float along = vTrail.y;
  float lower = smoothstep(uSections.y - 12.0, uSections.y + 25.0, along);
  float a = abs(vTrail.x);
  float trod = 1.0 - smoothstep(0.3, 0.95, a);
  float n1 = fb(g * 0.9, 1.2, fp), n3 = fb(g * 0.13, 8.0, fp);
  float packed = smoothstep(0.38, 0.66, tn(g * 0.68 + vec2(13.2, 5.7)));
  float finer = smoothstep(0.46, 0.7, tn(g * 2.9 + vec2(8.1, 1.4)));
  if (uTrScans > 0.5) {
    // Two readings, scaled and offset against each other and handed over by a noise, so the
    // 2 m tile does not repeat down 300 m of path.
    TS t = tsTri(T_DIRT, P, N, vec2(0.0));
    TS t2 = tsTri(T_DIRT, P * 0.73 + vec3(3.1, 0.0, 1.7), N, vec2(0.37, 0.61));
    float m = smoothstep(0.35, 0.65, fb(g * 0.35 + 7.0, 3.0, fp));
    t.color = mix(t.color, t2.color, m); t.dn = mix(t.dn, t2.dn, m); t.rough = mix(t.rough, t2.rough, m); t.ao = mix(t.ao, t2.ao, m);
    col = t.color;
    // Trodden: the grit pressed in, the relief flatter.
    col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))) * vec3(1.06, 1.0, 0.92), trod * 0.25);
    trNormal = normalize(N + t.dn * mix(1.0, 0.55, trod));
    trRough = t.rough; trAO = mix(t.ao, 1.0, trod * 0.3);
  } else {
    col = lin(vec3(0.62, 0.58, 0.51)) * (0.72 + 0.56 * n1);
    trRough = 0.95;
  }
  col *= mix(vec3(1.0), vec3(0.76, 0.66, 0.55), lower) * (0.88 + 0.24 * n3);
  // Gravel islands interrupt a compacted brown walking line. The reference path is packed
  // soil with stones embedded in it, rather than a continuous sheet of loose aggregate.
  float earthCover = clamp(0.16 + 0.59 * packed + 0.18 * trod - 0.08 * lower, 0.0, 0.86);
  vec3 earth = mix(lin(vec3(0.39, 0.35, 0.29)), lin(vec3(0.34, 0.30, 0.25)), lower)
    * (0.84 + 0.25 * n3);
  col = mix(col, earth, earthCover);
  col *= mix(vec3(1.0), vec3(0.79, 0.74, 0.68), finer * (0.08 + 0.12 * lower));
  col *= mix(0.92, 1.04, clamp(vWear, 0.0, 1.0));
  trNormal = normalize(mix(trNormal, N, earthCover * 0.38));
  // Skirts and the sides of the steps: the ground at the edge, darker and greener.
  if (vTrail.z > 1.5 && vTrail.z < 2.5) col = mix(col, uGroundAlb * (0.8 + 0.4 * n1), smoothstep(1.0, 1.4, a) * 0.75);
  if (vTrail.z > 2.5) col *= 0.72;   // the riser: packed earth, in its own shadow, damp
  // (v10) Loose soil at the back of each tread, darker and browner.
  if (vTrail.z < 0.5) {
    col *= mix(vec3(0.7, 0.62, 0.52), vec3(1.0), smoothstep(0.03, 0.16, vTrail.w + 0.05 * (n1 - 0.5)));
    // (v13: a floor of 0.3. The nosing shades the foot of the riser, but the sun has a width and the
    // soil there is lit by the sky and by light off the risers: it was a pure black strip.)
    trSelf = mix(0.3, 1.0, smoothstep(0.035, 0.09, vTrail.w + 0.03 * (n1 - 0.5)));
  }
#elif defined(TR_WOOD)
#ifdef LOG
  // Logs across the dirt steps (bark_brown_02), the moss mostly gone, muddy underneath.
  if (uTrScans > 0.5) {
    TS t = tsBark(T_BARK, vRand * 5.3);
    // (v10) Each log weathered its own way: fresh bark, sun-greyed, or dark and rotting.
    float age = fract(vRand * 3.17);
    col = mix(t.color, vec3(dot(t.color, vec3(0.3, 0.55, 0.15))) * vec3(1.05, 1.0, 0.92), 0.2 + 0.55 * age);
    col *= mix(1.0, 0.55, smoothstep(0.8, 1.0, fract(vRand * 7.31)));
    trNormal = normalize(N + t.dn); trRough = t.rough; trAO = t.ao;
  } else col = lin(vec3(0.33, 0.27, 0.21));
  col *= mix(0.6, 1.0, smoothstep(-0.6, 0.4, N.y));
#else
  // Sawn timber left out for years (weathered_planks): grey-brown, darker on the concrete steps
  // (trail-stairs-viewpoint.jpg), each post and rail its own shade.
  if (uTrScans > 0.5) {
    TS t = tsGrain(T_WOOD, vRand * 7.9);
    col = t.color;
    trNormal = normalize(N + t.dn); trRough = t.rough; trAO = t.ao;
  } else col = lin(vec3(0.4, 0.37, 0.33));
  // (On the concrete steps, everything above about 100 m, the timber is the darker kind.)
  col *= mix(0.6, 1.15, vRand) * mix(1.0, 0.62, smoothstep(96.0, 104.0, vWorldPos.y));
#endif
#elif defined(TR_BAMBOO)
  // Bamboo poles: straw to grey-green, glossy between the nodes, a ring every 25 to 40 cm.
  // (v13: the rings stand up, dark, with the pole a shade paler above each; fine fibres run along it,
  // and here and there a split.)
  float along = vLocal.y + vRand * 3.0;
  float seg = 0.25 + 0.15 * vRand;
  float ang = atan(vLocal.x, vLocal.z);
  float sd = (fract(along / seg) - 0.5) * seg;                       // metres to the ring, signed
  float node = 1.0 - smoothstep(0.003, 0.016, abs(sd));
  float streak = tn(vec2(along * 3.0, ang * 6.0));
  float fib = tn(vec2(along * 1.6, ang * 11.0)) * 0.6 + tn(vec2(along * 5.0 + 3.0, ang * 27.0)) * 0.4;
  // Most poles are sun-greyed tan. A few retain warmer bamboo colour, without reading yellow.
  vec3 fresh = lin(vec3(0.59, 0.50, 0.34)), old = lin(vec3(0.46, 0.43, 0.36));
  col = mix(fresh, old, smoothstep(0.15, 0.45, vRand)) * (0.78 + 0.28 * streak) * (0.86 + 0.28 * fib);
  col *= mix(vec3(1.0), vec3(0.7, 0.68, 0.62), smoothstep(0.55, 0.8, tn(vec2(along * 1.7, vRand * 30.0))) * 0.6);   // grime
  col *= 1.0 - 0.29 * node;
  col *= mix(1.0, 1.08, smoothstep(0.0, 0.05, sd) * (1.0 - smoothstep(0.05, 0.13, sd)));
  float split = smoothstep(0.9, 0.96, tn(vec2(along * 0.8 + 5.0, ang * 2.5 + vRand * 40.0)));
  col *= 1.0 - 0.45 * split * smoothstep(0.35, 0.0, abs(fract(along * 0.5) - 0.5));
  trNormal = normalize(N + vRot * vec3(0.0, sign(sd) * node * 0.5 * smoothstep(0.0, 0.004, abs(sd)) + (fib - 0.5) * 0.0, 0.0));
  trRough = mix(0.72, 0.87, vRand) + 0.08 * node;
#elif defined(TR_STONE)
  // (v10) Loose limestone: pale and dusty grey, pitted, each stone its own shade, stained with
  // soil where it sits in the ground.
  if (uTrScans > 0.5) {
    TS t = tsTri(T_CONCRETE, P * 1.6 + vRand * 5.0, N, vec2(vRand, fract(vRand * 3.7)));
    col = t.color; trNormal = normalize(N + t.dn * 1.2); trRough = t.rough; trAO = t.ao;
  } else col = lin(vec3(0.62, 0.6, 0.56));
  col = mix(col, vec3(dot(col, vec3(0.33))), 0.35) * mix(0.72, 1.12, vRand) * vec3(1.02, 1.0, 0.96);
  float soil = 1.0 - smoothstep(-0.55, 0.05, vLocal.y / max(vScale.y, 1e-3));
  col = mix(col, col * vec3(0.66, 0.56, 0.44), soil * 0.8);
  trRough = 0.85;
#elif defined(TR_ROPE)
  // Weathered blue synthetic cord, with a subtle three-strand twist and dusty high spots.
  // vTrail stores the angle round the cord and metres along its length.
  float ph = vTrail.y * 785.0 + vTrail.x * 2.0;
  float tw = sin(ph);
  tw = mix(tw, 0.0, smoothstep(1.0, 3.0, fwidth(ph)));
  vec3 fresh = lin(vec3(0.05, 0.35, 0.60)), faded = lin(vec3(0.18, 0.39, 0.53));
  col = mix(fresh, faded, smoothstep(0.12, 0.9, vRand)) * (0.92 + 0.065 * tw);
  col *= mix(vec3(1.0), vec3(0.77, 0.73, 0.68), 0.4 * tn(vLocal.xy * 90.0 + vRand * 20.0));
  trRough = 0.87;
#endif
  if (uClayT > 0.5) { col = lin(vec3(0.74, 0.72, 0.68)); trNormal = N; trRough = 0.93; }
  return col;
}
`;

const FRAG_COLOR = /* glsl */ `
  vec3 trN = normalize(vNormal);
  // (vNormal is in view space; the surface works in world space.)
  vec3 trNw = normalize((vec4(trN, 0.0) * viewMatrix).xyz);
  if (!gl_FrontFacing) trNw = -trNw;
  float trFp = max(length(fwidth(vWorldPos)), 0.001);
  diffuseColor.rgb = trailSurface(vWorldPos, trNw, trFp);
  trShadow = bakedShadow(vWorldPos + trNw * 0.3, 0.2) * cloudShadow(vWorldPos, uSunDirW) * trSelf;
`;

export function createTrail(lightUniforms = {}, gradeUniforms = {}, shared = {}) {
  const uniforms = {
    uExtent: shared.uExtent ?? { value: new THREE.Vector3(-700, -700, 1600) },
    uSunShadow: shared.uSunShadow ?? { value: null },
    uSunDirW: lightUniforms.uSunDir ?? { value: new THREE.Vector3(0, 1, 0) },
    uGroundAlb: { value: new THREE.Vector3(0.06, 0.08, 0.03) },
    uSections: { value: new THREE.Vector2(84, 178) },
    uClayT: { value: 0 },
    uTrColor: { value: null }, uTrNormal: { value: null }, uTrMask: { value: null },
    uTrGain: { value: TRAIL_SURFACES.map((s) => new THREE.Vector3(...srgbGain(s))) },
    uTrTile: { value: TRAIL_SURFACES.map((s) => s.tile) },
    uTrScans: { value: 0 },
  };
  // The scans (surfaces.js), a small texture array of their own.
  const ready = loadSurfaceTextures(globalThis.__klAssets?.textures ?? 'assets/textures/', TRAIL_SURFACES, 2048).then((t) => {
    uniforms.uTrColor.value = t.color; uniforms.uTrNormal.value = t.normal; uniforms.uTrMask.value = t.mask;
    uniforms.uTrScans.value = 1;
  }).catch((e) => console.error('trail textures failed', e));

  function material(kind, extra = {}) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: kind === 'dirt' || kind === 'concrete' ? THREE.DoubleSide : THREE.FrontSide });
    m.defines = { ['TR_' + kind.toUpperCase()]: 1, ...extra };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, lightUniforms, gradeUniforms, uniforms);
      shader.vertexShader = [
        ['#include <common>', '#include <common>\n' + VERT_PARS],
        ['#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BEGIN],
        ['#include <project_vertex>', '#include <project_vertex>\n' + VERT_WORLD + 'aerialVertex(vWorldPos);'],
      ].reduce((s, [f, r]) => patch(s, f, r), shader.vertexShader);
      shader.fragmentShader = [
        ['#include <common>', '#include <common>\n' + FRAG_PARS],
        ['#include <color_fragment>', FRAG_COLOR],
        ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(trRough, 0.2, 1.0);'],
        ['#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(trNormal, 0.0)).xyz);'],
        ['#include <lights_fragment_begin>', patch(THREE.ShaderChunk.lights_fragment_begin,
          'getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= trShadow;')],
        // Light bounced up from the ground round the path: the lower half of the view, lit by
        // the sun and the sky.
        ['#include <aomap_fragment>', `#include <aomap_fragment>
          reflectedLight.indirectDiffuse *= trAO;
          reflectedLight.directDiffuse *= mix(1.0, trAO, 0.4);
          { vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            reflectedLight.indirectDiffuse += uGroundAlb * (uSunIrr * max(uSunDirW.y, 0.0) + uSkyUp) * 0.5 * (1.0 - nW.y) * BRDF_Lambert(material.diffuseColor); }`],
        ['#include <tonemapping_fragment>', 'gl_FragColor.rgb = gl_FragColor.rgb * vAp.a + vAp.rgb;\n#include <tonemapping_fragment>'],
      ].reduce((s, [f, r]) => patch(s, f, r), shader.fragmentShader);
    };
    return m;
  }

  const mats = {
    concrete: material('concrete'), dirt: material('dirt'), timber: material('wood'), log: material('wood', { LOG: 1 }),
    bamboo: material('bamboo'), bambooPost: material('bamboo', { BAMBOO_POST: 1 }), rope: material('rope'), stone: material('stone'),
  };
  const group = new THREE.Group();
  group.name = 'trail';
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  const unitCylRail = new THREE.CylinderGeometry(1, 1, 1, 10, 6, false);   // (bamboo rails: bowed in the vertex shader)
  const unitCylFine = new THREE.CylinderGeometry(1, 1, 1, 14, 10, false);
  const lashPostGeo = [0, 1, 2, 3, 4, 5].map((v) => lashingGeometry('post', v % 3, Math.floor(v / 3)));
  const lashRailGeo = [0, 1, 2].map((v) => lashingGeometry('rail', v));
  // (v10) A stone: a faceted, lumpy ball, flat underneath, about 1 across. Limestone breaks
  // into angular pieces, so its facets stay (no smoothing across them).
  const unitStone = (() => {
    const g = new THREE.IcosahedronGeometry(0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.16 * Math.sin(x * 7.1 + y * 3.3) + 0.12 * Math.sin(z * 9.7 - x * 4.1) + 0.08 * Math.sin(y * 13.0 + z * 5.0);
      p.setXYZ(i, x * k, Math.max(y * k, -0.28), z * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  // Depth first, with the ground's own depth pass (terrain-mesh.js), so the ground's shader,
  // the most expensive on screen, does not run under the treads only to be painted over.
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const withPrepass = (m) => {
    const p = m.isInstancedMesh ? new THREE.InstancedMesh(m.geometry, depthOnly, m.count) : new THREE.Mesh(m.geometry, depthOnly);
    if (m.isInstancedMesh) p.instanceMatrix = m.instanceMatrix;
    p.renderOrder = -2;
    p.frustumCulled = m.frustumCulled;
    if (m.boundingSphere) p.boundingSphere = m.boundingSphere;
    p.name = m.name + '-depth';
    group.add(p);
  };

  // (v13) The cord lashings, of which only those near the camera are given to the GPU. A lashing is
  // a few hundred tiny triangles (a 5 mm cord in turns and a knot), and 756 of them stand along
  // the descent: from the beach, with all of it in view, they cost 2 ms a frame, and past 40 m the
  // cord is a tenth of a pixel. (Culling in the vertex shader saved nothing, it still ran for every
  // vertex.) Each mesh keeps all its matrices and copies the near ones in when the camera has
  // moved 3 m.
  const lashing = [];
  const LASH_FAR = 40, LASH_STEP = 3;
  let lashAt = null;
  function cullLashings(camera, force = false) {
    if (!lashing.length) return;
    const p = camera.position;
    if (!force && lashAt && Math.hypot(p.x - lashAt.x, p.y - lashAt.y, p.z - lashAt.z) < LASH_STEP) return;
    lashAt = p.clone();
    const far2 = (LASH_FAR + LASH_STEP) * (LASH_FAR + LASH_STEP);
    for (const L of lashing) {
      const src = L.all, dst = L.mesh.instanceMatrix.array, rnd = L.mesh.geometry.getAttribute('aRand').array;
      let n = 0;
      for (let i = 0; i < L.count; i++) {
        const o = i * 16, dx = src[o + 12] - p.x, dy = src[o + 13] - p.y, dz = src[o + 14] - p.z;
        if (dx * dx + dy * dy + dz * dz > far2) continue;
        dst.set(src.subarray(o, o + 16), n * 16);
        rnd[n] = L.rand[i];
        n++;
      }
      L.mesh.count = n;
      L.mesh.instanceMatrix.needsUpdate = true;
      L.mesh.geometry.getAttribute('aRand').needsUpdate = true;
    }
  }

  function update(data) {
    lashing.length = 0;
    lashAt = null;
    for (const c of [...group.children]) { group.remove(c); c.geometry !== unitBox && c.geometry !== unitCyl && c.geometry !== unitCylFine && c.geometry !== unitCylRail && c.geometry !== unitStone && c.geometry.dispose(); }
    if (!data) return;
    for (const k of ['concrete', 'dirt']) {
      const d = data.meshes[k];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
      g.setAttribute('aTrail', new THREE.BufferAttribute(d.trail, 4));
      g.setAttribute('aWear', new THREE.BufferAttribute(d.wear, 1));
      g.setIndex(new THREE.BufferAttribute(d.index, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[k]);
      m.name = 'trail-' + k;
      group.add(m);
      withPrepass(m);
    }
    const inst = (k, geo, mat, prepass = true) => {
      const d = data.inst[k];
      if (!d.count) return;
      const g = geo.clone();
      g.setAttribute('aRand', new THREE.InstancedBufferAttribute(d.rand, 1));
      const m = new THREE.InstancedMesh(g, mat, d.count);
      m.instanceMatrix = new THREE.InstancedBufferAttribute(d.matrices, 16);
      m.computeBoundingSphere();
      m.name = 'trail-' + k;
      group.add(m);
      if (prepass) withPrepass(m);
      if (k.startsWith('lash')) lashing.push({ mesh: m, all: d.matrices.slice(), rand: d.rand.slice(), count: d.count });   // (copies: the mesh's own buffers are d.matrices and d.rand)
    };
    inst('logs', unitCyl, mats.log);
    // (No depth pass for the stones: they are small, and cover little of anything.)
    if (data.inst.stones) inst('stones', unitStone, mats.stone, false);
    inst('timberPosts', unitBox, mats.timber);
    inst('timberRails', unitBox, mats.timber);
    // (v13: no depth pass for the bamboo. The poles are bowed and tapered in the vertex shader, and
    // the pass draws them straight: where the real pole was behind that depth, nothing was drawn.)
    inst('bambooPosts', unitCylFine, mats.bambooPost, false);
    inst('bambooRails', unitCylRail, mats.bamboo, false);
    // Three variants for each rail lane, with separate post geometry for the outer rail.
    for (let v = 0; v < 6; v++) {
      if (data.inst['lashPost' + v]) inst('lashPost' + v, lashPostGeo[v], mats.rope, false);
    }
    for (let v = 0; v < 3; v++) {
      if (data.inst['lashRail' + v]) inst('lashRail' + v, lashRailGeo[v], mats.rope, false);
    }
    // Where the sections change, for the dirt's colour (metres along).
    uniforms.uSections.value.set(...data.sectionEnds);
  }
  return { group, update, cullLashings, uniforms, materials: mats, ready };
}
