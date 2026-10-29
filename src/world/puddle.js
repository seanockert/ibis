// A muddy puddle on the nature strip. A step in it splashes mud on the bird's legs, a run splashes
// higher, and a jump into it splashes the bird to the belly. Flat: the bird walks through it, the
// physics does not know it.
//
//   const puddle = new Puddle(asset.sun);
//   scene.add(puddle.object);
//   puddle.update(dt, ibises);   // every frame, after ibis.update(dt)
//   for (const e of puddle.events) ...   // { type: 'splash', ibis, at, strength (0 to 1), land }
//
// The shape is a wobbly ellipse (shape() here and in the shader): water inside, a bank of wet mud
// round it. Splashes make rings on the water.
import { Mesh, PlaneGeometry, ShaderMaterial, Vector3, Vector4 } from 'three';
import { lightUniforms, NOISE, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { clamp } from '../ibis/motion/spring.js';
import { srgb, f } from './util.js';


// at: centre [x, z]; radius: half sizes of the water [x, z] before the turn; heading: turn about y.
// bank: outer edge of the wet mud, part of the water radius.
export const PUDDLE = { at: [9.5, -1.4], radius: [1.5, 0.9], heading: 0.2, bank: 1.22, height: 0.006 };
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

// Distance from the centre in units of the water edge: below 1 in the water, up to PUDDLE.bank on the bank.
// The same formula is in the shader.
export function shape(x, z) {
  const { at, radius, heading } = PUDDLE;
  const dx = x - at[0], dz = z - at[1], c = Math.cos(heading), s = Math.sin(heading);
  const qx = (c * dx - s * dz) / radius[0], qz = (s * dx + c * dz) / radius[1];
  const a = Math.atan2(qz, qx);
  return Math.hypot(qx, qz) / (1 + 0.1 * Math.sin(3 * a + 1.3) + 0.06 * Math.sin(5 * a + 0.4));
}
export const inPuddle = (x, z, edge = 1) => shape(x, z) < edge;

// The bird's mud after a splash event. Never less than before.
export function splashMud(mud, e) {
  const { gain, cap } = e.land ? SPLASH.land : SPLASH.step;
  return Math.max(mud, Math.min(cap[0] + (cap[1] - cap[0]) * e.strength, mud + gain * (0.5 + e.strength)));
}

export class Puddle {
  constructor(sun) {
    const { at, radius, heading, bank, height } = PUDDLE;
    // A quad that holds the bank. The shader cuts the shape.
    const size = 2 * Math.max(...radius) * bank * 1.2;
    const geometry = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    this.material = puddleMaterial(sun);
    this.object = new Mesh(geometry, this.material);
    this.object.position.set(at[0], height, at[1]);
    this.object.rotation.y = heading;
    this.object.receiveShadow = true;
    this.object.renderOrder = -0.75;   // after the ground, before the footprints and the birds
    this.events = [];
    this.ripples = [];   // { x, z, age, strength }
    this.foot = new Vector3();
  }

  update(dt, ibises) {
    this.events.length = 0;
    for (const ibis of ibises) {
      const c = ibis.character, R = ibis.rig;
      if (!R || !c.events.length) continue;
      ibis.object.updateMatrixWorld();
      for (const e of c.events) {
        if (e.type === 'step') this.splash(ibis, [e.foot], 0.35 + 0.65 * clamp((Math.abs(c.controller.speed) - 0.5) / 2.5, 0, 1), false);
        if (e.type === 'land') this.splash(ibis, ['L', 'R'], clamp(0.45 + e.impact / 8, 0.45, 1), true);
      }
    }
    this.ripples = this.ripples.filter(r => (r.age += dt) < RIPPLE_TIME);
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uRipples.value.forEach((v, i) => {
      const r = this.ripples[i];
      v.set(r?.x ?? 0, r?.z ?? 0, r?.age ?? RIPPLE_TIME, r?.strength ?? 0);
    });
  }

  // One splash for the feet in the water, at their mean place.
  splash(ibis, feet, strength, land) {
    const at = new Vector3();
    let n = 0;
    for (const foot of feet) {
      const p = this.foot.copy(ibis.rig['foot' + foot]).setY(0).applyMatrix4(ibis.object.matrixWorld);
      if (!inPuddle(p.x, p.z)) continue;
      at.add(p);
      n++;
    }
    if (!n) return;
    at.divideScalar(n).setY(PUDDLE.height);
    this.events.push({ type: 'splash', ibis, at, strength, land });
    if (this.ripples.length >= RIPPLES) this.ripples.shift();
    this.ripples.push({ x: at.x, z: at.z, age: 0, strength });
  }
}

function puddleMaterial(sun) {
  const { at, radius, heading, bank } = PUDDLE;
  const uniforms = {
    ...lightUniforms(), uSun: { value: sun }, uTime: { value: 0 },
    uRipples: { value: Array.from({ length: RIPPLES }, () => new Vector4(0, 0, RIPPLE_TIME, 0)) },
  };
  for (const [name, [lit, shade]] of Object.entries(COLOURS)) {
    uniforms[`u_${name}Lit`] = { value: lit };
    uniforms[`u_${name}Shade`] = { value: shade };
  }
  const tone = name => `mix(u_${name}Shade, u_${name}Lit, lit)`;
  return new ShaderMaterial({
    lights: true,
    depthWrite: false,   // the ground's depth is behind it, so the outline round the feet still shows
    uniforms,
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vec3(0, 1, 0));
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      ${NOISE}
      ${Object.keys(COLOURS).map(n => `uniform vec3 u_${n}Lit, u_${n}Shade;`).join('\n')}
      uniform vec3 uSun;
      uniform float uTime;
      uniform vec4 uRipples[${RIPPLES}];   // x, z, age, strength
      varying vec3 vWorld;
      // As shape() in puddle.js: distance from the centre in units of the water edge.
      float shape(vec2 p) {
        vec2 d = p - vec2(${f(at[0])}, ${f(at[1])});
        float c = ${f(Math.cos(heading))}, s = ${f(Math.sin(heading))};
        vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / vec2(${f(radius[0])}, ${f(radius[1])});
        float a = atan(q.y, q.x);
        return length(q) / (1.0 + 0.1 * sin(3.0 * a + 1.3) + 0.06 * sin(5.0 * a + 0.4));
      }
      // 1 inside edge, a pixel of blur.
      float inside(float v, float edge, float w) { return 1.0 - smoothstep(edge - w, edge + w, v); }
      void main() {
        vec2 p = vWorld.xz;
        // The bank has a noisy outer edge, so it reads as mud on the grass, not a ring.
        float d = shape(p), w = max(fwidth(d), 1e-4);
        float rim = ${f(bank)} + 0.08 * (noise3(vec3(p * 2.2, 3.0)) - 0.5);
        vec2 lamp = lampLight(vec3(0.0, 1.0, 0.0));
        float lit = lampBand(sunShadow(), lamp);
        vec3 col = ${tone('bank')};
        // Water: a shallow band at the edge, slow streaks of sky, and rings from the splashes.
        float water = inside(d, 1.0, w);
        vec3 wet = mix(${tone('water')}, ${tone('shallow')}, smoothstep(0.82 - w, 0.82 + w, d));
        float streak = noise3(vec3(p.x * 0.9 + p.y * 0.6, (p.y - p.x * 0.4) * 3.2, uTime * 0.12));
        float sw = max(fwidth(streak), 1e-4);
        wet = mix(wet, ${tone('sky')}, 0.75 * smoothstep(0.7 - sw, 0.7 + sw, streak) * inside(d, 0.78, w));
        float ring = 0.0;
        for (int i = 0; i < ${RIPPLES}; i++) {
          vec4 r = uRipples[i];
          float k = r.z / ${f(RIPPLE_TIME)};
          if (k >= 1.0) continue;
          float dist = length(p - r.xy), radius = 0.12 + (0.5 + 0.7 * r.w) * sqrt(k), width = 0.05 * (1.0 - k) + 0.01;
          float rw = max(fwidth(dist), 1e-4);
          ring = max(ring, (1.0 - k) * inside(abs(dist - radius), width, rw));
        }
        wet = mix(wet, ${tone('sky')}, 0.8 * ring);
        col = mix(col, wet, water);
        // A dark line at the water edge, and a thin one round the bank.
        col = mix(col, ${tone('line')}, inside(abs(d - 1.0), 0.025, w));
        col = mix(col, ${tone('line')}, 0.5 * inside(abs(d - rim), 0.02, w));
        // Cut last: fwidth() above needs every pixel of the quad.
        if (d > rim) discard;
        gl_FragColor = vec4(night(col, lamp), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
