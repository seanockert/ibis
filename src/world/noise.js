// Value noise from a tiling texture, for the ground and the tufts: one texture read in place of the 8 sin
// hashes of noise3() (materials.js). Each texel holds the 4 lattice values round its cell (rgba: x0y0,
// x1y0, x0y1, x1y1) and the shader blends them. The hardware filter blends with 8-bit weights on some GPUs,
// which gave jagged toon edges on the grass patches. Repeats each NOISE_SIZE lattice cells (more than 500
// units for the grass patches). For more noises, move p: noise2(p + vec2(37.0, 17.0)) is another one.
//
//   uniforms: { uNoise: noiseUniform }
//   GLSL: ${NOISE_TEX}, then noise2(p): 0 to 1, smooth between lattice points.
import { DataTexture, NearestFilter, RepeatWrapping, RGBAFormat } from 'three';
import { hash } from '../ibis/motion/spring.js';

const NOISE_SIZE = 256;

function noiseTexture() {
  const n = NOISE_SIZE, value = (x, y) => Math.floor(hash(((y % n) * n + (x % n)) + 7919) * 256);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    data.set([value(x, y), value(x + 1, y), value(x, y + 1), value(x + 1, y + 1)], (y * n + x) * 4);
  }
  const texture = new DataTexture(data, n, n, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export const noiseUniform = { value: noiseTexture() };

// Vertex and fragment shaders: no derivatives, level 0.
export const NOISE_TEX = /* glsl */`
uniform sampler2D uNoise;
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 c = textureLod(uNoise, (i + 0.5) / ${NOISE_SIZE}.0, 0.0);
  return mix(mix(c.x, c.y, f.x), mix(c.z, c.w, f.x), f.y);
}
`;
