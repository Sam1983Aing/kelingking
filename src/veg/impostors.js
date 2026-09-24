// Draws the plants as impostors: one card per plant, showing the baked view of the scan
// (impostor-bake.js) closest to the direction you look at it from, lit live by the sun.
// One instanced mesh per species.

import * as THREE from 'three';
import { IMPOSTOR, HEMI_OCT_GLSL } from './impostor-common.js';
import { STRIDE } from './scatter.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { SKY_PARS, AERIAL_VERT, AERIAL_FRAG_PARS } from '../sky/atmosphere-glsl.js';

const VERT = /* glsl */ `
${HEMI_OCT_GLSL}
attribute vec4 iPosScale;     // x, height, z, scale
attribute vec3 iYawSpTint;    // yaw, species (unused here), tint
uniform vec3 uCenter;         // centre of the bounding sphere, relative to the plant's origin
uniform float uRadius;
uniform float uGrid;
varying vec2 vUv;
varying vec3 vWorld;
varying float vYaw;
varying float vTint;
varying vec3 vFrameDir;       // world direction the chosen frame was baked from
${AERIAL_VERT}
#include <common>

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }

void main() {
  float s = iPosScale.w, yaw = iYawSpTint.x;
  vec3 cW = iPosScale.xyz + rotY(uCenter * s, yaw);
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
  // Nudge the card toward the viewer so a slope does not cut through the bottom of it.
  vec3 wp = cW + (xW * position.x + yW * position.y) * uRadius * s + viewW * uRadius * s * 0.45;
  vUv = (cell + position.xy * 0.5 + 0.5) / uGrid;
  vWorld = wp;
  vYaw = yaw;
  vTint = iYawSpTint.z;
  vFrameDir = rotY(d, yaw);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  aerialVertex(wp);
}
`;

const FRAG = /* glsl */ `
${SKY_PARS}
${AERIAL_FRAG_PARS}
uniform sampler2D uColor;
uniform sampler2D uData;
uniform vec3 uExtent;
varying vec2 vUv;
varying vec3 vWorld;
varying float vYaw;
varying float vTint;
varying vec3 vFrameDir;
${SUN_SHADOW_GLSL}
#include <common>

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 octDecode(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (n.y < 0.0) n.xz = (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}

void main() {
  vec4 c = texture2D(uColor, vUv);
  if (c.a < 0.35) discard;
  vec4 dt = texture2D(uData, vUv);
  vec3 N = rotY(octDecode(dt.rg), vYaw);
  // Canopy shading from the bake, eased: the scans' interiors are very dark.
  float crown = mix(0.42, 1.0, dt.a);
  // Where this pixel really is: in front of or behind the card, from the baked depth.
  vec3 P = vWorld;

  vec3 albedo = pow(c.rgb, vec3(2.2)) * 1.45;
  // Plants vary: some greener, some yellower, some darker.
  albedo *= mix(vec3(0.78, 0.95, 0.72), vec3(1.2, 1.12, 0.8), vTint);

  vec3 V = normalize(cameraPosition - P);
  float sh = bakedShadow(P, 0.5);
  float NdL = dot(N, uSunDir);
  // Leaves scatter light: wrap the diffuse term, and let sun through when looking into it.
  float diffuse = max(NdL * 0.7 + 0.3, 0.0);
  float through = pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.6;
  vec3 sun = uSunIrr * sh * (diffuse * mix(0.35, 1.0, crown) + through * crown * vec3(1.0, 1.1, 0.6));
  // Sky light from the atmosphere, from the direction this bit of canopy faces.
  vec3 sky = skyIrradiance(N) * crown;
  vec3 col = albedo / PI * (sun + sky);

  gl_FragColor = vec4(col * vApT + vApIns, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uLabel > 0.5) {
    float dist = log2(max(distance(P, cameraPosition), 1.0)) / 20.0;
    gl_FragColor = vec4(6.0 / 255.0, dist, sh * max(NdL, 0.0) > 0.3 ? 1.0 : 0.0, 1.0);
  }
}
`;

export async function createPlants(index, ids, lightUniforms = {}, base = 'assets/veg/') {
  const loader = new THREE.ImageBitmapLoader();
  // No premultiplication: the data atlas keeps shading in alpha, and the colour atlas keeps
  // colour in its empty pixels so mipmaps do not darken the leaf edges.
  loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const load = (url) => new Promise((res, rej) => loader.load(url, (bmp) => {
    const t = new THREE.Texture(bmp);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    res(t);
  }, undefined, rej));

  // The sun, sky light and haze are the atmosphere's uniforms, shared (src/sky/).
  const shared = {
    ...lightUniforms,
    uExtent: { value: new THREE.Vector3() },
    uSunShadow: { value: null },
  };
  const quad = new THREE.PlaneGeometry(2, 2);
  const species = await Promise.all(ids.map(async (id) => {
    const meta = index[id];
    const [color, data] = await Promise.all([load(`${base}${id}_color.png`), load(`${base}${id}_data.png`)]);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: color }, uData: { value: data },
        uCenter: { value: new THREE.Vector3(...meta.center) }, uRadius: { value: meta.radius }, uGrid: { value: meta.grid },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      alphaToCoverage: true,
    });
    Object.assign(material.uniforms, shared);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return { id, mesh, geo };
  }));

  const group = new THREE.Group();
  species.forEach((s) => group.add(s.mesh));

  return {
    group,
    uniforms: shared,
    // Split the scattered plants by species into each mesh's instance attributes.
    setInstances(plants) {
      const d = plants.data;
      species.forEach((s, k) => {
        const posScale = [], yawSp = [];
        for (let i = 0; i < plants.count; i++) {
          const o = i * STRIDE;
          if (d[o + 5] !== k) continue;
          posScale.push(d[o], d[o + 1], d[o + 2], d[o + 3]);
          yawSp.push(d[o + 4], d[o + 5], d[o + 6]);
        }
        s.geo.setAttribute('iPosScale', new THREE.InstancedBufferAttribute(new Float32Array(posScale), 4));
        s.geo.setAttribute('iYawSpTint', new THREE.InstancedBufferAttribute(new Float32Array(yawSp), 3));
        s.geo.instanceCount = posScale.length / 4;
      });
    },
    update(extent) {
      if (extent) shared.uExtent.value.set(extent.x0, extent.y0, extent.size);
    },
  };
}
