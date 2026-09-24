// Exposure, tone curve and colour grade, in one place, applied at the end of every material's
// shader (three.js's tone mapping hook), so there is no extra full-screen pass.
//
// Exposure works like a camera. The scene is in physical units (kcd/m2, see
// src/sky/atmosphere.js) and the exposure value comes from the viewpoint photo's EXIF
// (EV100 about 14.2, sunny-16 territory). A reflected-light meter puts the luminance
// 12.5 * 2^EV100 / 100 cd/m2 at middle grey (0.18), so one kcd/m2 becomes
// 0.18 * 1000 / (12.5 * 2^EV100 / 100) in linear pixel values. One exposure for every shot:
// the light does not change between them, so neither does the camera.
//
// The curve is Khronos PBR Neutral (it keeps hues and saturation where a filmic curve would
// wash them out), with a contrast and saturation trim on top, set against the photos.

import * as THREE from 'three';

export const GRADE_DEFAULTS = {
  ev100: 14.2,
  compensation: 0,   // stops, on top of the metered exposure
  contrast: 0,       // 0 = the curve as is; > 0 steeper around middle grey
  // The phone renders blue sky and open sea more saturated than the physical model gives
  // (measured against the two same-day photos); a light lift, not a look.
  saturation: 0.1,   // 0 = as rendered; > 0 more
  tint: [0, 0, 0],   // per-channel gain on top of the white balance, in stops
};

const CURVE = /* glsl */ `
uniform vec4 uGrade;   // contrast, saturation, unused, unused. All zero means no grade.
uniform vec3 uGradeTint;
vec3 CustomToneMapping( vec3 color ) {
  color *= toneMappingExposure * exp2(uGradeTint);
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(mix(vec3(l), color, 1.0 + uGrade.y), 0.0);
  // Contrast in log space around middle grey, so black and the highlights keep their place.
  color = 0.18 * pow(color / 0.18 + 1e-6, vec3(1.0 + uGrade.x));
  // Khronos PBR Neutral.
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
`;

export function createGrade(renderer, opts = {}) {
  const params = { ...GRADE_DEFAULTS, ...opts };
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (!chunk.includes(stub)) throw new Error('three.js tone mapping chunk has changed');
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, CURVE);
  renderer.toneMapping = THREE.CustomToneMapping;

  const uniforms = {
    uGrade: { value: new THREE.Vector4() },
    uGradeTint: { value: new THREE.Vector3() },
    // Not part of the grade, but shared by every material the same way: switches them to
    // flat class labels for the measuring tool (src/measure.js).
    uLabel: { value: 0 },
  };
  function apply() {
    // Linear value per kcd/m2 for a meter reading of ev100, then compensation.
    renderer.toneMappingExposure = (0.18 * 1000) / ((12.5 * Math.pow(2, params.ev100)) / 100) * Math.pow(2, params.compensation);
    uniforms.uGrade.value.set(params.contrast, params.saturation, 0, 0);
    uniforms.uGradeTint.value.fromArray(params.tint);
  }
  apply();
  return { params, uniforms, apply };
}
