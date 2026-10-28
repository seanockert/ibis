// The street the bird plays in: strips of grass, footpath, kerb and road along x, drawn by one ground
// shader in world space. The road is lower than the rest, with a rolled kerb on each side, and the
// footpaths are a little higher than the grass (PROFILE: the same heights for the mesh, the physics and
// the footprints). The mesh follows the camera along x, so
// the street has no end.
//
//   const street = new Street(asset.sun, beds);   // beds: [{ at: [x, z], radius }], mulch round the trees
//   scene.add(street.object);
//   street.update(camera);   // every frame
//
// Scale: the bird is 2 units, so 1 unit is about 35 cm. Sizes are a little smaller than real, as in a
// cartoon: a footpath is 3 units, the road 14 (two lanes).
import { BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, Vector4 } from 'three';
import { lightUniforms, NOISE, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { smoothstep } from '../ibis/motion/spring.js';
import { haze } from './sky.js';
import { srgb, f } from './util.js';


// Strips across z, from the near side (the default camera) to the far side: [kind, far edge z].
export const STRIPS = [
  ['grass', 6], ['path', 3], ['grass', -3], ['kerb', -3.8], ['road', -17.8],
  ['kerb', -18.6], ['grass', -23], ['path', -26], ['grass', -Infinity],
];
// The bird can go anywhere on the street between the two footpaths, and a little onto the yard grass past
// them, so the fence stands on grass. Props stay 0.5 inside a fence.
export const PLAY = { x: [-48, 48], z: [-26.5, 6.5] };   // to 0.5 on the yard grass; the fence (fence.js) is just outside it
export const ROAD = { centre: -10.8, dash: [3, 3], dashWidth: 0.22 };   // centre line: dash and gap length
export const JOINT = 3;   // footpath joints along x
const HAZE_FROM = [25, 220];   // distance where the ground starts to fade into the haze, and where it is all haze
// Painted grass marks on the ground: a small tuft in some cells of a grid, drawn as if upright to the
// camera. cell: grid size, chance: part of the cells with a mark, size: height, units.
export const MARKS = { cell: 1.1, chance: 0.45, size: [0.08, 0.15] };
// Pebbles near the strip edges: a small pale mound in some cells of a grid, more of them nearer the edge.
// band: distance from an edge where they stop. A pebble must stay inside half a cell.
const PEBBLES = { cell: 0.7, chance: 0.4, band: 1.0, radius: [0.05, 0.12] };
// Kerb: the road is height lower than the rest. From the road edge: a flat gutter, then a roll up (an S
// curve) to the top. The roll is a slope the bird walks up (less than GROUND.stepUp in controller.js).
// segments: points along the roll. contact, lip: width of the shade at the foot of the roll and of the
// line on its top.
export const KERB = { height: 0.2, gutter: 0.22, roll: 0.5, segments: 8, contact: 0.1, lip: 0.035 };
// Footpath: the slabs stand height above the grass, with a round edge (an S curve, edge wide, in
// segments) on each long side: real geometry, so the bird steps up and the props rest on it. The slab
// ends at the joints have a bevel in the shader only (bevel wide, slope: its rise for each unit across),
// and the grass has a cool contact shade (contact wide) along each path edge. A slope that faces the sun
// gets a light lip, one that faces away the cool form tone: the cartoon read of a raised slab.
export const PATH = { height: 0.1, edge: 0.06, segments: 4, bevel: 0.06, slope: 0.8, contact: 0.08 };
const REACH = 450;   // half size of the ground mesh
// Height across the street: [z, y] points from the near side (+z) to the far side, straight between.
export const PROFILE = profile();
const FORM = 0.75;          // N.L below this: the cool form tone. Flat ground is above it
const DEPTH_BIAS = 0.2;    // the ground writes its depth this far behind it, along the view ray

// Mulch: patches of bare dirt and bark through the grass round the foot of a tree, full near the trunk,
// broken into small patches out to reach (a part of the radius), none past it. patch: frequency of the
// patch noise. tint: how much of the mulch colour, over the grass under it. clear: the part of the
// radius with no tufts (the tufts grow among the outer patches). chip: grid of the chips (one in some
// cells), chance: part of the cells with a chip. A chip must stay inside half a cell.
export const MULCH = { max: 8, reach: 1.25, patch: 2.2, tint: 0.6, clear: 0.6, chip: 0.3, chance: 0.4 };

// Cracks: part of the footpath slabs with a crack, a zigzag of three strokes from one side of the path.
const CRACKS = { chance: 0.35, width: 0.035 };

// lit, shade, sRGB, picked from the concept art: warm yellow-green and peach in the sun, cool teal and
// lavender in the shade. The two are far apart on purpose: the warm and cool split carries the cartoon
// light. The colour grade (grade.js) warms and lifts them a little more.
const COLOURS = {
  grass: [srgb(0.69, 0.80, 0.34), srgb(0.31, 0.53, 0.52)],
  grassSun: [srgb(0.82, 0.86, 0.44), srgb(0.37, 0.58, 0.54)],   // sunny patches
  grassDark: [srgb(0.56, 0.72, 0.31), srgb(0.27, 0.48, 0.50)],  // lush patches
  path: [srgb(0.97, 0.89, 0.78), srgb(0.62, 0.62, 0.80)],
  pathSide: [srgb(0.97, 0.89, 0.78), srgb(0.78, 0.68, 0.64)],   // the side of a slab away from the sun: darker concrete
  joint: [srgb(0.85, 0.74, 0.65), srgb(0.53, 0.52, 0.71)],
  kerb: [srgb(0.99, 0.91, 0.80), srgb(0.66, 0.65, 0.83)],
  road: [srgb(0.37, 0.36, 0.44), srgb(0.23, 0.24, 0.38)],     // dark slate, so the kerbs and the grass stand out
  patch: [srgb(0.33, 0.32, 0.40), srgb(0.20, 0.21, 0.35)],    // road repairs
  line: [srgb(0.99, 0.94, 0.85), srgb(0.70, 0.70, 0.85)],
  pebble: [srgb(0.98, 0.94, 0.86), srgb(0.68, 0.69, 0.86)],
  mulch: [srgb(0.66, 0.50, 0.33), srgb(0.38, 0.38, 0.42)],     // warm bark brown in the sun, a muted grey in the shade
  chip: [srgb(0.80, 0.64, 0.44), srgb(0.42, 0.47, 0.48)],      // light bark chips
};

export class Street {
  constructor(sun, beds = []) {
    const material = groundMaterial(sun, beds);
    // Draws first (the sky draws after the opaque scene). Its depth is DEPTH_BIAS behind it, so it can't cover the outline round the feet, but
    // a kerb still hides what is below it on the road.
    this.object = new Mesh(groundGeometry(), material);
    this.object.receiveShadow = true;
    this.object.renderOrder = -1;
    this.object.frustumCulled = false;
  }

  // The heights change only across z, so the mesh follows the camera along x only.
  update(camera) { this.object.position.set(camera.position.x, 0, 0); }
}

// Height of the street at z.
export function streetHeight(z) {
  for (let i = 1; i < PROFILE.length; i++) {
    const [z1, y1] = PROFILE[i];
    if (z < z1) continue;
    const [z0, y0] = PROFILE[i - 1];
    return y1 + (y0 - y1) * (z - z1) / (z0 - z1);
  }
  return PROFILE[PROFILE.length - 1][1];
}

function profile() {
  const { height, gutter, roll, segments } = KERB;
  const out = [[REACH, 0]];
  STRIPS.forEach(([kind, far], i) => {
    const near = i ? STRIPS[i - 1][1] : REACH;
    if (kind === 'road') out.push([near, -height], [far, -height]);
    if (kind === 'path') {
      // d: distance in from the near edge and from the far edge.
      const ds = Array.from({ length: PATH.segments + 1 }, (_, k) => PATH.edge * k / PATH.segments);
      const y = d => PATH.height * smoothstep(0, PATH.edge, d);
      out.push(...ds.map(d => [near - d, y(d)]), ...ds.reverse().map(d => [far + d, y(d)]));
    }
    if (kind !== 'kerb') return;
    // d: distance from the road edge. The road is on the far side or on the near side.
    const fromFar = STRIPS[i + 1]?.[0] === 'road', width = near - far;
    const ds = [0, gutter, ...Array.from({ length: segments }, (_, k) => gutter + roll * (k + 1) / segments), width];
    const y = d => -height * (1 - smoothstep(gutter, gutter + roll, d));
    const points = ds.map(d => [fromFar ? far + d : near - d, y(d)]);
    out.push(...(fromFar ? points.reverse() : points));
  });
  out.push([-REACH, 0]);
  return out.filter((p, i) => i === 0 || p[0] < out[i - 1][0]);
}

// The profile along x, from -REACH to REACH. Smooth normals across the roll. The triangles go from the
// lowest to the highest, so a higher strip draws over the lower one it hides (the road behind a kerb,
// from the top side) where the depth bias is too small to sort them.
function groundGeometry() {
  const position = [], normal = [], quads = [];
  PROFILE.forEach(([z, y], i) => {
    const [za, ya] = PROFILE[Math.max(i - 1, 0)], [zb, yb] = PROFILE[Math.min(i + 1, PROFILE.length - 1)];
    const n = [0, za - zb, yb - ya], len = Math.hypot(n[1], n[2]);
    position.push(-REACH, y, z, REACH, y, z);
    normal.push(0, n[1] / len, n[2] / len, 0, n[1] / len, n[2] / len);
    if (i) quads.push([i, y + PROFILE[i - 1][1]]);
  });
  const index = quads.sort((a, b) => a[1] - b[1]).flatMap(([i]) => {
    const a = 2 * (i - 1), b = 2 * i;
    return [a, a + 1, b, a + 1, b + 1, b];
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  return g;
}

// Footprint on each strip: lit, shade, strength for a dry foot, and lit, shade for a wet one. Dry: on grass
// the foot presses it darker; on the footpath, the kerb and the road it leaves dust (light on the dark road).
// Wet: darker than the surface.
const PRINTS = {
  grass: { lit: srgb(0.50, 0.66, 0.27), shade: srgb(0.21, 0.41, 0.45), alpha: 0.55, wet: [srgb(0.40, 0.56, 0.24), srgb(0.17, 0.34, 0.40)] },
  path: { lit: srgb(0.80, 0.66, 0.55), shade: srgb(0.47, 0.46, 0.66), alpha: 0.5, wet: [srgb(0.70, 0.56, 0.46), srgb(0.42, 0.40, 0.60)] },
  road: { lit: srgb(0.58, 0.55, 0.58), shade: srgb(0.36, 0.36, 0.50), alpha: 0.5, wet: [srgb(0.25, 0.25, 0.33), srgb(0.16, 0.17, 0.29)] },
};
PRINTS.kerb = PRINTS.path;
export const printOn = (x, z) => PRINTS[stripAt(z)];

// The strip kind at z.
export const stripAt = z => STRIPS.find(([, edge]) => z > edge)[0];

// Grass colour uniforms, for the ground and the tufts.
const GRASS_TONES = ['grass', 'grassSun', 'grassDark'];
export function grassUniforms() {
  const uniforms = {};
  for (const name of GRASS_TONES) {
    uniforms[`u_${name}Lit`] = { value: COLOURS[name][0] };
    uniforms[`u_${name}Shade`] = { value: COLOURS[name][1] };
  }
  return uniforms;
}
// GLSL: grassPatches() and grassColour(), the colour of the grass at a ground point, so a tuft's root matches the ground.
// Needs NOISE. Sunny and lush patches with hard toon edges, one pixel wide, warped for a brushed shape.
export const GRASS = /* glsl */`
${GRASS_TONES.map(n => `uniform vec3 u_${n}Lit, u_${n}Shade;`).join('\n')}
// lit: 0 shade to 1 sun. near: patchNear(), 1 near the camera to 0 far away, where the patches are too
// small to read.
// sun, lush: 0 to 1, how much of each patch is at xz. aa: 1 for a pixel-wide edge (fragment shader only),
// 0 for a hard step.
void grassPatches(vec2 xz, float aa, out float sun, out float lush) {
  vec2 g = xz + 1.6 * vec2(noise3(vec3(xz * 0.45, 1.0)), noise3(vec3(xz * 0.45, 2.0)));
  float a = noise3(vec3(g * 0.2, 0.0)), b = noise3(vec3(g * 0.45, 5.0));
  float wa = 1e-4, wb = 1e-4;
#ifdef FRAGMENT   // the fragment shaders define it before this chunk
  wa = max(aa * fwidth(a), 1e-4);
  wb = max(aa * fwidth(b), 1e-4);
#endif
  sun = smoothstep(0.61 - wa, 0.61 + wa, a);
  lush = smoothstep(0.67 - wb, 0.67 + wb, b);
}
float patchNear(vec3 p) { return 1.0 - smoothstep(20.0, 45.0, distance(p, cameraPosition)); }
vec3 grassColour(float sun, float lush, float lit, float near) {
  vec3 col = mix(mix(u_grassShade, u_grassLit, lit), mix(u_grassSunShade, u_grassSunLit, lit), near * sun);
  return mix(col, mix(u_grassDarkShade, u_grassDarkLit, lit), near * lush);
}
`;
// GLSL: tuft(), the shape of a tuft of blades, for the tufts and the painted marks. uv: x -1 to 1 across,
// y 0 to 1 up, units of the tuft height.
export const BLADES = /* glsl */`
float bladeRnd(float n, float s) { return fract(sin(n * 91.345 + s * 317.17) * 43758.5453); }
// Leaf blade from (b, 0), turned out by angle a (radians from up), length len, widest w, bent by bend.
// Narrow at the base, wide in the middle, a round point at the tip. + inside, uv units. across: -1 to 1
// from one side of the blade to the other.
float blade(vec2 p, float b, float a, float len, float w, float bend, out float across) {
  vec2 q = p - vec2(b, 0.0);
  vec2 dir = vec2(sin(a), cos(a));
  float along = dot(q, dir), x = q.x * dir.y - q.y * dir.x;
  float t = along / len;
  x -= bend * t * t * len;
  float width = w * 1.9 * pow(clamp(t, 0.0, 1.0), 0.35) * pow(clamp(1.0 - t, 0.0, 1.0), 0.6);
  across = x / max(width, 1e-4);
  return min(width - abs(x), min(t, 1.0 - t) * len);
}
// Tuft of blades, seed s. leafy: 0 many thin grass blades to 1 a few wide leaves. Outer blades first, the
// centre blade last, so it is in front. Returns the distance to the tuft, + inside. across: of the front
// blade at p.
float tuft(vec2 p, float s, float leafy, out float across) {
  int n = int(mix(5.0, 2.0, leafy) + bladeRnd(1.0, s) * 2.99);
  float dist = -1e3;
  across = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= n) break;
    float fi = float(i), k = fi / max(float(n - 1), 1.0);
    float side = (1.0 - k) * (i % 2 == 0 ? -1.0 : 1.0) + 0.15 * (bladeRnd(fi + 3.0, s) - 0.5);
    float len = (1.0 - 0.4 * abs(side)) * mix(0.75, 1.0, bladeRnd(fi + 10.0, s));
    float w = mix(0.05, 0.17, leafy) * mix(0.8, 1.1, bladeRnd(fi + 20.0, s));
    float ac, d = blade(p, side * mix(0.25, 0.18, leafy), side * 0.42, len, w, side * 0.12, ac);
    if (d > 0.0 || d > dist) across = ac;
    dist = max(dist, d);
  }
  return dist;
}
`;

// Is a world point in the inner part of a mulch bed (MULCH.clear of the radius), or within margin of it?
export const inBed = (beds, x, z, margin = 0) => beds.some(({ at, radius }) => Math.hypot(x - at[0], z - at[1]) < radius * MULCH.clear + margin);

// Is a world point in the play area?
export const inPlay = (x, z) => x >= PLAY.x[0] && x <= PLAY.x[1] && z >= PLAY.z[0] && z <= PLAY.z[1];

function groundMaterial(sun, beds) {
  // Each bed: x, z, radius (0: none), seed.
  const uBeds = Array.from({ length: MULCH.max }, (_, i) => {
    const b = beds[i];
    return b ? new Vector4(b.at[0], b.at[1], b.radius, i * 7.3) : new Vector4();
  });
  if (beds.length > MULCH.max) console.warn(`Street: only ${MULCH.max} mulch beds`);
  const uniforms = { ...lightUniforms(), ...grassUniforms(), uHaze: haze, uSun: { value: sun }, uBeds: { value: uBeds } };
  const other = Object.keys(COLOURS).filter(n => !GRASS_TONES.includes(n));
  for (const name of other) {
    const [lit, shade] = COLOURS[name];
    uniforms[`u_${name}Lit`] = { value: lit };
    uniforms[`u_${name}Shade`] = { value: shade };
  }
  const tone = name => `mix(u_${name}Shade, u_${name}Lit, lit)`;
  // One mix for each strip edge, a pixel wide, from the near side.
  const strips = STRIPS.slice(1).map(([kind], i) => `
    col = mix(col, ${kind}, smoothstep(-w, w, ${f(STRIPS[i][1])} - z));`).join('');
  return new ShaderMaterial({
    lights: true,
    uniforms,
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      varying vec3 vWorld, vNormal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, normal);
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      ${NOISE}
      #define FRAGMENT
      ${GRASS}
      ${BLADES}
      ${other.map(n => `uniform vec3 u_${n}Lit, u_${n}Shade;`).join('\n')}
      uniform vec3 uHaze, uSun;
      uniform vec4 uBeds[${MULCH.max}];
      uniform mat4 projectionMatrix;
      varying vec3 vWorld, vNormal;
      // 1 on a line of width (units) at u = 0, with w (one pixel, units) of blur.
      float line(float u, float width, float w) {
        w = max(w, 1e-5);
        return 1.0 - smoothstep(width / 2.0 - w, width / 2.0 + w, abs(u));
      }
      // The same, a pixel of blur at any distance. Not for a u that wraps: its fwidth jumps there.
      float line(float u, float width) { return line(u, width, fwidth(u)); }
      float hash12(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
      // Frame for things drawn upright to the camera on the ground (marks, pebbles): side and away (from
      // the camera) along the ground, and stretch, which scales a ground distance away from the camera to
      // the height it would have upright. At a low view the stretch is clamped, so these things get
      // shorter and stay inside half a cell: 2 by 2 cells do. px: one pixel in the upright frame. Made in
      // main(), outside any branch, for fwidth().
      struct Upright { vec2 side, away; float stretch, px; };
      Upright upright(vec3 p) {
        vec3 v = normalize(cameraPosition - p);
        Upright u;
        u.away = -normalize(v.xz + 1e-5);
        u.side = vec2(-u.away.y, u.away.x);
        u.stretch = max(v.y, 0.3) / max(length(v.xz), 0.3);
        vec2 f = vec2(dot(p.xz, u.side), dot(p.xz, u.away) * u.stretch);
        u.px = max(max(fwidth(f.x), fwidth(f.y)), 1e-5);
        return u;
      }
      // Distance across a kerb from its road edge, or -1 off the kerbs.
      float kerbFromRoad(float z) {
        ${STRIPS.map(([kind, far], i) => kind !== 'kerb' ? '' : `if (z < ${f(STRIPS[i - 1][1])} && z > ${f(far)}) return ${STRIPS[i + 1]?.[0] === 'road' ? `z - ${f(far)}` : `${f(STRIPS[i - 1][1])} - z`};`).filter(Boolean).join('\n        ')}
        return -1.0;
      }
      // Distance outside the nearest footpath (less than 0 on it).
      float pathOut(float z) {
        float d = 1e3;
        ${STRIPS.map(([kind, far], i) => kind !== 'path' ? '' : `d = min(d, max(z - ${f(STRIPS[i - 1][1])}, ${f(far)} - z));`).filter(Boolean).join('\n        ')}
        return d;
      }
      float edgeDistance(float z) {
        float edge = 1e3;
        ${STRIPS.slice(0, -1).map(([, z]) => `edge = min(edge, abs(z - ${f(z)}));`).join('\n        ')}
        return edge;
      }
      // Painted marks: a small tuft in some cells, upright to the camera. Returns the cover, 0 to 1, and
      // in light 0 for a dark mark, 1 for a light one.
      float grassMarks(vec3 p, Upright u, out float light) {
        // The roots are 0.2 to 0.8 across a cell: test the cell and its neighbours on the near sides.
        vec2 cell = floor(p.xz / ${f(MARKS.cell)} - 0.5);
        float cover = 0.0;
        light = 0.0;
        for (int i = 0; i <= 1; i++) for (int j = 0; j <= 1; j++) {
          vec2 c = cell + vec2(i, j);
          if (hash12(c) > ${f(MARKS.chance)}) continue;
          vec2 root = (c + 0.2 + 0.6 * vec2(hash12(c + 7.1), hash12(c + 3.3))) * ${f(MARKS.cell)};
          float size = mix(${f(MARKS.size[0])}, ${f(MARKS.size[1])}, hash12(c + 1.9));
          vec2 d = p.xz - root;
          vec2 uv = vec2(dot(d, u.side), dot(d, u.away) * u.stretch) / size;
          if (abs(uv.x) > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
          float ac, s = hash12(c + 5.7);
          float m = smoothstep(-0.5, 0.5, tuft(uv, s, 0.4 * hash12(c + 8.2), ac) * size / u.px);
          if (m > cover) { cover = m; light = step(0.5, hash12(c + 4.4)); }
        }
        return cover;
      }
      // Pebbles: round mounds in some cells near the strip edges, upright to the camera as the marks: a
      // light top, a cool shaded underside and a small contact shadow. More of them nearer an edge.
      vec3 pebbles(vec3 p, Upright u, vec3 col, float lit) {
        vec3 peb = ${tone('pebble')};
        vec2 cell = floor(p.xz / ${f(PEBBLES.cell)} - 0.5);
        for (int i = 0; i <= 1; i++) for (int j = 0; j <= 1; j++) {
          vec2 c = cell + vec2(i, j);
          vec2 root = (c + 0.2 + 0.6 * vec2(hash12(c + 2.7), hash12(c + 6.1))) * ${f(PEBBLES.cell)};
          if (hash12(c + 11.3) > ${f(PEBBLES.chance)} * (1.0 - edgeDistance(root.y) / ${f(PEBBLES.band)})) continue;
          float r = mix(${f(PEBBLES.radius[0])}, ${f(PEBBLES.radius[1])}, hash12(c + 9.4) * hash12(c + 3.9));
          vec2 d = p.xz - root, q = vec2(dot(d, u.side), dot(d, u.away) * u.stretch) / r;
          float e = length(vec2(q.x, (q.y - 0.25) / mix(0.45, 0.65, hash12(c + 4.8))));
          float shadow = length(vec2(q.x / 1.2, (q.y + 0.05) / 0.35));
          float aa = u.px / r;
          col = mix(col, col * vec3(0.80, 0.86, 0.95), 1.0 - smoothstep(1.0 - aa, 1.0 + aa, shadow));
          vec3 pc = mix(peb * vec3(0.76, 0.79, 0.95), peb, smoothstep(0.12 - aa, 0.12 + aa, q.y));
          col = mix(col, pc, 1.0 - smoothstep(1.0 - aa, 1.0 + aa, e));
        }
        return col;
      }
      // Mulch: + inside a patch, - in the grass, about units of distance (for a pixel-wide edge). A patch
      // noise less a fall off from the trunk: full near it, small patches toward the edge, none past
      // MULCH.reach of the radius. Each bed has its own noise, so no two are the same.
      float mulchIn(vec2 xz) {
        float d = -1e3;
        for (int i = 0; i < ${MULCH.max}; i++) {
          vec4 b = uBeds[i];
          if (b.z == 0.0) continue;
          float t = distance(xz, b.xy) / b.z;
          if (t > ${f(MULCH.reach)}) continue;
          float n = noise3(vec3(xz * ${f(MULCH.patch)}, b.w)) * 0.7 + noise3(vec3(xz * ${f(MULCH.patch * 2.7)}, b.w + 3.0)) * 0.3;
          d = max(d, (${f(MULCH.reach)} - t - 0.9 * n) / (1.0 / b.z + ${f(MULCH.patch)}));
        }
        return d;
      }
      // Bark chips: a short flat sliver in some cells, at a random turn, lighter or darker than the bed.
      vec3 mulchChips(vec2 xz, vec3 col, vec3 chip, float px) {
        vec2 c = floor(xz / ${f(MULCH.chip)});
        if (hash12(c + 21.7) > ${f(MULCH.chance)}) return col;
        vec2 root = (c + 0.3 + 0.4 * vec2(hash12(c + 1.3), hash12(c + 5.9))) * ${f(MULCH.chip)};
        float a = hash12(c + 8.8) * 3.1416, len = mix(0.06, 0.09, hash12(c + 2.2));
        vec2 d = xz - root, q = vec2(dot(d, vec2(cos(a), sin(a))), dot(d, vec2(-sin(a), cos(a))));
        float e = length(q / vec2(len, len * 0.35)) - 1.0;
        float m = 1.0 - smoothstep(-px / len, px / len, e);
        return mix(col, hash12(c + 4.1) < 0.6 ? chip : col * vec3(0.86, 0.86, 0.90), 0.7 * m);
      }
      // Cracks: in some slabs, a cartoon crack: three straight strokes in a zigzag from one side of the
      // path. s: the point in the slab, 0 to ${JOINT} across the slab and the path. px: world units for each
      // pixel.
      float segment(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
      }
      float cracks(vec3 p, float near, float px) {
        float slab = floor(p.x / ${f(JOINT)});
        vec2 id = vec2(slab, near);
        if (hash12(id) > ${f(CRACKS.chance)}) return 0.0;
        vec2 s = vec2(p.x - slab * ${f(JOINT)}, near - p.z);
        if (hash12(id + 1.7) < 0.5) s.y = ${f(JOINT)} - s.y;
        float x = mix(0.6, 2.4, hash12(id + 2.3)), len = mix(0.8, 1.6, hash12(id + 4.9)), k = hash12(id + 3.1) < 0.5 ? -1.0 : 1.0;
        vec2 a = vec2(x, 0.0), b = vec2(x + 0.12 * k, len * 0.4), c = vec2(x - 0.02 * k, len * 0.7), e = vec2(x + 0.14 * k, len);
        float d = min(segment(s, a, b), min(segment(s, b, c), segment(s, c, e)));
        float w = ${f(CRACKS.width / 2)};
        return 1.0 - smoothstep(w - px, w + px, d);
      }
      void main() {
        vec3 p = vWorld;
        float z = p.z, w = max(fwidth(z), 1e-4), px = max(fwidth(p.x), fwidth(p.z));
        // Grass: sunny and lush patches on the base green, and painted marks near the camera.
        float near = patchNear(p);
        // Footpath slabs: each slab end drops to its joint with a bevel. The bevel tilts the normal
        // toward the joint, so the end that faces the sun lights up and the other end takes the form
        // tone. Only near the camera: far away a bevel is less than a pixel.
        float jx = (fract(p.x / ${f(JOINT)} + 0.5) - 0.5) * ${f(JOINT)};
        float bevel = step(pathOut(z), 0.0) * near * (1.0 - smoothstep(${f(PATH.bevel)} - px, ${f(PATH.bevel)} + px, abs(jx)));
        vec3 n = normalize(normalize(vNormal) - vec3(sign(jx) * ${f(PATH.slope)} * bevel, 0.0, 0.0));
        vec2 lamp = lampLight(n);
        float lit = max(toonBand(n, uSun), lamp.x);
        // Only near a grass strip: the patches and the marks are most of the cost of the ground. The margin
        // is wide, so where the branch ends the grass has no weight in the colour.
        bool onGrass = ${STRIPS.map(([kind, z], i) => kind !== 'grass' ? null : `(${z === -Infinity ? 'true' : `z > ${f(z - 0.5)}`}${i ? ` && z < ${f(STRIPS[i - 1][1] + 0.5)}` : ''})`).filter(Boolean).join(' || ')};
        Upright u = upright(p);
        vec3 grass = vec3(0.0);
        if (onGrass) {
          float sun, lush, light = 0.0, mark = 0.0;
          grassPatches(p.xz, 1.0, sun, lush);
          grass = grassColour(sun, lush, lit, near);
          if (near > 0.0) mark = near * grassMarks(p, u, light);
          vec3 markCol = light > 0.5 ? mix(grass, mix(u_grassSunShade, u_grassSunLit, lit) * vec3(1.06, 1.06, 0.92), 0.7) : grass * vec3(0.84, 0.91, 0.88);
          grass = mix(grass, markCol, mark);
          // Mulch round the trees: patches with a hard toon edge, tinted over the grass so they blend, and chips.
          float mi = mulchIn(p.xz);
          if (mi > -px) {
            vec3 mulch = mix(grass, ${tone('mulch')}, ${f(MULCH.tint)});
            if (near > 0.0) mulch = mix(mulch, mulchChips(p.xz, mulch, mix(grass, ${tone('chip')}, ${f(MULCH.tint)}), px), near);
            grass = mix(grass, mulch, smoothstep(-px, px, mi));
          }
        }
        // Footpath: concrete slabs, with joints across. The bevel that faces the sun is a little lighter.
        vec3 path = mix(${tone('path')}, ${tone('joint')}, line(jx, 0.05, fwidth(p.x)));
        path *= mix(1.0, 1.07, smoothstep(0.1, 0.25, dot(n.xz, normalize(uSun.xz))));
        // Kerb: a rolled kerb.
        vec3 kerb = ${tone('kerb')};
        // Road: patches of repair, and the dashed centre line. The noise runs only near the road.
        vec3 road = ${tone('road')};
        if (${STRIPS.map(([kind, z], i) => kind !== 'road' ? null : `z < ${f(STRIPS[i - 1][1] + 0.5)} && z > ${f(z - 0.5)}`).filter(Boolean).join(' || ')}) {
          road = mix(road, ${tone('patch')}, smoothstep(0.70, 0.74, noise3(vec3(p.xz * vec2(0.08, 0.25), 9.0))));
        }
        float dx = mod(p.x, ${f(ROAD.dash[0] + ROAD.dash[1])}) - ${f(ROAD.dash[0] / 2)};
        road = mix(road, ${tone('line')}, line(z - ${f(ROAD.centre)}, ${f(ROAD.dashWidth)}) * line(dx, ${f(ROAD.dash[0])}, fwidth(p.x)));
        vec3 col = grass;
        ${strips}
        // A thin line on each strip edge.
        float e = 0.0;
        ${STRIPS.slice(0, -1).map(([, z]) => `e = max(e, line(z - ${f(z)}, 0.04));`).join('\n        ')}
        col = mix(col, ${tone('joint')}, e);
        // Kerb: a cool contact shade in the gutter at the foot of the roll, and a dark line on the lip, so
        // the drop reads from the top side too, where the roll is out of view.
        float kd = kerbFromRoad(z);
        col = mix(col, col * vec3(0.78, 0.80, 0.95), line(kd - ${f(KERB.gutter - KERB.contact / 2)}, ${f(KERB.contact)}));
        col = mix(col, ${tone('joint')} * 0.7, line(kd - ${f(KERB.gutter + KERB.roll)}, ${f(KERB.lip)}));
        // Footpath: a cool contact shade on the grass at the foot of each edge.
        col = mix(col, col * vec3(0.80, 0.84, 0.95), line(pathOut(z) - ${f(PATH.contact / 2)}, ${f(PATH.contact)}));
        // Form: a slope that turns from the sun (the roll of a kerb that faces it away) gets a cool tone.
        float ndl = dot(n, uSun), fw = 0.5 * max(fwidth(ndl), 1e-5);
        float form = 1.0 - smoothstep(${f(FORM)} - fw, ${f(FORM)} + fw, ndl);
        col *= mix(vec3(1.0), vec3(0.84, 0.85, 0.97), form);
        // Footpath: the round side of a slab that turns from the sun is darker concrete, not the cool shade.
        float po = pathOut(z);
        col = mix(col, ${tone('pathSide')}, form * step(po, 0.0) * step(${f(-PATH.edge)}, po));
        // Cracks on the footpath slabs, pebbles near the strip edges. Only near the camera: far away they
        // are too small to read.
        if (near > 0.0) {
          float pathNear = ${STRIPS.map(([kind, z], i) => kind === 'path' ? `z < ${f(STRIPS[i - 1][1])} && z > ${f(z)} ? ${f(STRIPS[i - 1][1])} : ` : '').join('')}1e3;
          if (pathNear < 1e3) col = mix(col, ${tone('joint')} * 0.9, near * cracks(p, pathNear, px));
          // Not on the kerbs and the road: pale dots there read as road marks.
          bool hard = ${STRIPS.map(([kind, z], i) => (kind === 'kerb' || kind === 'road') ? `(z < ${f(STRIPS[i - 1][1])} && z > ${f(z)})` : null).filter(Boolean).join(' || ')};
          if (!hard && edgeDistance(z) < ${f(PEBBLES.band + PEBBLES.cell / 2)}) col = mix(col, pebbles(p, u, col, lit), near);
        }
        col = night(col, lamp);
        col = mix(col, uHaze, smoothstep(${f(HAZE_FROM[0])}, ${f(HAZE_FROM[1])}, distance(p, cameraPosition)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        // Depth a little behind the ground along the view ray. For each pixel: the triangles are too
        // large to move their corners. The ground draws first, so it loses no early depth test.
        vec4 clip = projectionMatrix * viewMatrix * vec4(p + normalize(p - cameraPosition) * ${f(DEPTH_BIAS)}, 1.0);
        gl_FragDepth = 0.5 + 0.5 * clip.z / clip.w;
      }`,
  });
}
