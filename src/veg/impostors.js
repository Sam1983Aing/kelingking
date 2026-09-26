// Draws plants as impostors: one card per plant, showing the baked view of the plant
// (impostor-bake-rt.js) closest to the direction you look at it from, lit live by the same
// light as the 3D plants (foliage-glsl.js) and swaying with the same wind. One instanced mesh
// per baked variant.
//
// Near the camera a 3D plant takes over (near.js): both stipple across the same band, the
// impostor out as the plant comes in.

import * as THREE from 'three';
import { HEMI_OCT_GLSL } from './impostor-common.js';
import { STRIDE } from './scatter.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { SKY_PARS, AERIAL_VERT_PACKED, AERIAL_FRAG_PACKED } from '../sky/atmosphere-glsl.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';
import { WIND_GLSL, FOLIAGE_LIGHT_GLSL } from './foliage-glsl.js';

const VERT = /* glsl */ `
${HEMI_OCT_GLSL}
attribute vec4 iPosScale;     // x, height, z, scale
attribute vec4 iYawTint;      // heading, colour shift (-1..1), 1 if a 3D plant takes over near the camera, unused
uniform vec3 uCenter;         // centre of the bounding sphere, relative to the plant's foot
uniform float uRadius;
uniform float uGrid;
uniform vec3 uLod;            // the hand-over to 3D plants: from near to far (m), and the lens factor
uniform float uHeight;
uniform vec4 uWindShape;      // as the 3D plant's (plant-material.js)
${WIND_GLSL}
varying vec2 vUv;
varying vec3 vCard;           // the point on the card, before it is nudged toward the camera
varying vec3 vFrameDir;       // world direction the chosen frame was baked from
varying vec3 vFoot;
varying float vYaw;
varying float vScale;
varying float vTint;
varying float vFade;
${AERIAL_VERT_PACKED}
#include <common>

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }

void main() {
  float s = iPosScale.w, yaw = iYawTint.x;
  vec3 cW = iPosScale.xyz + rotY(uCenter * s, yaw);
  // Out of view (all the plants of the island are drawn every frame): stop here, before the
  // rest of the work. The bounding sphere against the clip volume.
  {
    vec4 cc = projectionMatrix * viewMatrix * vec4(cW, 1.0);
    float r = uRadius * s * 1.5 * max(abs(projectionMatrix[0][0]), abs(projectionMatrix[1][1]));
    if (cc.w < -uRadius * s * 1.5 || any(greaterThan(abs(cc.xy) - r, vec2(cc.w)))) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  }
  vFade = 1.0;
  if (iYawTint.z > 0.5) {
    float dl = distance(cameraPosition, iPosScale.xyz + vec3(0.0, uHeight * s * 0.5, 0.0)) * uLod.z;
    vFade = smoothstep(uLod.x, uLod.y, dl);
    if (vFade <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  }
  vec3 viewW = normalize(cameraPosition - cW);
  vec3 viewL = rotY(viewW, -yaw);
  // Nearest baked view.
  vec2 cell = floor(hemiOctEncode(viewL) * (uGrid - 1.0) + 0.5);
  vec3 d = hemiOctDecode(cell / (uGrid - 1.0));
  // Same basis as the bake camera (three.js lookAt with world up, north when looking down).
  vec3 up = abs(d.y) > 0.999 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
  vec3 xL = normalize(cross(up, d));
  vec3 yL = cross(d, xL);
  vec3 xW = rotY(xL, yaw), yW = rotY(yL, yaw);
  vec3 card = cW + (xW * position.x + yW * position.y) * uRadius * s;
  // The wind leans the plant as it leans the 3D one: the card's top moves, its foot stays.
  float push = windPush(iPosScale.xz);
  float t = uWindTime;
  float seed = fract(sin(dot(iPosScale.xz, vec2(12.9898, 78.233))) * 43758.5453);   // as the 3D plant's
  float sway = sin(t * uWindShape.x + seed * 6.2832) * 0.6 + sin(t * uWindShape.x * 2.13 + seed * 17.0) * 0.25;
  float H = uHeight * s;
  float hf = clamp((card.y - iPosScale.y) / max(H, 0.05), 0.0, 1.6);
  vec2 lean = uWind.xy * push * uWindShape.y * (0.7 + 0.5 * sway) * hf * hf * H;
  card.xz += lean;
  // Nudge the card toward the viewer so a slope does not cut through the bottom of it.
  vec3 wp = card + viewW * uRadius * s * 0.45;
  vUv = (cell + position.xy * 0.5 + 0.5) / uGrid;
  vCard = card;
  vYaw = yaw;
  vScale = s;
  vTint = iYawTint.y;
  vFoot = iPosScale.xyz;
  vFrameDir = rotY(d, yaw);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  aerialVertex(wp);
}
`;

const FRAG = /* glsl */ `
#include <common>
${SKY_PARS}
${AERIAL_FRAG_PACKED}
uniform sampler2D uColor;
uniform sampler2D uData;
uniform vec3 uExtent;
uniform float uRadius;
uniform vec3 uCrownC;
uniform vec3 uCrownR;
uniform float uDensity;
uniform vec2 uLeafLook;       // how much light the leaves let through, gloss
varying vec2 vUv;
varying vec3 vCard;
varying vec3 vFrameDir;
varying vec3 vFoot;
varying float vYaw;
varying float vScale;
varying float vTint;
varying float vFade;
${SUN_SHADOW_GLSL}
${CLOUD_SHADOW_GLSL}
${FOLIAGE_LIGHT_GLSL}

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 octDecode(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (n.y < 0.0) n.xz = (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
float pHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  if (vFade < 0.999 && pHash(gl_FragCoord.xy) < 1.0 - vFade) discard;
  vec4 c = texture2D(uColor, vUv);
  // Close up a crisp edge. Further off, where a texel of the smaller mip levels averages
  // leaves and the gaps between them, the average itself is the coverage, handed to alpha to
  // coverage as it is (a threshold there ate the fine leaves of the palms: the groves went
  // dark from 1 km, the shaded ground showing through).
  vec2 sz = vec2(textureSize(uColor, 0));
  vec2 tdx = dFdx(vUv * sz), tdy = dFdy(vUv * sz);
  float mip = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
  float crisp = (c.a - 0.45) / max(fwidth(c.a), 1e-3) + 0.5;
  float alpha = mix(crisp, c.a * 1.6, smoothstep(0.5, 2.0, mip));
  if (alpha < 0.02) discard;
  vec4 dt = texture2D(uData, vUv);
  vec3 N = rotY(octDecode(dt.rg), vYaw);
  // Where this pixel really is: in front of or behind the card, from the baked depth.
  vec3 P = vCard + vFrameDir * (dt.b * 2.0 - 1.0) * uRadius * vScale;
  vec3 V = normalize(cameraPosition - P);
  N *= dot(N, V) < 0.0 ? -1.0 : 1.0;
  vec3 alb = c.rgb * c.rgb;
  alb *= mix(vec3(0.82, 0.96, 0.8), vec3(1.16, 1.08, 0.86), vTint * 0.5 + 0.5);
  // Light through the crown to this point (as plant-material.js does per vertex).
  vec3 pl = rotY(P - vFoot, -vYaw) / vScale;
  vec3 sunL = rotY(uSunDir, -vYaw);
  vec3 q = (pl - uCrownC) / uCrownR, dd = sunL / uCrownR;
  float a = dot(dd, dd), b = dot(q, dd), cc = dot(q, q) - 1.0;
  float disc = b * b - a * cc;
  float tt = disc > 0.0 ? max((-b + sqrt(disc)) / a, 0.0) : 0.0;
  float sunVis = bakedShadow(P, 0.5) * cloudShadow(P, uSunDir) * exp(-uDensity * tt * vScale);
  // A texel of the atlas covers several leaves already; more as the card shrinks.
  float spread = mix(0.55, 1.0, smoothstep(0.03, 0.2, length(fwidth(vCard))));
  vec3 col = foliageLight(alb, N, V, sunVis, mix(0.25, 1.0, dt.a), uLeafLook.x, uLeafLook.y, spread);

  gl_FragColor = vec4(col * vAp.a + vAp.rgb, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uLabel > 0.5) {
    float dist = log2(max(distance(P, cameraPosition), 1.0)) / 20.0;
    gl_FragColor = vec4(6.0 / 255.0, dist, sunVis * max(dot(N, uSunDir), 0.0) > 0.3 ? 1.0 : 0.0, 1.0);
  }
}
`;

export function createImpostors(shared) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const group = new THREE.Group();
  const kinds = new Map();

  // One baked variant: its atlases and what it is (info from the grower).
  function addKind(key, bake, info, lod) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uColor: { value: bake.color }, uData: { value: bake.data },
        uCenter: { value: new THREE.Vector3(...bake.center) }, uRadius: { value: bake.radius }, uGrid: { value: bake.grid },
        uLod: { value: new THREE.Vector3(lod?.near ?? 1e5, lod?.far ?? 1e5 + 1, 1) },
        uHeight: { value: info.height },
        uCrownC: { value: new THREE.Vector3(...info.crownC) },
        uCrownR: { value: new THREE.Vector3(...info.crownR) },
        uDensity: { value: info.density },
        uWindShape: { value: new THREE.Vector4(info.wind.freq, info.wind.stiff, info.wind.branchAmp, info.wind.branchFreq) },
        uLeafLook: { value: new THREE.Vector2(info.trans ?? 0.3, info.gloss ?? 0.6) },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      alphaToCoverage: true,
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    // Before the ground's colour pass, so its shader skips what the plants hide.
    mesh.renderOrder = -1;
    mesh.name = `impostor:${key}`;
    group.add(mesh);
    kinds.set(key, { mesh, geo, material });
  }

  return {
    group,
    uniforms: shared,
    kinds,
    addKind,
    // Split the scattered plants into each variant's instance attributes. pick(species,
    // variant) says which variant draws a plant ({ key, scale, near }), or null.
    setInstances(plants, pick) {
      const d = plants.data;
      const lists = new Map([...kinds.keys()].map((k) => [k, { a: [], b: [] }]));
      for (let i = 0; i < plants.count; i++) {
        const o = i * STRIDE;
        const p = pick(d[o + 5], d[o + 6]);
        if (!p) continue;
        const l = lists.get(p.key);
        if (!l) continue;
        l.a.push(d[o], d[o + 1], d[o + 2], d[o + 3] * p.scale);
        l.b.push(d[o + 4], d[o + 7] * 2 - 1, p.near ? 1 : 0, (i * 0.618034) % 1);
      }
      for (const [k, l] of lists) {
        const { geo } = kinds.get(k);
        geo.setAttribute('iPosScale', new THREE.InstancedBufferAttribute(new Float32Array(l.a), 4));
        geo.setAttribute('iYawTint', new THREE.InstancedBufferAttribute(new Float32Array(l.b), 4));
        geo.instanceCount = l.a.length / 4;
      }
    },
    setLodScale(v) { for (const k of kinds.values()) k.material.uniforms.uLod.value.z = v; },
  };
}
