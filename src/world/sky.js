// Sky dome: a blue gradient, a warm glow toward the sun, a few simple cartoon clouds low in the sky, and a soft band of far hills
// and trees at the horizon. All in one shader on a sphere that follows the camera. The edges are soft,
// as if out of focus, because the bird is the focus.
//
//   const sky = new Sky(asset.sun);
//   scene.add(sky.object);
//   sky.update(camera);   // every frame
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector4 } from 'three';
import { hash } from '../ibis/motion/spring.js';
import { NOISE } from '../ibis/materials.js';

const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');
// Picked from the concept art. Far things go light and blue, toward the sky: air, not fog.
const COLOURS = {
  top: srgb(0.24, 0.58, 0.93),
  horizon: srgb(0.78, 0.91, 0.98),
  warm: srgb(1.0, 0.92, 0.78),          // the horizon toward the sun
  sun: srgb(1.0, 0.98, 0.90),
  cloud: srgb(0.96, 0.97, 1.0),       // just below the bloom threshold, so clouds don't glow
  cloudShade: srgb(0.78, 0.85, 0.97),
  hills: srgb(0.66, 0.79, 0.87),
  farTrees: srgb(0.58, 0.74, 0.77),
  trees: [srgb(0.55, 0.70, 0.52), srgb(0.43, 0.59, 0.55)],   // lit, shade
};
// The ground fades to this far away, so it meets the trees at the horizon.
export const HAZE = srgb(0.71, 0.80, 0.68);   // pale sage: far fields, not water
// Clouds: count, base elevation range (radians: low, so the hills cover their feet), and width range.
// Each cloud is a wide flat base, a big dome off centre, and a small bump on each side.
const CLOUDS = { count: 5, elevation: [0.05, 0.12], width: [0.2, 0.32], seed: 11 };

export class Sky {
  constructor(sun) {
    const uniforms = { uSun: { value: sun }, uClouds: { value: clouds() }, u_haze: { value: HAZE } };
    for (const [name, value] of Object.entries(COLOURS)) {
      if (Array.isArray(value)) [uniforms[`u_${name}`], uniforms[`u_${name}Shade`]] = value.map(v => ({ value: v }));
      else uniforms[`u_${name}`] = { value };
    }
    const material = new ShaderMaterial({
      side: BackSide, depthWrite: false, depthTest: false, uniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${NOISE}
        #define CLOUDS ${CLOUDS.count}
        #define PI 3.14159265
        #define CLOUD_BASE ${(CLOUDS.elevation[0] - 0.02).toFixed(4)}   // below every cloud
        uniform vec3 u_haze, uSun, u_top, u_horizon, u_warm, u_sun, u_cloud, u_cloudShade, u_hills, u_farTrees, u_trees, u_treesShade;
        uniform vec4 uClouds[CLOUDS * 2];   // azimuth, base elevation, width, dome offset; side bump sizes, lean
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
          float s = max(dot(d, uSun), 0.0);
          col = mix(col, u_sun, 0.35 * pow(s, 24.0) + smoothstep(0.9992, 0.9995, s));
          // Clouds, in units of the cloud's width: a flat ellipse for the base, a dome and two side
          // bumps on it. The underside of the base is a pale cool band; the dome has a faint shade on
          // the side away from the sun.
          float sunAz = atan(uSun.x, uSun.z);
          if (el > CLOUD_BASE) for (int i = 0; i < CLOUDS; i++) {
            vec4 A = uClouds[2 * i], B = uClouds[2 * i + 1];
            vec2 q = vec2((mod(az - A.x + PI, 2.0 * PI) - PI) * cos(el), el - A.y) / A.z;
            float soft = SOFT / A.z;
            float base = (1.0 - length((q - vec2(0.0, 0.11)) / vec2(0.5, 0.11))) * 0.11;
            float dome = 0.26 - length(q - vec2(A.w, 0.24));
            float left = B.x - length(q - vec2(-0.27, 0.17));
            float right = B.y - length(q - vec2(0.29, 0.15));
            float d = max(max(base, dome), max(left, right));
            float m = smoothstep(-soft, soft, d);
            if (m <= 0.0) continue;
            float side = sign(sin(sunAz - A.x));
            float under = smoothstep(soft, -soft, (length((q - vec2(0.0, 0.045)) / vec2(0.52, 0.06)) - 1.0) * 0.06);
            float away = smoothstep(-soft, soft, length(q - vec2(A.w + 0.1 * side, 0.15)) - 0.26) * smoothstep(-soft, soft, dome);
            vec3 cc = mix(u_cloud, u_cloudShade, max(under, 0.4 * away));
            col = mix(col, cc, m);
          }
          // Horizon: hills, then far trees in the haze, then near trees with a lit top.
          float hills = 0.035 + 0.06 * pow(ridge(az, 3.0, 1.0), 1.5);
          float far = 0.012 + 0.016 * ridge(az, 14.0, 2.0) + 0.008 * ridge(az, 45.0, 3.0);
          float near = 0.004 + 0.022 * pow(ridge(az, 10.0, 4.0), 2.0) + 0.009 * ridge(az, 60.0, 5.0);
          col = mix(col, u_hills, smoothstep(SOFT, -SOFT, el - hills));
          col = mix(col, u_farTrees, smoothstep(SOFT, -SOFT, el - far));
          vec3 trees = mix(u_treesShade, u_trees, smoothstep(-SOFT, SOFT, el - near * 0.5 - 0.004 * ridge(az, 40.0, 6.0)));
          col = mix(col, mix(trees, u_farTrees, 0.35), smoothstep(SOFT, -SOFT, el - near));
          // Below the trees: the haze the ground fades into.
          col = mix(col, u_haze, smoothstep(SOFT, -SOFT, el + 0.002));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.object = new Mesh(new SphereGeometry(500, 32, 16), material);
    this.object.renderOrder = -2;
    this.object.frustumCulled = false;
  }

  update(camera) { this.object.position.copy(camera.position); }
}

// Two vec4 for each cloud: azimuth, base elevation, width, dome offset; left and right bump radii.
function clouds() {
  const C = CLOUDS, out = [];
  let k = 0;
  const rand = (a, b) => a + (b - a) * hash(C.seed + k++);
  for (let i = 0; i < C.count; i++) {
    const az = (i + rand(0.15, 0.85)) / C.count * 2 * Math.PI - Math.PI;
    out.push(new Vector4(az, rand(...C.elevation), rand(...C.width), rand(-0.1, 0.1)));
    out.push(new Vector4(rand(0.12, 0.18), rand(0.09, 0.15), 0, 0));
  }
  return out;
}
