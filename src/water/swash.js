// The swash (v5): the sheet of water each wave sends up the beach after its bore collapses at
// the shoreline, and the backwash that slides back down.
//
// v1 to v4 raised the water level over the whole beach at once, like a tide, with a thin
// bright line where that level met the sand. Real swash is a sheet: it shoots up the beach,
// slowing (gravity pulls it back down the slope), thin at its lacy front and a few centimetres
// thick behind it, stops, and drains back down faster and thinner, leaving the sand glossy for
// a few seconds. Each wave's sheet runs its own height, set by the wave's size and changing
// along the shore, and the next uprush meets the last backwash.
//
// Worked out from the time, the place and the bed's height alone, so the sea (the sheet's
// surface), the ground (wet, glossy or drying sand under and behind it) and the foam
// simulation (which moves with the sheet) all see the same swash without sharing any state.
// The shape of the sheet follows Shen and Meyer's solution for a bore collapsing on a plane
// beach (the edge moves like a ball thrown up the slope, the water thins toward it), loosened
// for looks: theirs is only millimetres thick near the front.
//
// Heights are metres above the still water, times in seconds. The wave train is the surf's
// (water-shader.js): the same clock, the same wave sizes and the same shoreline arrival times,
// so each sheet starts where a bore reaches the sand.

export const SWASH_GLSL = /* glsl */ `
uniform float uRunup;    // how high the swash of an average wave runs (m above the still water)
uniform float uSwashT;   // seconds an average wave's uprush takes

// Hash from Dave Hoskins, "Hash without Sine" (MIT), and value noise on it.
float swHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float swNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(swHash(i), swHash(i + vec2(1.0, 0.0)), u.x),
             mix(swHash(i + vec2(0.0, 1.0)), swHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Wave timing on the beach: not a metronome. The clock runs a little fast and slow, so the
// gaps between waves vary, and the heights come in sets of three or four bigger ones. (The
// 0.3 s only sets which moment of the break the hero frames, frozen at 17 s, catch: the lip
// in mid-throw, as in wave-breaking-closeup.jpg.)
float waveClock(float t) { t += 0.3; return t + 1.6 * sin(t * 0.0937) + 0.9 * sin(t * 0.2167 + 1.3); }
float waveRate(float t) { t += 0.3; return 1.0 + 0.15 * cos(t * 0.0937) + 0.195 * cos(t * 0.2167 + 1.3); }
float setSize(float idx) { return (0.78 + 0.3 * sin(idx * 0.861 + 0.7)) * mix(0.75, 1.25, swHash(vec2(idx, 3.1))); }
// How far along its cycle the surf is at a place (the crests are not straight lines).
float shoreJag(vec2 p) { return swNoise(p * 0.012) * 0.45 + swNoise(p * 0.035) * 0.16 + swNoise(p * 0.11) * 0.03; }

struct Swash {
  float surf;    // height of the sheet's surface here (under the sand beyond its edge)
  float film;    // water on the sand here (m, 0 where dry)
  float up;      // 1 while the water here runs up the beach, 0 while it runs back
  float vel;     // how fast the water here moves up the beach (m/s, negative in the backwash)
  float front;   // how much of the uprush's foamy front is here (0..1)
  float dry;     // seconds since the water last left this spot (0 while covered)
  float reach;   // the highest any of the last few waves has run here (m)
  float edgeUp;  // the newest sheet's edge: how far above this spot it is (m of height)
  float edgeZ;   // the highest edge of any sheet running now, above this spot (m of height;
                 // negative: dry). Linear across the sand, so it interpolates exactly between
                 // vertices: its zero line is the sheet's edge.
  float frontZ;  // the same for the sheets running up (their foamy front)
};

const float SW_RUNDOWN = -0.25;   // the backwash drains down to here before the next bore

// One wave's sheet at bed height z, tau seconds after its bore reached the shoreline.
// R is how high it runs, tu how long its uprush takes (the backwash takes 1.8 times as long).
void swashWave(float z, float lobe, float tau, float R, float tu, inout Swash o, inout float newestTau) {
  float td = 1.8 * tu;
  float span = R - SW_RUNDOWN;
  float zl = z - lobe;   // where the edge reaches is shifted a little by the lobes of the front
  // When the edge passes this spot going up, and going back down.
  float ez = (zl - SW_RUNDOWN) / span;
  if (ez < 1.0 && tau >= 0.0) {
    float tUp = tu * (1.0 - sqrt(max(1.0 - ez, 0.0)));
    float tDown = tu + td * pow(max(1.0 - ez, 0.0), 1.0 / 1.7);
    if (tau >= tUp && tau <= tDown) o.dry = 0.0;
    else if (tau > tDown) o.dry = min(o.dry, tau - tDown);
    o.reach = max(o.reach, R);
  }
  if (tau < 0.0 || tau > tu + td) return;
  bool rising = tau < tu;
  float e = rising ? 1.0 - (1.0 - tau / tu) * (1.0 - tau / tu) : 1.0 - pow((tau - tu) / td, 1.7);
  float Z = SW_RUNDOWN + span * e;
  float zeta = Z - zl;
  if (tau < newestTau) { newestTau = tau; o.edgeUp = zeta; }
  o.edgeZ = max(o.edgeZ, zeta);
  if (rising) o.frontZ = max(o.frontZ, zeta);
  // The sheet: thin at its edge, thicker behind; thick at first (the bore), thinning as it
  // runs out of speed, and thin in the backwash.
  float cap = rising ? mix(0.3, 0.06, tau / tu) : mix(0.05, 0.008, (tau - tu) / td);
  float h = zeta > 0.0 ? min(rising ? 0.16 * zeta + 0.3 * zeta * zeta : 0.07 * zeta + 0.1 * zeta * zeta, cap) : zeta;
  if (z + h > o.surf) {
    o.surf = z + h;
    // Speed along the slope (about 1 in 7): the edge's own speed, and the water behind it a
    // little slower going up; going back it gathers speed.
    float dZ = rising ? 2.0 * span * (1.0 - tau / tu) / tu : -1.7 * span * pow(max((tau - tu) / td, 1e-3), 0.7) / td;
    o.vel = clamp(dZ / 0.14 * (rising ? 0.85 : 1.0), -3.5, 5.0);
    o.up = rising ? 1.0 : 0.0;
  }
  if (rising && zeta > 0.0) o.front = max(o.front, smoothstep(0.0, 0.006, zeta) * (1.0 - smoothstep(0.03, 0.13, zeta)) * (1.0 - smoothstep(0.7, 1.0, tau / tu) * 0.6));
}

// The swash at map position p (x east, y north), with bed height z (m), at time t. back: how
// many earlier waves to look at: 1 is enough for the water itself (a sheet lasts under a
// wave period), the sand's memory of being wet wants 3.
Swash swashAt(vec2 p, float z, float t, float period, int back) {
  Swash o = Swash(-1e3, 0.0, 0.0, 0.0, 0.0, 60.0, -1e3, -1e3, -1e3, -1e3);
  float clock = waveClock(t) / period;
  float jag = shoreJag(p);
  float rate = waveRate(t);
  float i0 = floor(clock + jag);
  float newestTau = 1e9;
  // The waves that could still be running here or left it wet: the next one (it can arrive a
  // little early), this one and the three before.
  for (int k = -3; k <= 1; k++) {
    if (k < -back) continue;
    float idx = i0 + float(k);
    float wob = swNoise(p * 0.03 + idx * 5.13) - 0.5;
    float tau = (clock - (idx - jag - 0.12 * wob)) * period / rate;
    if (tau < -1.0) continue;
    float big = setSize(idx) * mix(0.6, 1.2, swNoise(p * 0.04 + idx * 7.31));
    // How high it runs: its size, and lobes along the shore that change from wave to wave.
    float R = uRunup * (0.45 + 0.55 * big) * (0.78 + 0.44 * swNoise(p * 0.09 + idx * 3.7));
    float tu = uSwashT * sqrt((R - SW_RUNDOWN) / (uRunup - SW_RUNDOWN));
    // The front runs up in lobes a metre or two across, and fingers between them; seen as
    // the height the sheet reaches here, a few centimetres more or less.
    float lobe = (swNoise(p * 0.45 + idx * 11.3) - 0.5) * 0.09 + (swNoise(p * 1.3 + idx * 5.9) - 0.5) * 0.035;
    swashWave(z, lobe, tau, R, tu, o, newestTau);
  }
  o.film = max(o.surf - z, 0.0);
  return o;
}

// The foamy front of an uprush, from how far its edge is above this spot (frontZ).
float swashFront(float zeta) { return smoothstep(0.0, 0.006, zeta) * (1.0 - smoothstep(0.03, 0.13, zeta)); }

// The swash as worked out for this frame over the beach (swash-map.js): edge, front edge,
// thickness or minus the seconds since it was dry, speed up the beach. Outside the map, dry.
uniform sampler2D uSwashMap;
uniform vec3 uSwashRect;
vec4 swashMap(vec2 p) {
  vec2 uv = (p - uSwashRect.xy) / uSwashRect.z;
  if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) > 1.0) return vec4(-1.0, -1.0, -60.0, 0.0);
  return texture2D(uSwashMap, uv);
}
`;
