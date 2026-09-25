// Spray and bursts of white water: points, each one worked out in the vertex shader from the
// time, so there is no state to keep and a frozen capture shows the same spray as a running
// page.
//
// On the beaches every column of the breaker ribbon owns a few particles of three kinds:
//   lip      droplets torn from the lip's edge as it throws, flung forward and falling
//   mist     spray feathering off the crest, blown back out to sea by the offshore wind
//   splash   thrown up where the lip lands in the trough
// Each is born at its own stage of that column's wave (breaker.js finds it) and flies from
// the lip's position at that stage.
//
// At the foot of the rock (sites from worker.js, every 2.5 m of coast) a burst goes up each
// time a swell crest arrives: the ocean's swell cascade gives the height and slope there, and
// from those the phase of the swell (a crest just passed = the burst is young). Bigger on
// the rock that faces the swell.

import * as THREE from 'three';
import { COMMON } from './water-shader.js';
import { BREAK_GLSL } from './breaker.js';
import { SKY_PARS } from '../sky/atmosphere-glsl.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';

const VERT = /* glsl */ `
${COMMON}
${BREAK_GLSL}
uniform sampler2D uOceanA[4];
uniform sampler2D uOceanB[4];
uniform float uPxPerM;        // pixels per metre at one metre from the camera
uniform vec2 uWindDrift;      // what the wind does to fine spray (m/s, map)
uniform float uSwellPeriod;
uniform int uSprayDebug;
attribute vec4 aSite;         // beach: waterline point, offshore direction. rock: foot, outward direction
attribute vec4 aSeed;         // random numbers
attribute vec2 aKind;         // kind (0 lip, 1 mist, 2 splash, 3 rock), and the breaker column (beach) or exposure (rock)
varying vec4 vColor;          // x brightness, y alpha, z how much it is fine mist, w age share
varying vec3 vWorld;
varying vec3 vDbg;
varying float vPx;

const float G = 9.81;

void kill() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColor = vec4(0.0); }

void main() {
  float kind = aKind.x;
  vec3 pos;
  float size, alpha, mist, ageShare;
  if (uSprayDebug == 2) {   // every particle 3 m above its site, no search
    pos = vec3(aSite.x, 3.0, -aSite.y);
    vec4 mvd = viewMatrix * vec4(pos, 1.0); gl_Position = projectionMatrix * mvd;
    gl_PointSize = 12.0; vColor = vec4(1.0, 1.0, 0.0, 0.0); vWorld = pos; return;
  }
  if (kind < 2.5) {
    BreakCol bc = readBreak(aKind.y);
    if (uSprayDebug == 1) {   // every beach particle at its column's crest, big
      pos = vec3(bc.pc.x, 2.0 + bc.on * 2.0, -bc.pc.y);
      vec4 mvd = viewMatrix * vec4(pos, 1.0); gl_Position = projectionMatrix * mvd;
      gl_PointSize = 12.0; vColor = vec4(1.0, 1.0, 0.0, bc.tau); vWorld = pos; return;
    }
    if (bc.on < 0.5 || bc.H < 0.4) { kill(); return; }
    // When this particle leaves the wave: a stage, and so an age now.
    float tauE = kind < 0.5 ? mix(0.18, 0.72, aSeed.x) : kind < 1.5 ? mix(0.02, 0.45, aSeed.x) : mix(0.72, 0.92, aSeed.x);
    float speed = bc.L / uPeriod;                  // the crest's speed (m/s)
    float age = (bc.tau - tauE) * 8.0 / speed;
    float life = kind < 0.5 ? mix(0.7, 1.5, aSeed.y) : kind < 1.5 ? mix(1.2, 2.6, aSeed.y) : mix(0.8, 1.5, aSeed.y);
    if (age < 0.0 || age > life) { kill(); return; }
    // Where the lip was then: the crest stood further out by what it has travelled since.
    vec2 pcE = bc.pc + bc.n * (bc.tau - tauE) * 8.0;
    float vE = kind < 0.5 ? 0.44 : kind < 1.5 ? 0.25 : 0.45;
    float tauP = kind < 1.5 ? tauE : 0.8;
    vec4 pr = breakerProfile(vE, tauP, bc.H, bc.Lb, bc.Lf, bc.xMax);
    vec2 pm = pcE - bc.n * pr.x;
    float y0 = mix(bc.hB, bc.hF, 0.5) + pr.y;
    vec3 fwd = vec3(-bc.n.x, 0.0, bc.n.y);
    vec3 side = vec3(bc.n.y, 0.0, bc.n.x);
    vec3 p0 = vec3(pm.x, y0, -pm.y) + side * (aSeed.z - 0.5) * 0.5;
    vec3 vel;
    float g = G;
    if (kind < 0.5) {         // flung off the lip
      // The lip is thrown forward faster than the crest travels.
      vel = fwd * speed * mix(1.0, 1.35, aSeed.w) + vec3(0.0, mix(0.6, 3.2, aSeed.z), 0.0) + side * (aSeed.x - 0.5) * 1.2;
      size = mix(0.25, 0.7, aSeed.w);        // a puff of droplets
      alpha = 0.95; mist = 0.15;
    } else if (kind < 1.5) {  // feathering off the crest: rises with it, the offshore wind holds it back
      vel = fwd * speed * mix(0.45, 0.85, aSeed.w) + vec3(0.0, mix(1.2, 3.5, aSeed.z), 0.0) + side * (aSeed.x - 0.5) * 1.5;
      g = 2.5;               // fine mist: the air holds it up
      size = mix(0.5, 1.2, aSeed.w);
      alpha = 0.14; mist = 0.8;
    } else {                  // thrown up where the lip lands
      vel = fwd * speed * mix(0.7, 1.2, aSeed.w) + vec3(0.0, mix(2.0, 5.5, aSeed.z) * clamp(bc.H / 1.5, 0.5, 1.4), 0.0) + side * (aSeed.x - 0.5) * 2.0;
      size = mix(0.4, 1.1, aSeed.w);
      alpha = 0.9; mist = 0.35;
    }
    vec2 wind = uWindDrift * mix(0.3, 1.0, mist);
    pos = p0 + vel * age + vec3(wind.x, 0.0, -wind.y) * age - vec3(0.0, 0.5 * g * age * age, 0.0);
    size *= 1.0 + age * mix(0.3, 1.6, mist);       // spray spreads as it goes
    ageShare = age / life;
    // Below the sea is gone.
    // (Against the sea as drawn: under a breaking crest the heightfield is tucked away.)
    vec2 pq = vec2(pos.x, -pos.z);
    if (pos.y < surfAt(pq, dataAt(pq)).h - 0.15) { kill(); return; }
  } else {
    // Rock: the swell's phase at this foot from its height and how fast it is rising.
    vec2 p = aSite.xy;
    float h = texture(uOceanA[0], p / uOceanL.x).y;
    vec2 sl = texture(uOceanB[0], p / uOceanL.x).xy;
    float w = 6.2831853 / uSwellPeriod;
    float c = G / w;
    float dhdt = -c * dot(sl, uSwellDir);
    float phase = atan(-dhdt / w, h);              // 0 at a crest, growing after it
    if (phase < 0.0) phase += 6.2831853;
    float amp = sqrt(h * h + (dhdt / w) * (dhdt / w));
    float since = phase / w;                        // seconds since the crest
    float delay = aSeed.x * 0.6;
    float life = mix(1.2, 2.8, aSeed.y);
    float age = since - delay;
    float strength = aKind.y * smoothstep(0.15, 0.7, amp);
    if (uSprayDebug == 4) {
      pos = vec3(p.x, 5.0, -p.y);
      vec4 mvd = viewMatrix * vec4(pos, 1.0); gl_Position = projectionMatrix * mvd;
      gl_PointSize = 10.0; vColor = vec4(1.0, 1.0, 0.0, 0.0); vWorld = pos; vDbg = vec3(abs(h) * 2.0, amp * 2.0, length(sl) * 20.0); return;
    }
    if (age < 0.0 || age > life || strength < 0.05) { kill(); return; }
    vec3 out3 = vec3(aSite.z, 0.0, -aSite.w);
    vec3 side = vec3(-out3.z, 0.0, out3.x);
    float up = mix(3.0, 12.0, aSeed.z * aSeed.z) * strength;
    vec3 vel = vec3(0.0, up, 0.0) + out3 * mix(0.5, 3.0, aSeed.w) + side * (aSeed.x - 0.5) * 3.0;
    vec3 p0 = vec3(p.x, 0.2, -p.y) + side * (aSeed.w - 0.5) * 2.0 + out3 * aSeed.z * 1.5;
    float g = mix(G, 3.0, step(0.7, aSeed.y));      // some of it is fine mist
    mist = mix(0.25, 0.9, step(0.7, aSeed.y));
    pos = p0 + vel * age - vec3(0.0, 0.5 * g * age * age, 0.0) + vec3(uWindDrift.x, 0.0, -uWindDrift.y) * age * mist;
    size = mix(0.8, 2.4, aSeed.w) * (1.0 + age * mix(0.4, 1.2, mist));
    alpha = mix(0.95, 0.35, mist) * strength;
    ageShare = age / life;
    if (pos.y < -0.2) { kill(); return; }
  }
  vWorld = pos;
  vDbg = vec3(0.0);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.1);
  float px = size * uPxPerM / dist;
  // Smaller than a pixel: keep a pixel and fade it instead, so it does not flicker.
  alpha *= clamp(px / 1.5, 0.0, 1.0);
  // Puffs far away read as fog on the sea; they fade out beyond a couple of hundred metres.
  alpha *= 1.0 - smoothstep(40.0, 150.0, dist) * mist;
  gl_PointSize = max(px, 1.5);
  if (uSprayDebug == 3) { gl_PointSize = 8.0; alpha = 1.0; vDbg = vec3(kind < 0.5 ? 1.0 : 0.0, kind > 0.5 && kind < 1.5 ? 1.0 : 0.0, kind > 1.5 ? 1.0 : 0.0); }
  // Fades in quickly, thins out as it goes.
  if (uSprayDebug != 3) alpha *= smoothstep(0.0, 0.08, ageShare) * (1.0 - smoothstep(0.55, 1.0, ageShare));
  vColor = vec4(aSeed.x * 97.0 + aSeed.y * 13.0, alpha, mist, ageShare);
  // Small on screen, the droplets would only be noise: draw it as a soft puff instead, and
  // fainter (a far puff covers less of what is behind it than its disc suggests).
  vPx = px;
}
`;

const FRAG = /* glsl */ `
#include <common>
${COMMON}
${SKY_PARS}
${SUN_SHADOW_GLSL}
uniform vec3 uSkyIrr;
varying vec4 vColor;
varying vec3 vWorld;
varying vec3 vDbg;
varying float vPx;
uniform int uSprayDebug;
void main() {
  if (uSprayDebug == 4 || uSprayDebug == 3) { gl_FragColor = vec4(vDbg, 1.0); return; }
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float mist = max(vColor.z, smoothstep(30.0, 10.0, vPx));
  // A puff: droplets scattered in it (denser in the middle, thinning as it ages), in a haze
  // of fine mist.
  float seed = vColor.x;
  vec2 g = gl_PointCoord * 7.0;
  vec2 cell = floor(g), f = fract(g);
  float drops = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 h = vec2(fract(sin(dot(c + seed, vec2(12.9898, 78.233))) * 43758.5453), fract(sin(dot(c + seed, vec2(39.3468, 11.135))) * 24634.6345));
    float rad = mix(0.15, 0.45, h.x * h.x) * (1.2 - 0.6 * r);
    float keep = step(h.y, 0.95 - 0.5 * vColor.w);
    drops = max(drops, keep * smoothstep(rad, rad * 0.4, length(vec2(float(i), float(j)) + h - f)));
  }
  float body = exp(-r * 3.0);
  float a = vColor.y * mix(drops * smoothstep(1.0, 0.2, r), body * mix(1.0, 0.45, smoothstep(30.0, 10.0, vPx)), mist);
  a = max(a, vColor.y * body * 0.45 * (1.0 - mist));
  if (a < 0.003) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float shadow = bakedShadow(vWorld, 0.05);
  // Water droplets scatter strongly forward: bright when the sun is behind them.
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 6.0);
  vec3 lit = (uSunIrr * shadow * (0.35 + 2.5 * fwd) + uSkyIrr) * 0.8 / PI;
  gl_FragColor = vec4(lit, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uLabel > 0.5) discard;
}
`;

export function createSpray(waterUniforms) {
  const uniforms = Object.assign({}, waterUniforms, {
    uPxPerM: { value: 1000 },
    uWindDrift: { value: new THREE.Vector2(-1.2, 0.7) },
    uSwellPeriod: { value: 13 },
    uSprayDebug: { value: 0 },
  });
  // The shared uniform objects stay shared (the ocean's textures and the clock change).
  for (const k of Object.keys(waterUniforms)) uniforms[k] = waterUniforms[k];
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.visible = false;

  let beach = null, rock = null;
  const rnd = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  function rebuild() {
    const rows = [];
    // Beach: per column of the breaker (every other one, 1 m apart), a few of each kind.
    if (beach) for (let c = 0; c < beach.length / 4; c += 2) {
      for (const [kind, n] of [[0, 22], [1, 12], [2, 12]]) for (let i = 0; i < n; i++) rows.push([beach[c * 4], beach[c * 4 + 1], beach[c * 4 + 2], beach[c * 4 + 3], kind, c]);
    }
    // Rock: sites every 2.5 m of coast, a dozen particles each.
    if (rock) for (let k = 0; k < rock.length; k += 5) for (let i = 0; i < 14; i++) rows.push([rock[k], rock[k + 1], rock[k + 2], rock[k + 3], 3, rock[k + 4]]);
    const n = rows.length;
    const site = new Float32Array(n * 4), seed = new Float32Array(n * 4), kind = new Float32Array(n * 2);
    rows.forEach((r, i) => {
      site.set(r.slice(0, 4), i * 4);
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      kind[i * 2] = r[4]; kind[i * 2 + 1] = r[5];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSite', new THREE.BufferAttribute(site, 4));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 2));
    points.geometry.dispose();
    points.geometry = g;
    points.visible = n > 0;
    return n;
  }
  return {
    points,
    uniforms,
    setBeach(columns) { beach = columns; return rebuild(); },
    setRock(sites) { rock = sites; return rebuild(); },
    update(camera, renderer) {
      const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
      uniforms.uPxPerM.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    },
  };
}
