// Wet mud, shared by the mud of land areas (land.js): the bird's mud from a splash, the rings on the
// water (Ripples) and the water's look (MUD_WATER, mudUniforms()).
import { Vector4 } from 'three';
import { srgb, f } from './util.js';

// Mud on the bird from one splash (ibis.mud, 0 to 1): gain for each unit of strength, and the most it can
// reach, at strength 0 and 1. A walk muddies the feet, a run the legs, a jump the belly.
export const SPLASH = { step: { gain: 0.1, cap: [0.25, 0.6] }, land: { gain: 0.35, cap: [0.5, 1] } };
const RIPPLES = 6;          // rings at one time
const RIPPLE_TIME = 1.1;    // seconds a ring lasts
// lit, shade. Warm in the sun, cool in the shade, as the street.
const COLOURS = {
  bank: [srgb(0.47, 0.36, 0.24), srgb(0.29, 0.25, 0.32)],
  water: [srgb(0.58, 0.47, 0.34), srgb(0.35, 0.32, 0.40)],
  shallow: [srgb(0.53, 0.41, 0.28), srgb(0.32, 0.28, 0.36)],
  sky: [srgb(0.86, 0.85, 0.76), srgb(0.58, 0.60, 0.72)],   // reflection streaks and rings
  line: [srgb(0.30, 0.22, 0.15), srgb(0.20, 0.17, 0.24)],
};

// The bird's mud after a splash event. Never less than before.
export function splashMud(mud, e) {
  const { gain, cap } = e.land ? SPLASH.land : SPLASH.step;
  return Math.max(mud, Math.min(cap[0] + (cap[1] - cap[0]) * e.strength, mud + gain * (0.5 + e.strength)));
}

// Splash rings for MUD_WATER.
export class Ripples {
  constructor() {
    this.list = [];   // { x, z, age, strength }
    this.uniforms = { uTime: { value: 0 }, uRipples: { value: Array.from({ length: RIPPLES }, () => new Vector4(0, 0, RIPPLE_TIME, 0)) } };
  }

  add(x, z, strength) {
    if (this.list.length >= RIPPLES) this.list.shift();
    this.list.push({ x, z, age: 0, strength });
  }

  update(dt) {
    this.list = this.list.filter(r => (r.age += dt) < RIPPLE_TIME);
    this.uniforms.uTime.value += dt;
    this.uniforms.uRipples.value.forEach((v, i) => {
      const r = this.list[i];
      v.set(r?.x ?? 0, r?.z ?? 0, r?.age ?? RIPPLE_TIME, r?.strength ?? 0);
    });
  }
}

export function mudUniforms() {
  const uniforms = {};
  for (const [name, [lit, shade]] of Object.entries(COLOURS)) {
    uniforms[`u_${name}Lit`] = { value: lit };
    uniforms[`u_${name}Shade`] = { value: shade };
  }
  return uniforms;
}

const tone = name => `mix(u_${name}Shade, u_${name}Lit, lit)`;
// GLSL, after TOON and NOISE: inside() (1 inside edge, w of blur) and mudWater(): the water with a shallow
// edge, sky streaks where deep, and rings.
export const MUD_WATER = /* glsl */`
      ${Object.keys(COLOURS).map(n => `uniform vec3 u_${n}Lit, u_${n}Shade;`).join('\n')}
      uniform float uTime;
      uniform vec4 uRipples[${RIPPLES}];   // x, z, age, strength
      float inside(float v, float edge, float w) { return 1.0 - smoothstep(edge - w, edge + w, v); }
      vec3 mudWater(vec2 p, float shallow, float deep, float lit) {
        vec3 wet = mix(${tone('water')}, ${tone('shallow')}, shallow);
        float streak = noise3(vec3(p.x * 0.9 + p.y * 0.6, (p.y - p.x * 0.4) * 3.2, uTime * 0.12));
        float sw = max(fwidth(streak), 1e-4);
        wet = mix(wet, ${tone('sky')}, 0.75 * smoothstep(0.7 - sw, 0.7 + sw, streak) * deep);
        float ring = 0.0;
        for (int i = 0; i < ${RIPPLES}; i++) {
          vec4 r = uRipples[i];
          float k = r.z / ${f(RIPPLE_TIME)};
          if (k >= 1.0) continue;
          float dist = length(p - r.xy), radius = 0.12 + (0.5 + 0.7 * r.w) * sqrt(k), width = 0.05 * (1.0 - k) + 0.01;
          float rw = max(fwidth(dist), 1e-4);
          ring = max(ring, (1.0 - k) * inside(abs(dist - radius), width, rw));
        }
        return mix(wet, ${tone('sky')}, 0.8 * ring);
      }
`;
