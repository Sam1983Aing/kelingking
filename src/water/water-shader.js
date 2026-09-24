// GLSL for the sea. Everything is computed from the terrain data texture:
//   R = terrain height, G = metres offshore from the waterline, B = beach weight.
// Local coordinates in here are metres with x = east, y = north (world z = -north).

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;      // world space, pointing at the sun
uniform vec3 uSunIrr;      // sun colour * intensity
uniform vec3 uZenith;
uniform vec3 uHorizon;

vec3 skyRadiance(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(y, 0.5));
  float sd = max(dot(d, uSunDir), 0.0);
  return c + uSunIrr * (0.012 * pow(sd, 6.0) + 0.05 * pow(sd, 64.0));
}
`;

const COMMON = /* glsl */ `
uniform sampler2D uData;
uniform sampler2D uShoreDir;   // unit direction pointing offshore, packed 0..1
uniform vec3 uExtent;      // x0, y0, size of the terrain data in local metres
uniform float uTime;
uniform float uPeriod;     // seconds between waves
uniform float uSwell;      // wave height out at sea (m)
uniform float uBreakAt;    // distance offshore where waves break on the beach (m)
uniform float uSurge;      // how high the swash runs up (m of water level)
uniform vec2 uSwellDir;    // direction the swell travels, local

const vec4 OCEAN = vec4(-45.0, 900.0, 0.0, 0.0);

vec2 offshoreAt(vec2 p) {
  vec2 uv = clamp((p - uExtent.xy) / uExtent.z, 0.0, 1.0);
  vec2 d = texture2D(uShoreDir, uv).rg * 2.0 - 1.0;
  return d / max(length(d), 1e-3);
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

// Waves slow down and bunch up in shallow water. With a wavelength that grows linearly
// with distance offshore (L = L0 + b s) the phase is the integral of 1/L.
const float L0 = 10.0;
const float LB = 0.2;
float shorePhase(float s) { return log(1.0 + LB * max(s, 0.0) / L0) / LB; }

// The shore-driven wave train. Returns height (x), shoreward lean (y), foam (z).
vec3 surf(vec2 p, vec4 d) {
  float s = d.g;
  if (s > 280.0 || s < -30.0) return vec3(0.0);
  float sand = d.b;
  float jag = vnoise(p * 0.012) * 0.9 + vnoise(p * 0.035) * 0.4 + vnoise(p * 0.11) * 0.08;
  float phase = shorePhase(s) + uTime / uPeriod + jag;
  // Index the nearest crest, so a wave's own size never changes across its crest. The
  // size hands over to the next wave in the trough, blended, so the surface stays
  // continuous (a jump there is a vertical step that the grid draws as a row of teeth).
  float idx = floor(phase + 0.5);
  float v = phase - idx;                 // < 0 in front of the crest, > 0 behind it
  float nb = idx + (v > 0.0 ? 1.0 : -1.0);
  float bigK = mix(0.65, 1.3, hash12(vec2(idx, 3.1))) * mix(0.35, 1.25, vnoise(p * 0.04 + idx * 7.31));
  float bigN = mix(0.65, 1.3, hash12(vec2(nb, 3.1))) * mix(0.35, 1.25, vnoise(p * 0.04 + nb * 7.31));
  float hand = 0.5 * smoothstep(0.25, 0.5, abs(v));
  float big = mix(bigK, bigN, hand);

  float br = mix(3.0, uBreakAt, sand);   // on rock the wave breaks against the cliff
  // The shoreward wave train only forms in front of beaches. On rock the open swell runs
  // straight into the cliff (see swellHeight), so there are no rings around the headland.
  float beachy = smoothstep(0.25, 0.85, sand);
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
  float wf = max(mix(0.17, 0.09, smoothstep(br + 45.0, br, s)), 1.8 / Lhere);   // front at least ~2 m wide
  float w = v < 0.0 ? wf : 0.26;
  float crest = exp(-(v * v) / (w * w)) * smoothstep(0.5, 0.38, abs(v));
  float h = Ak * crest - 0.28 * A;
  h = max(h, -0.45 * depthHere);
  // Only a slight lean. A heightfield cannot curl over, and squeezing the front into a few
  // grid rows turns it into a staircase of teeth wherever the crest crosses the grid.
  float lean = Ak * 0.1 * crest * smoothstep(br + 25.0, br, s) * (1.0 - broken);

  float lip = crest * smoothstep(br + 8.0, br - 1.0, s) * smoothstep(0.12, -0.01, v);
  // The bore: a solid white front a metre or two deep, then foam that thins into lace.
  float front = broken * smoothstep(-0.03, 0.0, v) * (1.0 - smoothstep(0.05, 0.16, v));
  float trail = broken * 0.8 * exp(-max(v, 0.0) / 0.34) * step(0.0, v);
  float resid = smoothstep(br + 14.0, 0.0, s) * 0.2;
  float foam = max(max(lip, front * 1.1), max(trail, resid)) * mix(0.85, 1.1, big);

  // Swash: when a bore reaches the sand the water level surges up the beach.
  float us = fract(uTime / uPeriod + jag);
  float surge = uSurge * sand * (smoothstep(0.82, 1.0, us) + (1.0 - smoothstep(0.0, 0.55, us)) * step(us, 0.55));
  surge *= 0.75 + 0.5 * vnoise(p * 0.09);
  h += surge * (1.0 - smoothstep(br * 0.4, br, s));

  foam *= offshoreFade;

  // Rock coasts: the swell smashes into the base of the cliff and leaves a band of
  // white water that pulses with each set.
  float pulse = exp(-pow(fract(uTime / uPeriod + vnoise(p * 0.02) * 1.3) - 0.15, 2.0) / 0.06);
  float exposed = smoothstep(-0.3, 0.8, dot(offshoreAt(p), -uSwellDir));
  float width = 4.0 + 24.0 * exposed + 10.0 * vnoise(p * 0.04);
  float band = smoothstep(width, 0.0, max(s, 0.0));
  float patchy = smoothstep(0.2, 0.7, fbm3(p * 0.09 + vec2(uTime * 0.1, 0.0)));
  float rock = (1.0 - beachy) * (0.55 + 0.45 * pulse) * (0.45 + 0.75 * exposed)
             * mix(band * band, band, patchy);
  rock = max(rock, (1.0 - beachy) * smoothstep(2.5, 0.0, max(s, 0.0)) * 0.9);
  foam = max(foam, rock);

  return vec3(h * offshoreFade, lean * offshoreFade, foam);
}

// A few long swells out at sea, heights only (their slope feeds the normals).
float swellHeight(vec2 p, vec4 d) {
  float s = d.g;
  float t = uTime;
  float h = 0.0;
  vec2 d1 = uSwellDir;
  vec2 d2 = normalize(uSwellDir + vec2(0.35, -0.2));
  vec2 d3 = normalize(uSwellDir + vec2(-0.3, 0.25));
  h += 0.5 * sin(0.0628 * (dot(d1, p) - 12.4 * t));
  h += 0.3 * sin(0.105 * (dot(d2, p) - 9.6 * t) + 1.3);
  h += 0.18 * sin(0.18 * (dot(d3, p) - 7.4 * t) + 4.1);
  float nearBeach = smoothstep(0.25, 0.85, d.b);
  float fade = mix(smoothstep(-2.0, 25.0, s), smoothstep(uBreakAt + 40.0, uBreakAt + 160.0, s), nearBeach);
  return h * uSwell * 0.6 * fade;
}

float waterHeight(vec2 p) {
  vec4 d = dataAt(p);
  return surf(p, d).x + swellHeight(p, d);
}
`;

export const WATER_VERT = /* glsl */ `
${COMMON}
uniform float uGridScale;   // spreads the rings out when the camera is high
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec2 vGrid;   // ground position before the crest is leaned over

void main() {
  vec3 w = position;
  w.xz = w.xz * uGridScale + cameraPosition.xz;
  vec2 p = vec2(w.x, -w.z);
  vGrid = p;
  vec4 d = dataAt(p);
  vec3 sf = surf(p, d);
  w.y = sf.x + swellHeight(p, d);
  // Lean the crest shoreward.
  vec2 toShore = -offshoreAt(p);
  w.xz += vec2(toShore.x, -toShore.y) * sf.y;
  vWorld = w;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

export const WATER_FRAG = /* glsl */ `
${COMMON}
${SKY_GLSL}
uniform vec3 uSkyIrr;        // irradiance from the sky dome
uniform vec3 uAbsorb;        // extinction per metre, per channel
uniform vec3 uScatter;       // colour of light scattered back out of the water
uniform vec3 uSandAlbedo;
uniform vec3 uReefAlbedo;
uniform float uTurbidity;    // stirred-up sand near the surf
uniform float uChop;         // strength of the small wind waves
uniform float uFoam;
uniform float uWindAngle;
uniform int uDebug;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
varying vec3 vWorld;
varying vec2 vGrid;

// Small wind waves as an analytic slope field. Waves shorter than a few pixels are faded
// out and their slope goes into the glint roughness instead.
vec3 chop(vec2 p, float fp) {
  vec2 g = vec2(0.0);
  float lost = 0.0;
  float L = 11.0, a = 0.05;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float ang = uWindAngle + (hash12(vec2(fi, 7.7)) - 0.5) * 2.4;
    vec2 dir = vec2(cos(ang), sin(ang));
    float k = 6.2831853 / L;
    float f = k * dot(dir, p) - sqrt(9.81 * k) * uTime + fi * 1.7;
    float keep = smoothstep(2.5 * fp, 6.0 * fp, L);
    g += dir * (a * k * cos(f)) * keep;
    lost += (a * k) * (a * k) * (1.0 - keep);
    L *= 0.77; a *= 0.79;
  }
  return vec3(g * uChop, sqrt(lost) * uChop);
}

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

// Terrain shadow: march toward the sun through the heightfield.
float terrainShadow(vec3 w, float offshore) {
  if (offshore > 260.0) return 1.0;
  float sh = 1.0;
  float t = 1.5;
  for (int i = 0; i < 18; i++) {
    vec3 q = w + uSunDir * t;
    if (q.y > 230.0) break;
    float h = dataAt(vec2(q.x, -q.z)).r;
    sh = min(sh, clamp((q.y - h) / (0.04 * t) + 0.5, 0.0, 1.0));
    t = t * 1.22 + 1.2;
  }
  return sh;
}

void main() {
  #include <logdepthbuf_fragment>
  // Evaluate the waves where this point started, not where the lean pushed it, so shading
  // agrees with the geometry across the crest.
  vec2 p = vGrid;
  vec4 d = dataAt(p);
  float fp = max(length(fwidth(vWorld.xz)), 0.01);   // metres per pixel
  vec3 sf = surf(p, d);

  // Normal: the big waves by finite differences, plus the wind chop.
  float e = clamp(fp * 1.5, 0.12, 6.0);
  float h0 = sf.x + swellHeight(p, d);
  float hx = 2.0 * (waterHeight(p + vec2(e, 0.0)) - h0);
  float hy = 2.0 * (waterHeight(p + vec2(0.0, e)) - h0);
  vec3 ch = chop(p + vec2(1.1, 0.8) * vWorld.y, fp);
  float calm = mix(1.0, 0.35, smoothstep(12.0, 0.0, d.g) * d.b);   // flatter in the swash
  vec2 slope = vec2(hx, hy) / (2.0 * e) + ch.xy * calm;
  vec3 N = normalize(vec3(-slope.x, 1.0, slope.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = uSunDir;

  float shadow = terrainShadow(vWorld + vec3(0.0, 0.3, 0.0), d.g);

  // Light under the surface. Follow the refracted view ray down to the seabed. A ray that
  // runs nearly flat (looking through the face of a standing wave) leaves through the back
  // of the wave after a few metres instead, and picks up the light coming through it.
  vec3 R = refract(-V, N, 1.0 / 1.333);
  float down = max(-R.y, 0.0);
  float depth0 = max(vWorld.y - d.r, 0.0);
  float tBed = depth0 / max(down, 0.02);
  float thick = 0.9 + 5.5 * exp(-max(vWorld.y + 0.3, 0.0) * 1.1);
  float tExit = mix(1e4, thick, smoothstep(0.45, 0.08, down));
  float tRay = min(min(tBed, tExit), 40.0);
  float through = smoothstep(0.0, 0.3, (tBed - tExit) / max(tExit, 0.1));
  vec2 bedP = p + vec2(R.x, -R.z) * tRay;
  vec4 bd = dataAt(bedP);
  float depth = mix(max(vWorld.y - bd.r, 0.0), depth0, through);
  float pathV = tRay;
  float nearSurf = max(bd.b * smoothstep(70.0, 4.0, bd.g), bd.a * 1.4);
  float cloud = fbm3(bedP * 0.03 + vec2(uTime * 0.02, -uTime * 0.015));
  float turb = uTurbidity * nearSurf * smoothstep(0.2, 0.75, cloud) * mix(0.08, 1.0, smoothstep(0.45, 0.85, N.y));
  // Suspended sand blocks all colours equally...
  vec3 sigma = uAbsorb + turb * vec3(0.3) + nearSurf * vec3(0.0, 0.02, 0.07);

  vec3 Lr = refract(-L, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  float sunY = max(L.y, 0.0);
  vec3 Tdown = exp(-sigma * depth / max(0.3, -Lr.y));
  vec3 Tview = exp(-sigma * pathV);

  float reef = max((1.0 - bd.b) * smoothstep(40.0, 2.0, bd.g) * 0.85,
                   smoothstep(0.52, 0.7, fbm3(bedP * 0.018 + 4.0)) * smoothstep(3.0, 9.0, depth));
  vec3 bedAlbedo = mix(uSandAlbedo, uReefAlbedo, reef);
  float causFade = exp(-depth / 4.0) * (1.0 - reef * 0.6) * smoothstep(0.5, 0.08, fp) * (1.0 - clamp(turb * 3.0, 0.0, 1.0));
  float caus = causFade > 0.01 ? mix(1.0, 0.85 + 0.4 * caustics(bedP, uTime * 1.3), causFade) : 1.0;
  vec3 Ebed = uSunIrr * sunY * shadow * caus * Tdown + uSkyIrr * exp(-sigma * depth * 1.3);
  vec3 bedRad = bedAlbedo / PI * Ebed;
  vec3 Rout = normalize(vec3(R.x, max(R.y, 0.08), R.z));
  vec3 behind = skyRadiance(Rout) * 0.5 + uSunIrr * shadow * pow(max(dot(Rout, L), 0.0), 3.0) * 0.1;
  bedRad = mix(bedRad, behind, through);

  vec3 E = uSunIrr * sunY * mix(0.35, 1.0, shadow) + uSkyIrr;
  // ...but the light it scatters back has already lost its red on the way down, so a sand
  // cloud glows milky turquoise rather than brown.
  vec3 turbCol = uSandAlbedo * exp(-uAbsorb * (3.5 + depth * 0.6));
  vec3 scatterCol = uScatter + turbCol * turb * 1.5;
  vec3 under = bedRad * Tview + scatterCol / PI * E * (1.0 - Tview);

  // Surface reflection and the sun glint.
  float NoV = max(dot(N, V), 1e-3);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 Rd = reflect(-V, N);
  // Far away the waves are smaller than a pixel but their slopes still tilt the mirror
  // toward the viewer, so the sea reflects sky from higher up than a flat mirror would.
  Rd.y = abs(Rd.y) + ch.z * 1.4;
  Rd = normalize(Rd);
  vec3 refl = skyRadiance(Rd);
  F *= 1.0 - 0.6 * smoothstep(0.02, 0.2, ch.z) * pow(1.0 - NoV, 3.0);

  float rough = clamp(0.05 + ch.z * 0.9 + fp * 0.004, 0.05, 0.45);
  float a2 = rough * rough * rough * rough;
  vec3 Hh = normalize(V + L);
  float NoH = max(dot(N, Hh), 0.0);
  float NoL = max(dot(N, L), 0.0);
  float D = a2 / (PI * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
  float k = rough * rough * 0.5;
  float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 spec = uSunIrr * shadow * D * Fs * G / (4.0 * NoV + 1e-4);

  vec3 col = under * (1.0 - F) + refl * F + spec;

  // Sunlight through the thin top of a steep wave.
  float crestGlow = smoothstep(0.3, 1.4, sf.x) * pow(1.0 - NoV, 1.5);
  col += uScatter * uSunIrr * sunY * shadow * crestGlow * 0.08;

  // Foam: a lacy pattern thresholded by how much foam this spot should have.
  float amount = clamp(sf.z * uFoam, 0.0, 1.0);
  // Foam lace: domain-warped noise for the swirls, ridged noise for the filaments.
  float pattern = 0.0, ridge = 0.0;
  if (amount > 0.002 || d.b > 0.01) {
    // On a steep face the ground position barely changes going up, so fold the height in.
    vec2 pf = p + vec2(1.7, -1.3) * vWorld.y;
    vec2 q = pf * 0.32;
    vec2 warp = vec2(fbm3(q + vec2(0.0, uTime * 0.05)), fbm3(q + vec2(5.2, 1.3) - uTime * 0.04));
    float swirl = fbm3(q * 1.7 + warp * 2.6 + uTime * 0.03);
    ridge = 1.0 - abs(2.0 * fbm3(pf * 0.85 + warp * 1.8) - 1.0);
    pattern = mix(swirl, ridge * ridge, 0.5);
  }
  float lace = smoothstep(1.0 - amount - 0.18, 1.0 - amount + 0.18, pattern);
  float foam = mix(lace, amount * 0.85, smoothstep(0.35, 1.8, fp)) * smoothstep(0.0, 0.06, amount);
  foam = max(foam, smoothstep(0.9, 1.05, amount));
  // The swash leaves a thin, bright line where its edge runs up the sand.
  float film0 = vWorld.y - d.r;
  float edge = smoothstep(0.0, 0.012, film0) * (1.0 - smoothstep(0.02, 0.08, film0)) * d.b;
  foam = max(foam, edge * 0.85 * (0.6 + 0.4 * ridge));
  vec3 foamRad = vec3(0.9) / PI * (uSunIrr * max(dot(N, L), 0.2) * shadow + uSkyIrr);
  col = mix(col, foamRad, foam);

  // Fade out over the last few centimetres so the wet sand shows through the swash.
  float film = vWorld.y - d.r;
  float alpha = max(smoothstep(0.0, 0.12, film), foam * smoothstep(0.0, 0.03, film));

  gl_FragColor = vec4(col, alpha);
  if (uDebug == 1) gl_FragColor = vec4(vec3(turb), 1.0);
  if (uDebug == 2) gl_FragColor = vec4(vec3(through), 1.0);
  if (uDebug == 3) gl_FragColor = vec4(vec3(amount), 1.0);
  if (uDebug == 4) gl_FragColor = vec4(under, 1.0);
  if (uDebug == 5) gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
