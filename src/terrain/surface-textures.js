// Loads the scanned surfaces into three texture arrays (colour, normal, mask), one layer
// per surface. Arrays keep the sampler count down: WebGL only guarantees 16 per shader.

import * as THREE from 'three';
import { SURFACES } from './surfaces.js';
import { trampleNormal } from './trample.js';

// A layer made in code (v10): its normal from the generator, colour and mask flat.
function generated(s, kind, size) {
  if (kind === 'normal' && s.gen === 'trampled') return trampleNormal(size);
  const px = new Uint8Array(size * size * 4);
  const v = kind === 'mask' ? [235, 255, 0, 255] : [128, 128, 128, 255];
  for (let i = 0; i < px.length; i += 4) px.set(v, i);
  return px;
}

async function pixels(url, size) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  // No flip: layer rows stay in file order, and the shader's uv is laid out to match.
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

async function arrayTexture(kind, size, colorSpace, base, list) {
  const layers = await Promise.all(list.map((s) => (s.gen ? generated(s, kind, size) : pixels(`${base}${s.id}_${kind}.jpg`, size))));
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((px, i) => data.set(px, i * size * size * 4));
  const tex = new THREE.DataArrayTexture(data, size, size, layers.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = colorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// (list: which surfaces, in layer order; the path's are in src/trail/surfaces.js, v6.)
export async function loadSurfaceTextures(base = 'assets/textures/', list = SURFACES, colorSize = 2048) {
  const [color, normal, mask] = await Promise.all([
    arrayTexture('color', colorSize, THREE.SRGBColorSpace, base, list),
    arrayTexture('normal', 1024, THREE.NoColorSpace, base, list),
    arrayTexture('mask', 1024, THREE.NoColorSpace, base, list),
  ]);
  return { color, normal, mask, sizes: list.map((s) => s.size) };
}
