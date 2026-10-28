// Sky dome: a blue gradient, a warm glow toward the sun, a few simple cartoon clouds low in the sky, and a soft band of far hills
// and trees at the horizon. All in one shader on a sphere that follows the camera. The edges are soft,
// as if out of focus, because the bird is the focus. Night: NIGHT_COLOURS, the moon, stars.
//
//   const sky = new Sky(asset.sun);
//   scene.add(sky.object);
//   sky.update(camera, dt);   // every frame: follows the camera, clouds drift
import { BackSide, LessEqualDepth, Mesh, ShaderMaterial, SphereGeometry, Vector3, Vector4 } from 'three';
import { hash } from '../ibis/motion/spring.js';
import { NOISE } from '../ibis/materials.js';
import { LIGHT } from './lighting.js';
import { srgb } from './util.js';

// Picked from the concept art. Far things go light and blue, toward the sky: air, not fog.
export const COLOURS = {
  top: srgb(0.24, 0.58, 0.93),
  horizon: srgb(0.78, 0.91, 0.98),
  warm: srgb(1.0, 0.92, 0.78),          // the horizon toward the sun
  sun: srgb(1.0, 0.98, 0.90),
  cloud: srgb(0.96, 0.97, 1.0),       // a little below white
  cloudShade: srgb(0.78, 0.85, 0.97),
  hills: srgb(0.66, 0.79, 0.87),
  farTrees: srgb(0.58, 0.74, 0.77),
  trees: [srgb(0.55, 0.70, 0.52), srgb(0.43, 0.59, 0.55)],   // lit, shade
};
export const NIGHT_COLOURS = {
  top: srgb(0.03, 0.05, 0.14),
  horizon: srgb(0.13, 0.17, 0.32),
  warm: srgb(0.22, 0.27, 0.42),
  sun: srgb(0.96, 0.95, 0.86),          // the moon
  cloud: srgb(0.27, 0.31, 0.45),
  cloudShade: srgb(0.21, 0.25, 0.38),
  hills: srgb(0.10, 0.13, 0.24),
  farTrees: srgb(0.08, 0.11, 0.20),
  trees: [srgb(0.09, 0.13, 0.19), srgb(0.06, 0.09, 0.15)],
};
// The ground fades to this far away, so it meets the trees at the horizon. haze: the uniform (ground and sky).
export const HAZE = srgb(0.71, 0.80, 0.68);   // pale sage: far fields, not water
const HAZE_NIGHT = srgb(0.09, 0.12, 0.21);
// Dusk and morning: these colours over the day to night blend.
const DUSK_COLOURS = {
  haze: srgb(0.56, 0.48, 0.52), top: srgb(0.30, 0.36, 0.62), horizon: srgb(0.98, 0.70, 0.52), warm: srgb(1.0, 0.52, 0.30),
  cloud: srgb(1.0, 0.76, 0.64), cloudShade: srgb(0.64, 0.50, 0.66), hills: srgb(0.60, 0.52, 0.64), farTrees: srgb(0.48, 0.45, 0.56),
};
const MORNING_COLOURS = {
  haze: srgb(0.72, 0.72, 0.76), top: srgb(0.46, 0.62, 0.88), horizon: srgb(0.96, 0.82, 0.80), warm: srgb(1.0, 0.80, 0.62),
  cloud: srgb(1.0, 0.90, 0.88), cloudShade: srgb(0.76, 0.72, 0.86), hills: srgb(0.66, 0.70, 0.80), farTrees: srgb(0.55, 0.62, 0.68),
};
export const haze = { value: HAZE.clone() };
// Stars: grid cells on the sphere, part with a star, radius and fade-in elevation (radians).
const STARS = { grid: 70, chance: 0.05, radius: [0.001, 0.0024], fade: [0.08, 0.3] };
// Drawn sun and moon: the light's azimuth, at most this elevation, so the low play camera sees them.
// Disc radii, radians. Where they are: DayCycle (lighting.js). Low sun colour at dusk and morning.
const ORB = { sun: 0.022, moon: 0.028 };
const SUNSET = srgb(1.0, 0.58, 0.30), SUNRISE = srgb(1.0, 0.82, 0.55);
// Clouds: count, base elevation range (radians: low, so the hills cover their feet), and width range.
// Each cloud is a wide flat base, a big dome off centre, and a small bump on each side.
// Clouds: base elevation and width (radians), drift speed (radians a second, all with the wind), the
// part of them with a top bump, and morph (how much the bumps swell and shrink) and its rate.
const CLOUDS = { count: 8, elevation: [0.05, 0.15], width: [0.14, 0.34], speed: [0.0008, 0.0028], top: 0.6, morph: 0.12, rate: 0.06, seed: 11 };

export class Sky {
  constructor(sun) {
    const uniforms = {
      uSun: { value: sun }, uSunOrb: { value: LIGHT.sunOrb }, uMoonOrb: { value: LIGHT.moonOrb },
      uSunDisc: { value: COLOURS.sun.clone() }, uMoonDisc: { value: NIGHT_COLOURS.sun }, uClouds: { value: clouds() }, uTime: { value: 0 }, u_haze: haze, uNight: LIGHT.night };
    // [uniform, name, day, night]
    this.palette = [[haze, 'haze', HAZE, HAZE_NIGHT]];
    for (const [name, value] of Object.entries(COLOURS)) {
      const night = NIGHT_COLOURS[name];
      if (Array.isArray(value)) {
        [uniforms[`u_${name}`], uniforms[`u_${name}Shade`]] = value.map(v => ({ value: v.clone() }));
        this.palette.push([uniforms[`u_${name}`], name, value[0], night[0]], [uniforms[`u_${name}Shade`], `${name}Shade`, value[1], night[1]]);
      } else {
        uniforms[`u_${name}`] = { value: value.clone() };
        this.palette.push([uniforms[`u_${name}`], name, value, night]);
      }
    }
    this.clock = -1;   // update() sets the palette on the first frame
    const material = new ShaderMaterial({
      side: BackSide, depthWrite: false, depthFunc: LessEqualDepth, uniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;   // on the far plane
        }`,
      fragmentShader: /* glsl */`
        ${NOISE}
        #define CLOUDS ${CLOUDS.count}
        #define PI 3.14159265
        #define CLOUD_BASE ${(CLOUDS.elevation[0] - 0.02).toFixed(4)}   // below every cloud
        uniform vec3 u_haze, uSun, uSunOrb, uMoonOrb, uSunDisc, uMoonDisc, u_top, u_horizon, u_warm, u_sun, u_cloud, u_cloudShade, u_hills, u_farTrees, u_trees, u_treesShade;
        uniform vec4 uClouds[CLOUDS * 3];   // see clouds()
        uniform float uNight, uTime;
        varying vec3 vDir;
        const float SOFT = 0.003;     // edge blur, radians: about 4 pixels at the play camera
        // Height of a band of bumps at the horizon, over the azimuth. Noise on a circle, so it wraps.
        float ridge(float az, float freq, float seed) {
          return noise3(vec3(cos(az) * freq, sin(az) * freq, seed));
        }
        void main() {
          vec3 d = normalize(vDir);
          float el = asin(clamp(d.y, -1.0, 1.0)), az = atan(d.x, d.z);
          vec3 col = mix(u_horizon, u_top, pow(smoothstep(0.0, 0.9, el), 0.5));
          float toSun = max(dot(normalize(d.xz + 1e-5), normalize(uSun.xz)), 0.0);
          col = mix(col, u_warm, 0.45 * toSun * toSun * (1.0 - smoothstep(0.0, 0.45, el)));
          if (uNight > 0.0 && el > ${STARS.fade[0].toFixed(3)}) {
            vec3 cell = floor(d * ${STARS.grid.toFixed(1)});
            if (hash3(cell) < ${STARS.chance}) {
              vec3 star = normalize(cell + 0.2 + 0.6 * vec3(hash3(cell + 3.1), hash3(cell + 7.7), hash3(cell + 1.3)));
              float r = mix(${STARS.radius[0]}, ${STARS.radius[1]}, hash3(cell + 5.9) * hash3(cell + 2.2));
              float a = length(d - star), w = 0.0008;   // no fwidth in a branch
              col = mix(col, vec3(0.9, 0.92, 1.0), smoothstep(0.5, 1.0, uNight) * smoothstep(${STARS.fade[0].toFixed(3)}, ${STARS.fade[1].toFixed(3)}, el) * (1.0 - smoothstep(r - w, r + w, a)));
            }
          }
          // Sun, or moon with seas.
          // Each behind the hills and haze below the horizon (drawn after).
          float s = max(dot(d, uSunOrb), 0.0);
          col = mix(col, uSunDisc, 0.35 * (1.0 - uNight) * pow(s, 24.0) + 1.0 - smoothstep(-0.0008, 0.0008, acos(s) - ${ORB.sun}));
          if (uNight > 0.0) {
            s = max(dot(d, uMoonOrb), 0.0);
            float disc = 1.0 - smoothstep(-0.0008, 0.0008, acos(s) - ${ORB.moon});
            vec3 moon = uMoonDisc * (disc > 0.0 ? 0.86 + 0.14 * smoothstep(0.35, 0.6, noise3(d * 110.0)) : 1.0);
            col = mix(col, moon, uNight * 0.12 * pow(s, 24.0) + disc);
          }
          // Clouds, in units of the cloud's width: a flat ellipse for the base, a dome, two side bumps and
          // maybe a top bump. They drift with the wind, bob, and the bumps swell and shrink. The underside
          // of the base is a pale cool band; the dome has a faint shade on the side away from the sun.
          float sunAz = atan(uSun.x, uSun.z);
          if (el > CLOUD_BASE) for (int i = 0; i < CLOUDS; i++) {
            vec4 A = uClouds[3 * i], B = uClouds[3 * i + 1], C = uClouds[3 * i + 2];
            float cAz = A.x + C.x * uTime, t = uTime * ${CLOUDS.rate} + C.y;
            vec2 q = vec2((mod(az - cAz + PI, 2.0 * PI) - PI) * cos(el) / C.z, el - A.y - 0.003 * sin(t * 0.7)) / A.z;
            if (abs(q.x) > 0.75 || q.y > 0.7) continue;
            float soft = SOFT / A.z;
            vec3 swell = 1.0 + ${CLOUDS.morph} * sin(vec3(t, t * 1.3 + 2.0, t * 0.8 + 4.0));
            float r = C.w * swell.x;
            float base = (1.0 - length((q - vec2(0.0, 0.11)) / vec2(0.44, 0.11))) * 0.11;
            float dome = r - length(q - vec2(A.w, 0.24));
            float left = B.x * swell.y - length(q - vec2(-0.27, 0.17));
            float right = B.y * swell.z - length(q - vec2(0.29, 0.15));
            float top = B.w * swell.y - length(q - vec2(B.z, 0.33));
            float d = max(max(base, dome), max(max(left, right), top));
            float m = smoothstep(-soft, soft, d);
            if (m <= 0.0) continue;
            float side = sign(sin(sunAz - cAz));
            // Underside: a band inside the base, under the bumps. Away side: a thin crescent on the dome and top.
            float under = smoothstep(soft, -soft, (length((q - vec2(0.0, 0.045)) / vec2(0.42, 0.06)) - 1.0) * 0.06);
            float away = smoothstep(-soft, soft, length(q - vec2(A.w + 0.07 * side, 0.17)) - r) * smoothstep(-soft, soft, max(dome, top));
            vec3 cc = mix(u_cloud, u_cloudShade, max(0.65 * under, 0.25 * away));
            col = mix(col, cc, m);
          }
          // Horizon: hills, then far trees in the haze, then near trees with a lit top. The highest hill is
          // 0.095, so above 0.1 nothing changes.
          if (el < 0.1) {
            float hills = 0.035 + 0.06 * pow(ridge(az, 3.0, 1.0), 1.5);
            float far = 0.012 + 0.016 * ridge(az, 14.0, 2.0) + 0.008 * ridge(az, 45.0, 3.0);
            float near = 0.004 + 0.022 * pow(ridge(az, 10.0, 4.0), 2.0) + 0.009 * ridge(az, 60.0, 5.0);
            col = mix(col, u_hills, smoothstep(SOFT, -SOFT, el - hills));
            col = mix(col, u_farTrees, smoothstep(SOFT, -SOFT, el - far));
            vec3 trees = mix(u_treesShade, u_trees, smoothstep(-SOFT, SOFT, el - near * 0.5 - 0.004 * ridge(az, 40.0, 6.0)));
            col = mix(col, mix(trees, u_farTrees, 0.35), smoothstep(SOFT, -SOFT, el - near));
            // Below the trees: the haze the ground fades into.
            col = mix(col, u_haze, smoothstep(SOFT, -SOFT, el + 0.002));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.object = new Mesh(new SphereGeometry(500, 32, 16), material);
    // After the opaque scene (the birds' outlines are 1), on the far plane: the depth test skips the
    // pixels the ground and the props cover, so the costly shader runs only where the sky shows. Before
    // the anger lines (3), which write no depth.
    this.object.renderOrder = 2;
    this.object.frustumCulled = false;
  }

  update(camera, dt = 0) {
    this.object.position.copy(camera.position);
    this.object.material.uniforms.uTime.value += dt;
    if (LIGHT.clock.value === this.clock) return;
    this.clock = LIGHT.clock.value;
    const k = LIGHT.night.value, dusk = LIGHT.dusk.value, morning = LIGHT.morning.value;

    for (const [u, name, day, night] of this.palette) {
      u.value.copy(day).lerp(night, k);
      if (DUSK_COLOURS[name]) u.value.lerp(DUSK_COLOURS[name], dusk).lerp(MORNING_COLOURS[name], morning);
    }
    // Sun colour: day, sunset (dusk and night), sunrise, day.
    const c = this.clock, sun = this.object.material.uniforms.uSunDisc.value;
    if (c <= 2) sun.copy(COLOURS.sun).lerp(SUNSET, Math.min(c, 1));
    else if (c <= 3) sun.copy(SUNSET).lerp(SUNRISE, c - 2);
    else sun.copy(SUNRISE).lerp(COLOURS.sun, c - 3);
  }
}

// Three vec4 for each cloud: azimuth at time 0, base elevation, width, dome offset; left and right
// bump radii, top bump x and radius (0: none); speed, phase, stretch across, dome radius.
function clouds() {
  const C = CLOUDS, out = [];
  let k = 0;
  const rand = (a, b) => a + (b - a) * hash(C.seed + k++);
  for (let i = 0; i < C.count; i++) {
    const az = (i + rand(0.15, 0.85)) / C.count * 2 * Math.PI - Math.PI;
    out.push(new Vector4(az, rand(...C.elevation), rand(...C.width), rand(-0.1, 0.1)));
    out.push(new Vector4(rand(0.1, 0.19), rand(0.08, 0.16), rand(-0.15, 0.15), rand(0, 1) < C.top ? rand(0.1, 0.16) : 0));
    out.push(new Vector4(rand(...C.speed), rand(0, 2 * Math.PI), rand(1.0, 1.4), rand(0.22, 0.27)));
  }
  return out;
}
