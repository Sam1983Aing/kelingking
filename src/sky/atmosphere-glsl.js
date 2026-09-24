// GLSL for the atmosphere, after Sebastien Hillaire, "A Scalable and Production Ready Sky and
// Atmosphere Rendering Technique" (EGSR 2020), with the transmittance parameterisation from
// Eric Bruneton's "Precomputed Atmospheric Scattering" (2008, 2017 version).
//
// The air is Rayleigh scattering (molecules, blue), Mie scattering (aerosols: sea salt and
// haze, grey, strongly forward) and ozone absorption. Four lookup tables:
//   transmittance   how much sunlight survives from the top of the atmosphere to a point
//   multiple        light scattered more than once, folded into one term (Hillaire's trick)
//   sky view        sky radiance around the camera, packed tight near the horizon
//   aerial          light scattered into the view ray between the camera and a point, in
//                   froxels (screen x, y and distance), which is the haze on the land and sea
// All tables are for a sun of unit illuminance at the top of the atmosphere, so the sun's
// strength and colour are one multiplication at the end. Distances in here are kilometres.

export const ATMO_PARS = /* glsl */ `
uniform float uRg;          // planet radius
uniform float uRt;          // top of the atmosphere
uniform vec3 uRayScat;      // Rayleigh scattering at sea level, per km
uniform float uRayH;        // Rayleigh scale height
uniform float uMieScat;     // Mie scattering at sea level, per km: background aerosol
uniform float uMieH;
uniform float uSeaScat;     // and the sea haze, a dense layer of salt and moisture near the water
uniform float uSeaH;
uniform float uMieAbs;      // aerosol absorption as a fraction of its scattering
uniform vec3 uMieSpectral;  // aerosol scattering per channel relative to 550 nm (Angstrom law)
uniform float uMieG;        // Mie asymmetry: how forward the haze scatters
uniform float uMieBack;     // share of a backward lobe (real sea salt scatters more to the side than one lobe gives)
uniform vec3 uOzone;        // ozone absorption at its peak, per km
uniform vec3 uGroundAlbedo;

const float A_PI = 3.14159265358979;

void atmoMedium(float h, out vec3 scatR, out vec3 scatM, out vec3 ext) {
  h = max(h, 0.0);
  float dR = exp(-h / uRayH);
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  scatR = uRayScat * dR;
  scatM = (uMieScat * exp(-h / uMieH) + uSeaScat * exp(-h / uSeaH)) * uMieSpectral;
  ext = scatR + scatM * (1.0 + uMieAbs) + uOzone * dO;
}

float rayleighPhase(float c) { return 3.0 / (16.0 * A_PI) * (1.0 + c * c); }
// Cornette-Shanks (a Henyey-Greenstein with the right shape at the back), plus a weak
// backward Henyey-Greenstein lobe: measured aerosol phase functions have more side and back
// scattering than a single lobe with the same asymmetry.
float miePhase(float c, float g) {
  float g2 = g * g;
  float cs = 3.0 / (8.0 * A_PI) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
  const float gb = -0.3;
  float hb = (1.0 - gb * gb) / (4.0 * A_PI * pow(1.0 + gb * gb - 2.0 * gb * c, 1.5));
  return mix(cs, hb, uMieBack);
}

// Nearest positive hit of a ray with a sphere centred on the planet, or -1.
float raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t0 = -b - s;
  if (t0 > 0.0) return t0;
  float t1 = -b + s;
  return t1 > 0.0 ? t1 : -1.0;
}

// Keeps lookups on texel centres, so the ends of each axis are sampled exactly.
vec2 lutUv(vec2 u, vec2 size) { return (u * (size - 1.0) + 0.5) / size; }
vec2 unitUv(vec2 uv, vec2 size) { return (uv * size - 0.5) / (size - 1.0); }

const vec2 TRANS_SIZE = vec2(256.0, 64.0);
const vec2 MS_SIZE = vec2(32.0, 32.0);

// Radius and cosine of the zenith angle to transmittance coordinates (Bruneton).
vec2 transUv(float r, float mu) {
  float H = sqrt(uRt * uRt - uRg * uRg);
  float rho = sqrt(max(r * r - uRg * uRg, 0.0));
  float disc = r * r * (mu * mu - 1.0) + uRt * uRt;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = uRt - r, dMax = rho + H;
  return vec2((d - dMin) / max(dMax - dMin, 1e-6), rho / H);
}
`;

// Sampling the finished tables. Needs ATMO_PARS.
export const TRANS_LOOKUP = /* glsl */ `
uniform sampler2D uTransLUT;
vec3 transToTop(float r, float mu) {
  return texture2D(uTransLUT, lutUv(clamp(transUv(r, mu), 0.0, 1.0), TRANS_SIZE)).rgb;
}
// Sunlight arriving at a point: transmittance, and zero once the planet is in the way.
vec3 sunAt(vec3 p, vec3 sun) {
  float r = length(p);
  float mu = dot(p / r, sun);
  // Soften the terminator over a fraction of a degree instead of a hard step.
  float horizon = -sqrt(max(1.0 - (uRg / r) * (uRg / r), 0.0));
  return transToTop(r, mu) * smoothstep(horizon - 0.004, horizon + 0.004, mu);
}
`;

export const MS_LOOKUP = /* glsl */ `
uniform sampler2D uMsLUT;
vec3 multiScat(float r, float muS) {
  vec2 u = clamp(vec2(muS * 0.5 + 0.5, (r - uRg) / (uRt - uRg)), 0.0, 1.0);
  return texture2D(uMsLUT, lutUv(u, MS_SIZE)).rgb;
}
// One step of the scattering integral: light scattered toward the viewer at p.
vec3 inscatterAt(vec3 p, vec3 sun, float cosTheta, vec3 scatR, vec3 scatM) {
  float r = length(p);
  float muS = dot(p / r, sun);
  vec3 single = sunAt(p, sun) * (scatR * rayleighPhase(cosTheta) + scatM * miePhase(cosTheta, uMieG));
  return single + multiScat(r, muS) * (scatR + scatM);
}
`;

// Full-screen pass: vUv runs over the target's texel centres.
export const LUT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const TRANSMITTANCE_FRAG = /* glsl */ `
${ATMO_PARS}
varying vec2 vUv;
void main() {
  vec2 u = unitUv(vUv, TRANS_SIZE);
  float H = sqrt(uRt * uRt - uRg * uRg);
  float rho = H * u.y;
  float r = sqrt(rho * rho + uRg * uRg);
  float dMin = uRt - r, dMax = rho + H;
  float d = dMin + u.x * (dMax - dMin);
  float mu = d <= 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 ro = vec3(0.0, r, 0.0), rd = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  float tMax = raySphere(ro, rd, uRt);
  // Steps packed toward the start, where the air is dense.
  vec3 tau = vec3(0.0);
  float tPrev = 0.0;
  const int N = 160;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 1.0) / float(N);
    float t = tMax * f * f;
    float tm = 0.5 * (t + tPrev);
    vec3 sR, sM, e;
    atmoMedium(length(ro + rd * tm) - uRg, sR, sM, e);
    tau += e * (t - tPrev);
    tPrev = t;
  }
  gl_FragColor = vec4(exp(-tau), 1.0);
}
`;

// Hillaire section 5.5: the second-order light from every direction around a point, with an
// isotropic phase, and the fraction f that is scattered again. Summing the geometric series
// 1 + f + f^2 + ... gives all orders at once.
export const MULTISCAT_FRAG = /* glsl */ `
${ATMO_PARS}
${TRANS_LOOKUP}
varying vec2 vUv;
void main() {
  vec2 u = unitUv(vUv, MS_SIZE);
  float cosSun = u.x * 2.0 - 1.0;
  float r = uRg + clamp(u.y, 0.0, 1.0) * (uRt - uRg) + 0.001;
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 sun = vec3(sqrt(max(1.0 - cosSun * cosSun, 0.0)), cosSun, 0.0);
  vec3 L2 = vec3(0.0), Fms = vec3(0.0);
  const int SQ = 8;
  const int N = 24;
  for (int i = 0; i < SQ; i++) {
    for (int j = 0; j < SQ; j++) {
      float a = (float(i) + 0.5) / float(SQ), b = (float(j) + 0.5) / float(SQ);
      float th = 2.0 * A_PI * a, ph = acos(1.0 - 2.0 * b);
      vec3 rd = vec3(cos(th) * sin(ph), cos(ph), sin(th) * sin(ph));
      float tG = raySphere(ro, rd, uRg);
      float tMax = tG > 0.0 ? tG : raySphere(ro, rd, uRt);
      vec3 T = vec3(1.0), L = vec3(0.0), F = vec3(0.0);
      float tPrev = 0.0;
      for (int k = 0; k < N; k++) {
        float f = (float(k) + 1.0) / float(N);
        float t = tMax * f * f;
        float dt = t - tPrev;
        vec3 p = ro + rd * (0.5 * (t + tPrev));
        tPrev = t;
        vec3 sR, sM, e;
        atmoMedium(length(p) - uRg, sR, sM, e);
        vec3 scat = sR + sM;
        vec3 S = sunAt(p, sun) * scat / (4.0 * A_PI);
        vec3 sT = exp(-e * dt);
        vec3 inv = 1.0 / max(e, vec3(1e-7));
        L += T * (S - S * sT) * inv;
        F += T * (scat - scat * sT) * inv;
        T *= sT;
      }
      if (tG > 0.0) {
        vec3 pg = ro + rd * tG;
        float muG = dot(normalize(pg), sun);
        L += T * transToTop(length(pg), muG) * max(muG, 0.0) * uGroundAlbedo / A_PI;
      }
      L2 += L;
      Fms += F;
    }
  }
  float n = float(SQ * SQ);
  L2 /= n;
  Fms /= n;
  gl_FragColor = vec4(L2 / (1.0 - Fms), 1.0);
}
`;

// Sky-view mapping (Hillaire 5.3): x is the angle away from the sun around the horizon
// (the sky is symmetric about the sun's vertical plane), y the view zenith angle with rows
// packed close around the horizon, where the colour changes fastest.
export const SKYVIEW_MAP = /* glsl */ `
const vec2 SKYVIEW_SIZE = vec2(192.0, 128.0);
vec2 skyViewUv(float r, float viewZenithCos, float lightViewCos) {
  float vHorizon = sqrt(max(r * r - uRg * uRg, 0.0));
  float beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  float zenithHorizon = A_PI - beta;
  float vz = acos(clamp(viewZenithCos, -1.0, 1.0));
  vec2 uv;
  if (vz < zenithHorizon) {
    float c = clamp(vz / zenithHorizon, 0.0, 1.0);
    uv.y = (1.0 - sqrt(1.0 - c)) * 0.5;
  } else {
    float c = clamp((vz - zenithHorizon) / beta, 0.0, 1.0);
    uv.y = sqrt(c) * 0.5 + 0.5;
  }
  uv.x = sqrt(clamp(-lightViewCos * 0.5 + 0.5, 0.0, 1.0));
  return uv;
}
`;

export const SKYVIEW_FRAG = /* glsl */ `
${ATMO_PARS}
${TRANS_LOOKUP}
${MS_LOOKUP}
${SKYVIEW_MAP}
uniform float uCamR;
uniform float uSunCos;     // cosine of the sun's zenith angle at the camera
varying vec2 vUv;
void main() {
  vec2 u = unitUv(vUv, SKYVIEW_SIZE);
  float r = uCamR;
  float vHorizon = sqrt(max(r * r - uRg * uRg, 0.0));
  float beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  float zenithHorizon = A_PI - beta;
  float vz;
  if (u.y < 0.5) {
    float c = 1.0 - 2.0 * u.y;
    vz = zenithHorizon * (1.0 - c * c);
  } else {
    float c = 2.0 * u.y - 1.0;
    vz = zenithHorizon + beta * c * c;
  }
  float cx = u.x * u.x;
  float lightViewCos = 1.0 - 2.0 * cx;
  float phi = acos(clamp(lightViewCos, -1.0, 1.0));
  vec3 rd = vec3(sin(vz) * cos(phi), cos(vz), sin(vz) * sin(phi));
  vec3 sun = vec3(sqrt(max(1.0 - uSunCos * uSunCos, 0.0)), uSunCos, 0.0);
  vec3 ro = vec3(0.0, r, 0.0);
  float tG = raySphere(ro, rd, uRg);
  float tMax = tG > 0.0 ? tG : raySphere(ro, rd, uRt);
  float cosTheta = dot(rd, sun);
  vec3 T = vec3(1.0), L = vec3(0.0);
  float tPrev = 0.0;
  const int N = 40;
  for (int k = 0; k < N; k++) {
    float f = (float(k) + 1.0) / float(N);
    float t = tMax * f * f;
    float dt = t - tPrev;
    vec3 p = ro + rd * (0.5 * (t + tPrev));
    tPrev = t;
    vec3 sR, sM, e;
    atmoMedium(length(p) - uRg, sR, sM, e);
    vec3 S = inscatterAt(p, sun, cosTheta, sR, sM);
    vec3 sT = exp(-e * dt);
    L += T * (S - S * sT) / max(e, vec3(1e-7));
    T *= sT;
  }
  gl_FragColor = vec4(L, 1.0);
}
`;

// Aerial perspective: 32 x 32 screen tiles x AP_SLICES distances, stored as slices side by
// side in a 2D atlas (AP_COLS across). Slice k sits at distance uApMaxKm * ((k + 0.5) / N)^2,
// so the near slices are tens of metres apart and the far ones kilometres.
export const AP_LAYOUT = /* glsl */ `
const float AP_RES = 32.0;
const float AP_SLICES = 32.0;
const float AP_COLS = 8.0;
const vec2 AP_ATLAS = vec2(AP_RES * AP_COLS, AP_RES * AP_SLICES / AP_COLS);
`;

export const AERIAL_FRAG = /* glsl */ `
${ATMO_PARS}
${TRANS_LOOKUP}
${MS_LOOKUP}
${AP_LAYOUT}
uniform vec3 uSunDirW;
uniform float uCamR;
uniform vec3 uCamFwd;      // camera basis in world space, right and up scaled by tan(half fov)
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uApMaxKm;
varying vec2 vUv;
void main() {
  vec2 px = vUv * AP_ATLAS;
  vec2 tile = floor(px / AP_RES);
  vec2 uv = (px - tile * AP_RES) / AP_RES;          // 0..1 across the screen
  float slice = tile.y * AP_COLS + tile.x;
  float s = (slice + 0.5) / AP_SLICES;
  float dist = uApMaxKm * s * s;
  vec3 rd = normalize(uCamFwd + (uv.x * 2.0 - 1.0) * uCamRight + (uv.y * 2.0 - 1.0) * uCamUp);
  vec3 ro = vec3(0.0, uCamR, 0.0);
  // Do not march through the planet.
  float tG = raySphere(ro, rd, uRg);
  if (tG > 0.0) dist = min(dist, tG);
  float cosTheta = dot(rd, uSunDirW);
  vec3 T = vec3(1.0), L = vec3(0.0);
  int n = int(clamp(slice + 2.0, 3.0, 20.0));
  float dt = dist / float(n);
  for (int k = 0; k < 20; k++) {
    if (k >= n) break;
    vec3 p = ro + rd * ((float(k) + 0.5) * dt);
    vec3 sR, sM, e;
    atmoMedium(length(p) - uRg, sR, sM, e);
    vec3 S = inscatterAt(p, uSunDirW, cosTheta, sR, sM);
    vec3 sT = exp(-e * dt);
    L += T * (S - S * sT) / max(e, vec3(1e-7));
    T *= sT;
  }
  gl_FragColor = vec4(L, dot(T, vec3(1.0 / 3.0)));
}
`;

// ---------------------------------------------------------------- used by the scene

export const AERIAL_FN = /* glsl */ `
vec3 aerialSlice(float k, vec2 uv) {
  vec2 tile = vec2(mod(k, AP_COLS), floor(k / AP_COLS));
  vec2 px = tile * AP_RES + clamp(uv * AP_RES, 0.5, AP_RES - 0.5);
  return texture(uAerialLUT, px / AP_ATLAS).rgb;
}
void aerial(vec3 wp, vec2 uv, out vec3 T, out vec3 ins) {
  float dKm = distance(wp, uCamPos) * 0.001;
  float h0 = uCamPos.y * 0.001, h1 = wp.y * 0.001;
  float mie = uMieScat * meanDensity(h0, h1, uMieH) + uSeaScat * meanDensity(h0, h1, uSeaH);
  T = exp(-dKm * (uRayScat * meanDensity(h0, h1, uRayH) + mie * (1.0 + uMieAbs) * uMieSpectral));
  float s = sqrt(clamp(dKm / uApMaxKm, 0.0, 1.0)) * AP_SLICES - 0.5;
  if (s < 0.0) {
    float w = (s + 0.5) / 0.5;
    ins = aerialSlice(0.0, uv) * w * w;
  } else {
    float k = floor(s);
    ins = mix(aerialSlice(k, uv), aerialSlice(min(k + 1.0, AP_SLICES - 1.0), uv), s - k);
  }
  ins *= uSunE;
}
`;

// Everything a material needs to see the sky and the haze. World units are metres with
// y up; the camera's height above the sea sets where it sits in the atmosphere.
export const SKY_PARS = /* glsl */ `
${ATMO_PARS}
${SKYVIEW_MAP}
${AP_LAYOUT}
uniform sampler2D uSkyViewLUT;
uniform sampler2D uAerialLUT;
uniform vec3 uSunDir;       // world, toward the sun
uniform vec3 uSunE;         // sun illuminance at the top of the atmosphere, per channel (klux)
uniform vec3 uSunIrr;       // sun illuminance at the ground
uniform vec3 uSunRadiance;  // radiance of the sun's disc as seen from the camera
uniform float uSunCosAngle; // cosine of the sun's angular radius
uniform float uCamR;
uniform vec3 uCamPos;       // world position of the camera (m)
uniform float uApMaxKm;
uniform vec2 uResolution;   // drawing buffer size in pixels
uniform vec3 uSkySH[9];     // sky and ground irradiance as spherical harmonics (three.js basis)
uniform vec3 uSkyUp;        // sky light alone on flat ground
uniform float uLabel;       // > 0: draw flat class labels instead of colour (src/measure.js)

// Sky radiance in a direction, sun disc excluded.
vec3 skyRadiance(vec3 d) {
  d = normalize(d);
  vec2 h = d.xz, s = uSunDir.xz;
  float lh = length(h), ls = length(s);
  float lightViewCos = (lh > 1e-4 && ls > 1e-4) ? dot(h, s) / (lh * ls) : 1.0;
  vec2 uv = skyViewUv(uCamR, d.y, lightViewCos);
  return texture2D(uSkyViewLUT, lutUv(uv, SKYVIEW_SIZE)).rgb * uSunE;
}

// Irradiance arriving at a surface with normal n (same evaluation as three.js light probes).
vec3 skyIrradiance(vec3 n) {
  float x = n.x, y = n.y, z = n.z;
  vec3 r = uSkySH[0] * 0.886227;
  r += uSkySH[1] * 1.023328 * y;
  r += uSkySH[2] * 1.023328 * z;
  r += uSkySH[3] * 1.023328 * x;
  r += uSkySH[4] * 0.858086 * x * y;
  r += uSkySH[5] * 0.858086 * y * z;
  r += uSkySH[6] * (0.743125 * z * z - 0.247708);
  r += uSkySH[7] * 0.858086 * x * z;
  r += uSkySH[8] * 0.429043 * (x * x - y * y);
  return max(r, vec3(0.0));
}

// Mean density between two heights (km) for an exponential profile, for straight-line
// optical depth: tau = beta0 * distance * meanDensity.
float meanDensity(float h0, float h1, float H) {
  float dh = h1 - h0;
  float a = exp(-max(h0, 0.0) / H);
  if (abs(dh) < 1e-3) return a;
  return H * (a - exp(-max(h1, 0.0) / H)) / dh;
}

// The haze between the camera and a world position: what fraction of the surface's light
// gets through (per channel, straight-line optical depth through the exponential layers),
// and what the air adds (from the froxels at this point's place on screen, uv 0..1).
${AERIAL_FN}
vec3 applyAerial(vec3 col, vec3 wp) {
  vec3 T, ins;
  aerial(wp, gl_FragCoord.xy / uResolution, T, ins);
  return col * T + ins;
}
`;

// The haze changes slowly across the screen and with distance, so meshes work it out per
// vertex and pass it on: AERIAL_VERT in the vertex shader (after gl_Position is set), and
// the fragment shader finishes with col * vApT + vApIns.
export const AERIAL_VERT = /* glsl */ `
${ATMO_PARS}
${AP_LAYOUT}
uniform sampler2D uAerialLUT;
uniform vec3 uCamPos;
uniform float uApMaxKm;
uniform vec3 uSunE;
varying vec3 vApT;
varying vec3 vApIns;
float meanDensity(float h0, float h1, float H) {
  float dh = h1 - h0;
  float a = exp(-max(h0, 0.0) / H);
  if (abs(dh) < 1e-3) return a;
  return H * (a - exp(-max(h1, 0.0) / H)) / dh;
}
${AERIAL_FN}
void aerialVertex(vec3 wp) {
  vec2 uv = clamp(gl_Position.xy / max(gl_Position.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);
  aerial(wp, uv, vApT, vApIns);
}
`;
export const AERIAL_FRAG_PARS = /* glsl */ `
varying vec3 vApT;
varying vec3 vApIns;
`;
