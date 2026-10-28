// Day, night and the street lamps for every toon shader.
//
//   LIGHT: shared uniforms (in lightUniforms(), materials.js).
//   LIGHT_GLSL: lampLight(n), night(col, lamp). In TOON.
//   new DayCycle(asset.sun): day, dusk, night, morning.
//
// The lamps (lamps.js) fill MAX_LAMPS slots: position, on, and a tile of one shadow atlas. Pools do
// not overlap, so a pixel takes the one lamp it is under: one shadow lookup. Day: one uniform branch.
import { Matrix4, Quaternion, Vector2, Vector3, Vector4 } from 'three';

export const MAX_LAMPS = 4;
export const LIGHT = {
  clock: { value: 0 },                                                 // DayCycle: 0 day, 1 dusk, 2 night, 3 morning
  night: { value: 0 },                                                 // 0 day, 1 night
  power: { value: 0 },                                                 // lamps, 0 to 1
  dusk: { value: 0 }, morning: { value: 0 },                           // weight of each, 0 to 1
  tint: { value: new Vector3(1, 1, 1) },                               // toon colour cast
  sunOrb: new Vector3(0, 1, 0), moonOrb: new Vector3(0, -1, 0),        // drawn sun and moon directions
  lamps: { value: Array.from({ length: MAX_LAMPS }, () => new Vector4()) },   // lens xyz, on
  lampMatrix: { value: Array.from({ length: MAX_LAMPS }, () => new Matrix4()) },   // world to atlas tile
  lampShadow: { value: null },
  lampCone: { value: new Vector2(1, 1) },                               // cos of the pool and its bright middle
};

export const LIGHT_GLSL = /* glsl */`
#define MAX_LAMPS ${MAX_LAMPS}
uniform float uNight;
uniform vec3 uTint;
uniform vec4 uLamps[MAX_LAMPS];
uniform mat4 uLampMatrix[MAX_LAMPS];
uniform sampler2D uLampShadow;
uniform vec2 uLampCone;
varying vec3 vToonWorld;
const vec3 NIGHT_MOON = vec3(0.13, 0.17, 0.33);
const vec3 NIGHT_LAMP = vec3(1.0, 0.8, 0.52);
const float LAMP_RIM = 0.62;
float lampShadow(int i, vec3 p, vec3 n, vec3 l) {
    vec4 c = uLampMatrix[i] * vec4(p + n * 0.04 + l * 0.06, 1.0);
    c.xyz /= c.w;
    vec2 t = 0.5 / vec2(textureSize(uLampShadow, 0));
    float s = step(c.z, texture2D(uLampShadow, c.xy + vec2(-t.x, -t.y)).r)
            + step(c.z, texture2D(uLampShadow, c.xy + vec2(t.x, -t.y)).r)
            + step(c.z, texture2D(uLampShadow, c.xy + vec2(-t.x, t.y)).r)
            + step(c.z, texture2D(uLampShadow, c.xy + vec2(t.x, t.y)).r);
    return smoothstep(0.35, 0.65, 0.25 * s);
}
// x: lamp light 0 to 1 (pool, facing, shadow, on). y: brightness (LAMP_RIM in the outer ring).
vec2 lampLight(vec3 n) {
    if (uNight <= 0.0) return vec2(0.0, 1.0);
    vec3 p = vToonWorld;
    int k = 0;
    float best = -2.0;
    for (int i = 0; i < MAX_LAMPS; i++) {
        vec3 d = uLamps[i].xyz - p;
        float c = uLamps[i].w > 0.0 ? d.y * inversesqrt(dot(d, d)) : -1.0;
        if (c > best) { best = c; k = i; }
    }
    vec3 l = normalize(uLamps[k].xyz - p);
    float w = 0.5 * max(fwidth(l.y), 1e-6);
    float pool = smoothstep(uLampCone.x - w, uLampCone.x + w, l.y);
    float ndl = dot(n, l);
    w = 0.5 * max(fwidth(ndl), 1e-5);
    float lit = uLamps[k].w * pool * smoothstep(BAND_SPLIT - w, BAND_SPLIT + w, ndl);
    if (lit > 0.0 && receiveShadow) lit *= lampShadow(k, p, n, l);
    return vec2(lit, mix(LAMP_RIM, 1.0, step(uLampCone.y, l.y)));
}
// Moonlit or lamplit colour, with the dusk or morning cast. Make col with the band max(band, lamp.x).
vec3 night(vec3 col, vec2 lamp) {
    if (uNight <= 0.0) return col;
    return mix(col, col * max(NIGHT_MOON, mix(NIGHT_MOON, NIGHT_LAMP * lamp.y, lamp.x)), uNight) * uTint;
}
// mix(shade, lit, band) with the lamps and the night.
vec3 toonLit(vec3 shade, vec3 lit, float band, vec3 n) {
    vec2 lamp = lampLight(n);
    return night(mix(shade, lit, max(band, lamp.x)), lamp);
}
`;

// The day cycle: day, dusk, night, morning. CYCLE.time: seconds for each step. moon: the key light at
// night. low: key light elevation at dusk and morning (radians). east: the morning sun's azimuth, from
// the opposite of the day sun. orb: drawn sun and moon elevations (high, low, below the horizon).
export const PERIODS = ['day', 'dusk', 'night', 'morning'];
export const CYCLE = {
  time: 4, moon: new Vector3(0.7, 0.42, -0.58).normalize(), low: 0.3, east: -0.9,
  orb: { high: 0.17, low: 0.13, below: -0.06 },
  night: [0, 0.45, 1, 0.45, 0],    // LIGHT.night at each period (and day again)
  power: [0, 1, 1, 0, 0],          // lamps
};
// Toon colour cast (linear multiply) at dusk and morning.
const TINT = { dusk: new Vector3(1.0, 0.78, 0.6), morning: new Vector3(0.98, 0.86, 0.9) };

// Steps LIGHT through the periods, and turns the shared sun direction (asset.sun): the key light.
//   cycle.next();         // to the next period
//   cycle.update(dt);     // every frame: true while it turns
export class DayCycle {
  constructor(sun, period = 'day') {
    this.sun = sun;
    const S = Math.atan2(sun.x, sun.z), E = S + Math.PI + CYCLE.east, M = Math.atan2(CYCLE.moon.x, CYCLE.moon.z);
    this.az = { sun: S, east: E, moon: M };
    this.keys = [sun.clone(), dir(new Vector3(), S, CYCLE.low), CYCLE.moon.clone(), dir(new Vector3(), E, CYCLE.low), sun.clone()];
    this.c = this.target = Math.max(PERIODS.indexOf(period), 0);
    this.apply();
  }

  get period() { return PERIODS[this.target % 4]; }
  get turning() { return this.c !== this.target; }

  next() { if (!this.turning) this.target = this.c + 1; }

  update(dt) {
    if (!this.turning) return false;
    this.c = Math.min(this.c + dt / CYCLE.time, this.target);
    if (this.c === this.target && this.c >= 4) this.c = this.target = 0;
    this.apply();
    return true;
  }

  apply() {
    const i = Math.min(Math.floor(this.c), 3), f = ease(this.c - i), O = CYCLE.orb, { sun: S, east: E, moon: M } = this.az;
    const lerp = (a, b) => a + (b - a) * f;
    LIGHT.clock.value = this.c;
    LIGHT.night.value = lerp(CYCLE.night[i], CYCLE.night[i + 1]);
    LIGHT.power.value = lerp(CYCLE.power[i], CYCLE.power[i + 1]);
    LIGHT.dusk.value = Math.max(0, 1 - Math.abs(this.c - 1));
    LIGHT.morning.value = Math.max(0, 1 - Math.abs(this.c - 3));
    LIGHT.tint.value.set(1, 1, 1).lerp(TINT.dusk, LIGHT.dusk.value).multiply(v.set(1, 1, 1).lerp(TINT.morning, LIGHT.morning.value));
    this.sun.copy(this.keys[i]).applyQuaternion(q.setFromUnitVectors(this.keys[i], this.keys[i + 1]).slerp(I, 1 - f));
    // Drawn sun and moon: they set and rise straight down and up; morning to day, the sun goes over the top.
    const half = (a, b, from) => a + (b - a) * ease(Math.min(Math.max((f - from) * 2, 0), 1));
    const sun = [
      () => [S, lerp(O.high, O.low)],
      () => [S, half(O.low, O.below, 0)],
      () => [E, half(O.below, O.low, 0.5)],
      () => [E + angle(S - E) * f, lerp(O.low, O.high) + 1.3 * Math.sin(Math.PI * f)],
    ][i]();
    const moon = [O.below, half(O.below, O.high, 0.5), half(O.high, O.below, 0), O.below][i];
    dir(LIGHT.sunOrb, ...sun);
    dir(LIGHT.moonOrb, M, moon);
  }
}

const ease = t => t * t * (3 - 2 * t);
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));   // to (-pi, pi]
const dir = (out, az, el) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
const q = new Quaternion(), I = new Quaternion(), v = new Vector3();
