// The path in the page (v6): the treads, logs, posts, rails and rope the worker built
// (geometry.js), lit like the ground. Each material is three.js's standard one, patched as the
// ground's is (terrain-mesh.js): the sun from the atmosphere, cut by the baked shadow of the
// island and the clouds', the sky as a light probe, light bounced up from the ground below,
// and the haze added before the tone curve. The surfaces are worked out in the shader in world
// metres, so they need no texture coordinates.

import * as THREE from 'three';
import { SKY_PARS, AERIAL_VERT_PACKED, AERIAL_FRAG_PACKED } from '../sky/atmosphere-glsl.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';

function patch(src, find, repl) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`trail shader patch matched ${n} times: ${find.slice(0, 60)}`);
  return src.replace(find, () => repl);
}

const VERT_PARS = /* glsl */ `
varying vec3 vWorldPos;
varying vec4 vTrail;      // treads: across (-1..1, beyond on a skirt), metres along, face kind
varying vec3 vLocal;      // instances: position in the shape's own frame, in metres
varying float vRand;
attribute vec4 aTrail;
attribute float aRand;
${AERIAL_VERT_PACKED}
`;

const VERT_BEGIN = /* glsl */ `
vTrail = aTrail;
#ifdef USE_INSTANCING
  vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vLocal = position * sc;
  vRand = aRand;
#else
  vLocal = position;
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
${SUN_SHADOW_GLSL}
varying vec3 vWorldPos;
varying vec4 vTrail;
varying vec3 vLocal;
varying float vRand;
float trShadow = 1.0;
vec3 trNormal = vec3(0.0, 1.0, 0.0);
float trRough = 0.9;

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
  // Grey cast concrete, a little warm, with the grime of a few years outdoors: lighter and
  // smoother where feet wear the middle of each tread, darker towards the edges and in the
  // corner at the back of each tread, splashed with soil low on the risers.
  float kind = vTrail.z;
  float n1 = fb(g * 1.3 + P.y * 0.7, 0.8, fp), n2 = fb(g * 0.21 + 3.0, 5.0, fp);
  col = lin(vec3(0.60, 0.59, 0.56)) * (0.82 + 0.36 * n1) * (0.9 + 0.2 * n2);
  float edge = smoothstep(0.55, 1.0, abs(vTrail.x));
  float worn = (1.0 - edge) * step(kind, 0.5);
  col *= mix(1.0, 1.1, worn * 0.7);
  col *= mix(vec3(1.0), vec3(0.78, 0.76, 0.72), edge * 0.8);
  // Pits and aggregate.
  float pit = step(0.93, th(floor(g * 38.0 + P.y * 11.0))) * smoothstep(0.02, 0.006, fp);
  col *= 1.0 - 0.35 * pit;
  if (kind > 2.5) {
    // Riser: soil splashed up from the tread below, and a dark line under the nosing.
    col *= mix(vec3(1.0), vec3(0.7, 0.62, 0.52), 0.5 * n2);
  }
  if (kind > 0.5 && kind < 1.5) col *= vec3(0.74, 0.7, 0.64);   // the sides, down in the soil
  trRough = 0.88 - 0.12 * worn;
  vec2 d = vec2(fb(g * 4.0, 0.25, fp) - 0.5, fb(g * 4.0 + 7.0, 0.25, fp) - 0.5);
  trNormal = normalize(N + vec3(d.x, 0.0, d.y) * 0.25 * step(kind, 0.5));
#elif defined(TR_DIRT)
  // The dirt path: pale, dusty and stony on the ridge (trail-top-railing.jpg), browner earth
  // lower down where the path is shaded and damp (trail-mid-descent-b.jpg). Trodden smooth
  // along the middle, looser and stony towards the edges, grass encroaching on the skirts.
  float along = vTrail.y;
  float lower = smoothstep(uSections.y - 12.0, uSections.y + 25.0, along);
  vec3 pale = lin(vec3(0.62, 0.58, 0.51)), brown = lin(vec3(0.47, 0.39, 0.30));
  float n1 = fb(g * 0.9, 1.2, fp), n2 = fb(g * 3.1 + 5.0, 0.35, fp), n3 = fb(g * 0.13, 8.0, fp);
  float n4 = fb(g * 11.0 + 2.0, 0.09, fp);
  col = mix(pale, brown, lower) * (0.72 + 0.56 * n1) * (0.86 + 0.28 * n3) * (0.9 + 0.2 * n4);
  // Patches of darker, damp or organic soil, and paler dust.
  col *= mix(vec3(1.0), vec3(0.78, 0.74, 0.7), smoothstep(0.55, 0.7, n2) * 0.8);
  col *= mix(vec3(1.0), vec3(1.12, 1.1, 1.06), smoothstep(0.62, 0.75, fb(g * 0.5 + 9.0, 2.0, fp)) * 0.7);
  float a = abs(vTrail.x);
  float trod = 1.0 - smoothstep(0.3, 0.95, a);
  // Stones: limestone gravel and cobbles a couple of centimetres to a hand across, set into the
  // dirt, more of them off the trodden line. Two sizes of cell, each with a stone or not.
  float stone = 0.0, stoneAO = 1.0; vec2 stoneN = vec2(0.0); vec3 stoneCol = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float sz = k == 0 ? 7.0 : 19.0;
    vec2 sc = g * sz + float(k) * 3.7;
    vec2 ci = floor(sc);
    vec2 off = vec2(th(ci + 1.7), th(ci + 9.2)) * 0.5 + 0.25;
    vec2 dv = fract(sc) - off;
    // Irregular: stretched and turned per stone.
    float ang = th(ci + 3.3) * 6.28;
    mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
    dv = R * dv * vec2(1.0, 1.0 + 0.8 * th(ci + 5.1));
    float r = length(dv);
    float size = 0.14 + 0.2 * th(ci + 4.4);
    float here = step(k == 0 ? 0.86 - 0.2 * (1.0 - trod) : 0.7 - 0.25 * (1.0 - trod), th(ci)) * smoothstep(0.06 / sz * 10.0, 0.02 / sz * 10.0, fp);
    float s1 = (1.0 - smoothstep(size * 0.8, size, r)) * here;
    if (s1 > stone) {
      stone = s1;
      stoneN = dv / max(r, 1e-3) * smoothstep(size * 0.3, size, r);
      stoneCol = lin(mix(vec3(0.5, 0.48, 0.44), vec3(0.68, 0.66, 0.6), th(ci + 2.0))) * (0.8 + 0.3 * n2);
    }
    stoneAO *= 1.0 - 0.45 * (1.0 - smoothstep(size, size * 1.45, r)) * here * (1.0 - s1);
  }
  col = mix(col, stoneCol, stone * 0.9) * stoneAO;
  col *= mix(1.0, 1.06, trod * 0.6);
  // Skirts and the sides of the steps: the ground at the edge, darker and greener.
  if (vTrail.z > 1.5 && vTrail.z < 2.5) {
    float out_ = smoothstep(1.0, 1.4, a);
    col = mix(col, uGroundAlb * (0.8 + 0.4 * n2), out_ * 0.75);
  }
  if (vTrail.z > 2.5) col *= 0.7;   // the riser: packed earth, in its own shadow, damp
  trRough = 0.95;
  vec2 d = vec2(n2 - 0.5, fb(g * 3.1 + 11.0, 0.35, fp) - 0.5) + vec2(n4 - 0.5) * 0.6;
  trNormal = normalize(N + vec3(d.x, 0.0, d.y) * 0.5 + vec3(stoneN.x, 0.0, -stoneN.y) * stone * 1.2);
#elif defined(TR_WOOD)
  // Sawn timber left out for years: grey-brown, split along the grain, darker in the cracks.
  // The grain runs along the longest side of the piece.
  vec3 L = vLocal;
  vec3 aL = abs(L);
  float ax = step(aL.y, aL.x) * step(aL.z, aL.x);   // grain along local x (rails)
  float along = mix(L.y, L.x, ax);
  vec2 across = mix(L.xz, L.yz, ax);
  float grain = tn(vec2(along * 1.3 + vRand * 40.0, dot(across, vec2(37.0, 29.0)) + vRand * 13.0));
  float fine = tn(vec2(along * 7.0, dot(across, vec2(151.0, 131.0))));
  float crack = smoothstep(0.62, 0.7, tn(vec2(along * 0.6 + vRand * 9.0, dot(across, vec2(90.0, 70.0)))));
  col = lin(mix(vec3(0.36, 0.31, 0.26), vec3(0.46, 0.43, 0.39), vRand)) * (0.8 + 0.25 * grain + 0.15 * fine) * (1.0 - 0.45 * crack);
  // Logs across the dirt steps (defined LOG): rounder, darker, muddy underneath.
#ifdef LOG
  col = lin(vec3(0.33, 0.27, 0.21)) * (0.75 + 0.3 * grain + 0.15 * fine) * (1.0 - 0.4 * crack);
  col *= mix(0.6, 1.0, smoothstep(-0.6, 0.4, N.y));
#endif
  trRough = 0.9;
  trNormal = normalize(N + (fine - 0.5) * 0.15 * vec3(1.0, 0.0, 1.0));
#elif defined(TR_BAMBOO)
  // Bamboo poles: straw to grey-green, glossy between the nodes, a ring every 25 to 40 cm.
  float along = vLocal.y + vRand * 3.0;
  float seg = 0.25 + 0.15 * vRand;
  float node = 1.0 - smoothstep(0.004, 0.02, abs(fract(along / seg) - 0.5) * seg);   // metres to the ring
  float streak = tn(vec2(along * 3.0, atan(vLocal.x, vLocal.z) * 6.0));
  // Mostly weathered to grey-tan; the odd newer pole still straw coloured.
  vec3 fresh = lin(vec3(0.66, 0.57, 0.36)), old = lin(vec3(0.5, 0.48, 0.41));
  col = mix(fresh, old, smoothstep(0.15, 0.45, vRand)) * (0.8 + 0.3 * streak);
  col *= mix(vec3(1.0), vec3(0.7, 0.68, 0.62), smoothstep(0.55, 0.8, tn(vec2(along * 1.7, vRand * 30.0))) * 0.6);   // grime
  col *= 1.0 - 0.35 * node;
  trRough = mix(0.45, 0.8, vRand);
#elif defined(TR_ROPE)
  // Blue rope, the nylon kind, faded by the sun, wound round in strands.
  float tw = sin((vLocal.y * 60.0 + atan(vLocal.x, vLocal.z) * 2.0) * 1.0);
  col = lin(mix(vec3(0.12, 0.32, 0.72), vec3(0.3, 0.48, 0.72), vRand)) * (0.8 + 0.2 * tw);
  trRough = 0.7;
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
  trShadow = bakedShadow(vWorldPos + trNw * 0.3, 0.2) * cloudShadow(vWorldPos, uSunDirW);
`;

export function createTrail(lightUniforms = {}, gradeUniforms = {}, shared = {}) {
  const uniforms = {
    uExtent: shared.uExtent ?? { value: new THREE.Vector3(-700, -700, 1600) },
    uSunShadow: shared.uSunShadow ?? { value: null },
    uSunDirW: lightUniforms.uSunDir ?? { value: new THREE.Vector3(0, 1, 0) },
    uGroundAlb: { value: new THREE.Vector3(0.06, 0.08, 0.03) },
    uSections: { value: new THREE.Vector2(84, 178) },
    uClayT: { value: 0 },
  };

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
        ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = trRough;'],
        ['#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(trNormal, 0.0)).xyz);'],
        ['#include <lights_fragment_begin>', patch(THREE.ShaderChunk.lights_fragment_begin,
          'getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= trShadow;')],
        // Light bounced up from the ground round the path: the lower half of the view, lit by
        // the sun and the sky.
        ['#include <aomap_fragment>', `#include <aomap_fragment>
          { vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            reflectedLight.indirectDiffuse += uGroundAlb * (uSunIrr * max(uSunDirW.y, 0.0) + uSkyUp) * 0.5 * (1.0 - nW.y) * BRDF_Lambert(material.diffuseColor); }`],
        ['#include <tonemapping_fragment>', 'gl_FragColor.rgb = gl_FragColor.rgb * vAp.a + vAp.rgb;\n#include <tonemapping_fragment>'],
      ].reduce((s, [f, r]) => patch(s, f, r), shader.fragmentShader);
    };
    return m;
  }

  const mats = {
    concrete: material('concrete'), dirt: material('dirt'), timber: material('wood'), log: material('wood', { LOG: 1 }),
    bamboo: material('bamboo'), rope: material('rope'),
  };
  const group = new THREE.Group();
  group.name = 'trail';
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  const unitCylFine = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
  const unitRope = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);

  function update(data) {
    for (const c of [...group.children]) { group.remove(c); c.geometry !== unitBox && c.geometry !== unitCyl && c.geometry !== unitCylFine && c.geometry !== unitRope && c.geometry.dispose(); }
    if (!data) return;
    for (const k of ['concrete', 'dirt']) {
      const d = data.meshes[k];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
      g.setAttribute('aTrail', new THREE.BufferAttribute(d.trail, 4));
      g.setIndex(new THREE.BufferAttribute(d.index, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[k]);
      m.name = 'trail-' + k;
      group.add(m);
    }
    const inst = (k, geo, mat) => {
      const d = data.inst[k];
      if (!d.count) return;
      const g = geo.clone();
      g.setAttribute('aRand', new THREE.InstancedBufferAttribute(d.rand, 1));
      const m = new THREE.InstancedMesh(g, mat, d.count);
      m.instanceMatrix = new THREE.InstancedBufferAttribute(d.matrices, 16);
      m.computeBoundingSphere();
      m.name = 'trail-' + k;
      group.add(m);
    };
    inst('logs', unitCyl, mats.log);
    inst('timberPosts', unitBox, mats.timber);
    inst('timberRails', unitBox, mats.timber);
    inst('bambooPosts', unitCylFine, mats.bamboo);
    inst('bambooRails', unitCyl, mats.bamboo);
    inst('rope', unitRope, mats.rope);
    // Where the sections change, for the dirt's colour (metres along).
    uniforms.uSections.value.set(...data.sectionEnds);
  }
  return { group, update, uniforms, materials: mats };
}
