// Shared parts of the flies (flies.js) and the bees (bees.js): state, seeded random, steering, flee
// points, one quad per insect, and the body and wing GLSL.
import { Float32BufferAttribute, InstancedBufferGeometry, Vector3 } from 'three';
import { hash } from '../ibis/motion/spring.js';

export const insect = (seed, more = {}) => ({ seed, n: 0, pos: new Vector3(), vel: new Vector3(), goal: new Vector3(), state: 'fly', timer: 0, ...more });

export const rand = i => hash(i.seed * 7919 + ++i.n);
export const range = (i, [a, b]) => a + (b - a) * rand(i);

// want: toward target at speed, slower nearer than ease. Returns that speed.
export function seek(i, target, speed, ease, want) {
  want.subVectors(target, i.pos);
  const d = want.length(), v = speed * Math.min(d / ease, 1);
  want.multiplyScalar(v / Math.max(d, 1e-4));
  return v;
}

// Turn the velocity toward want and move.
export function move(i, want, turn, dt) {
  i.vel.lerp(want, Math.min(turn * dt, 1));
  i.pos.addScaledVector(i.vel, dt);
}

// out.xz: a point away from `from`, seen from `at`, up to spread rad to one side, away units out. out.y is kept.
export function awayFrom(i, at, from, spread, away, out) {
  const dx = at.x - from.x, dz = at.z - from.z;
  const a = (Math.hypot(dx, dz) > 0.01 ? Math.atan2(dz, dx) : rand(i) * 2 * Math.PI) + spread * (2 * rand(i) - 1), d = range(i, away);
  out.x = at.x + Math.cos(a) * d;
  out.z = at.z + Math.sin(a) * d;
  return out;
}

// One quad (-1 to 1) for each insect.
export function quads(count) {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = count;
  return g;
}

// Fragment GLSL: ellipse() (below 0 inside), flicker() of the wings, insectColour(): body and wings,
// no pale wings at night. Needs uTime, uNight, uBody, uWing.
export const INSECT = /* glsl */`
uniform float uTime, uNight;
uniform vec3 uBody, uWing;
float ellipse(vec2 p, vec2 c, vec2 r) { return length((p - c) / r) - 1.0; }
float flicker(float base, float swing, float rate, float seed) { return base + swing * sin(uTime * rate + seed * 40.0); }
vec4 insectColour(vec3 body, float a, float w) {
  vec3 wing = mix(uWing, uBody, 0.7 * uNight);
  return vec4(mix(body, wing, w / max(a + w, 1e-4)), a + w);
}
`;
