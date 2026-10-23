// The street the bird plays in: strips of grass, footpath, kerb and road along x, drawn by one ground
// shader in world space. The plane follows the camera, so the street has no end.
//
//   const street = new Street();
//   scene.add(street.object);
//   street.update(camera);   // every frame
//
// Scale: the bird is 2 units, so 1 unit is about 35 cm. Sizes are a little smaller than real, as in a
// cartoon: a footpath is 3 units, the road 14 (two lanes).
import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { lightUniforms, NOISE, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { HAZE } from './sky.js';

const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');

// Strips across z, from the near side (the default camera) to the far side: [kind, far edge z].
export const STRIPS = [
  ['grass', 6], ['path', 3], ['grass', -3], ['kerb', -3.8], ['road', -17.8],
  ['kerb', -18.6], ['grass', -23], ['path', -26], ['grass', -Infinity],
];
// The bird can go anywhere on the street between the two footpaths. Props stay 0.5 inside a fence.
export const PLAY = { x: [-24, 24], z: [-25, 5.5] };
export const ROAD = { centre: -10.8, dash: [3, 3], dashWidth: 0.22 };   // centre line: dash and gap length
const JOINT = 3;          // footpath joints along x
const HAZE_FROM = [25, 220];   // distance where the ground starts to fade into the haze, and where it is all haze

// lit, shade, sRGB, picked from the concept art: warm yellow-green and peach in the sun, cool teal and
// lavender in the shade. The colour grade (grade.js) warms and lifts them a little more.
const COLOURS = {
  grass: [srgb(0.64, 0.77, 0.36), srgb(0.38, 0.59, 0.48)],
  grassSun: [srgb(0.77, 0.82, 0.42), srgb(0.44, 0.63, 0.50)],   // sunny patches
  grassDark: [srgb(0.53, 0.70, 0.33), srgb(0.33, 0.54, 0.47)],  // lush patches
  path: [srgb(0.94, 0.88, 0.81), srgb(0.67, 0.65, 0.77)],
  joint: [srgb(0.83, 0.75, 0.69), srgb(0.57, 0.55, 0.68)],
  kerb: [srgb(0.97, 0.91, 0.84), srgb(0.70, 0.68, 0.80)],
  road: [srgb(0.56, 0.54, 0.64), srgb(0.42, 0.41, 0.56)],
  patch: [srgb(0.52, 0.50, 0.61), srgb(0.39, 0.38, 0.53)],    // road repairs
  line: [srgb(0.97, 0.94, 0.88), srgb(0.73, 0.71, 0.82)],
};

export class Street {
  constructor() {
    const material = groundMaterial();
    // Draws first and writes no depth, as the old ground, so it can't cover the outline round the feet.
    this.object = new Mesh(new PlaneGeometry(900, 900).rotateX(-Math.PI / 2), material);
    this.object.receiveShadow = true;
    this.object.renderOrder = -1;
    this.object.frustumCulled = false;
  }

  update(camera) { this.object.position.set(camera.position.x, 0, camera.position.z); }
}

// Is a world point in the play area?
export const inPlay = (x, z) => x >= PLAY.x[0] && x <= PLAY.x[1] && z >= PLAY.z[0] && z <= PLAY.z[1];

function groundMaterial() {
  const uniforms = { ...lightUniforms(), uHaze: { value: HAZE } };
  for (const [name, [lit, shade]] of Object.entries(COLOURS)) {
    uniforms[`u_${name}Lit`] = { value: lit };
    uniforms[`u_${name}Shade`] = { value: shade };
  }
  const f = v => v.toFixed(3);
  const tone = name => `mix(u_${name}Shade, u_${name}Lit, lit)`;
  // One mix for each strip edge, a pixel wide, from the near side.
  const strips = STRIPS.slice(1).map(([kind], i) => `
    col = mix(col, ${kind}, smoothstep(-w, w, ${f(STRIPS[i][1])} - z));`).join('');
  return new ShaderMaterial({
    lights: true,
    depthWrite: false,
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
      uniform vec3 uHaze;
      varying vec3 vWorld;
      // 1 on a line of width (units) at u = 0, a pixel of blur at any distance.
      float line(float u, float width) {
        float w = max(fwidth(u), 1e-5);
        return 1.0 - smoothstep(width / 2.0 - w, width / 2.0 + w, abs(u));
      }
      void main() {
        vec3 p = vWorld;
        float z = p.z, w = max(fwidth(z), 1e-4), lit = sunShadow();
        // Grass: sunny and lush patches on the base green. The warp gives the patches a brushed edge.
        // Far away the patches get too small to read, so they fade out.
        float near = 1.0 - smoothstep(20.0, 45.0, distance(p, cameraPosition));
        vec2 g = p.xz + 1.6 * vec2(noise3(vec3(p.xz * 0.45, 1.0)), noise3(vec3(p.xz * 0.45, 2.0)));
        vec3 grass = mix(${tone('grass')}, ${tone('grassSun')}, near * smoothstep(0.58, 0.64, noise3(vec3(g * 0.2, 0.0))));
        grass = mix(grass, ${tone('grassDark')}, near * smoothstep(0.64, 0.70, noise3(vec3(g * 0.45, 5.0))));
        // Footpath: concrete slabs, with joints across.
        float jx = (fract(p.x / ${f(JOINT)} + 0.5) - 0.5) * ${f(JOINT)};
        vec3 path = mix(${tone('path')}, ${tone('joint')}, line(jx, 0.05));
        // Kerb: a rolled kerb.
        vec3 kerb = ${tone('kerb')};
        // Road: patches of repair, and the dashed centre line.
        vec3 road = mix(${tone('road')}, ${tone('patch')}, smoothstep(0.70, 0.74, noise3(vec3(p.xz * vec2(0.08, 0.25), 9.0))));
        float dx = mod(p.x, ${f(ROAD.dash[0] + ROAD.dash[1])}) - ${f(ROAD.dash[0] / 2)};
        road = mix(road, ${tone('line')}, line(z - ${f(ROAD.centre)}, ${f(ROAD.dashWidth)}) * line(dx, ${f(ROAD.dash[0])}));
        vec3 col = grass;
        ${strips}
        // A thin line on each strip edge.
        float e = 0.0;
        ${STRIPS.slice(0, -1).map(([, z]) => `e = max(e, line(z - ${f(z)}, 0.04));`).join('\n        ')}
        col = mix(col, ${tone('joint')}, e);
        col = mix(col, uHaze, smoothstep(${f(HAZE_FROM[0])}, ${f(HAZE_FROM[1])}, distance(p, cameraPosition)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
