// Small maths for procedural motion: springs, easing and a seeded random.

export const TAU = Math.PI * 2;
export const mix = (a, b, k) => a + (b - a) * k;
export const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// 0 outside a..d, 1 inside b..c, smooth ramps between.
export const window4 = (a, b, c, d, x) => smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
// Angle in -PI..PI.
export const wrapAngle = a => a - TAU * Math.round(a / TAU);
// Moves x toward target by at most step.
export const approach = (x, target, step) => x < target ? Math.min(x + step, target) : Math.max(x - step, target);
// Exponential smoothing factor: the part of the gap closed in dt for a half-life in seconds.
export const damp = (halflife, dt) => 1 - Math.pow(2, -dt / halflife);

// Hash of an integer to 0..1. Same input, same output, so the motion is the same on each run.
export function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Damped spring. freq in Hz; zeta 1 gives no overshoot, less than 1 wobbles. Implicit Euler, so it is
// stable at any time step (Allen Chou, "Precise Control over Numeric Springing").
// kick() adds velocity: use it for impacts (a landing, a prod, a misstep).
export class Spring {
  constructor(value = 0, freq = 4, zeta = 1) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.freq = freq;
    this.zeta = zeta;
  }

  update(dt, target = this.target) {
    this.target = target;
    const w = TAU * this.freq, f = 1 + 2 * dt * this.zeta * w, hoo = dt * w * w, hhoo = dt * hoo, inv = 1 / (f + hhoo);
    const x = (f * this.value + dt * this.velocity + hhoo * target) * inv;
    this.velocity = (this.velocity + hoo * (target - this.value)) * inv;
    this.value = x;
    return x;
  }

  kick(velocity) { this.velocity += velocity; }
}
