// Backdrop: rings of tree silhouettes round the street, so the world ends a short way past the yards and
// not at a far horizon. Each ring is a band of upright quads along a rounded box, with a shader that
// cuts a bumpy canopy line and shades the clumps: lit on top, cool below. The far ring is taller and
// more in the haze. Soft edges, as if out of focus.
//
//   const backdrop = new Backdrop(bounds);   // bounds: the level's { x, z }
//   scene.add(backdrop.object);
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, ShaderMaterial } from 'three';
import { NOISE } from '../ibis/materials.js';
import { LIGHT } from './lighting.js';
import { COLOURS as SKY_COLOURS, NIGHT_COLOURS } from './sky.js';
import { srgb, f } from './util.js';

const SKY = SKY_COLOURS.horizon;   // far things fade toward it
const SKY_NIGHT = NIGHT_COLOURS.horizon;
const DARK = srgb(0.30, 0.36, 0.52);   // night multiply

// out: distance past the level bounds: along x, at -z, at +z. height: [base, bumps] of the canopy line: big, slow
// bumps for the crowns. clump: width of the round leaf clumps on top. haze: 0 to 1.
export const RINGS = [
  { out: [54, 33.5, 33.5], height: [5, 4], clump: 5, freq: 0.05, lit: srgb(0.56, 0.71, 0.60), shade: srgb(0.46, 0.62, 0.62), haze: 0.45, seed: 7 },
  { out: [38, 15.5, 21.5], height: [2.5, 4.5], clump: 3.5, freq: 0.08, lit: srgb(0.58, 0.74, 0.44), shade: srgb(0.36, 0.56, 0.47), haze: 0.15, seed: 3 },
];
const CORNER = 14;       // corner radius of the ring
const STEP = 1.0;        // quad width along the ring

export class Backdrop {
  constructor({ x: [x0, x1], z: [z0, z1] }) {
    this.object = new Group();
    RINGS.forEach((ring, i) => {
      // Top of the quads: the highest the canopy line can go, plus the soft edge.
      const top = ring.height[0] + ring.height[1] + ring.clump * 0.45 + 0.5;
      const [ox, far, near] = ring.out;
      const mesh = new Mesh(ringGeometry([x0 - ox, x1 + ox, z0 - far, z1 + near], top), ringMaterial(ring));
      mesh.frustumCulled = false;
      mesh.renderOrder = i;   // after the opaque scene, far ring first
      this.object.add(mesh);
    });
  }
}

// Upright band along a rounded box, with aU: distance along the ring.
function ringGeometry([x0, x1, z0, z1], top) {
  const path = [];
  const corners = [[x1 - CORNER, z1 - CORNER, 0], [x0 + CORNER, z1 - CORNER, 1], [x0 + CORNER, z0 + CORNER, 2], [x1 - CORNER, z0 + CORNER, 3]];
  for (const [cx, cz, q] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = (q + i / 8) * Math.PI / 2;
      path.push([cx + Math.cos(a) * CORNER, cz + Math.sin(a) * CORNER]);
    }
  }
  path.push(path[0]);
  const pos = [], u = [], index = [];
  let along = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / STEP));
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n, len = Math.hypot(bx - ax, bz - az) / n;
      const p = [ax + (bx - ax) * t0, az + (bz - az) * t0], q = [ax + (bx - ax) * t1, az + (bz - az) * t1];
      const k = pos.length / 3;
      pos.push(p[0], -0.5, p[1], q[0], -0.5, q[1], q[0], top, q[1], p[0], top, p[1]);
      u.push(along, along + len, along + len, along);
      index.push(k, k + 1, k + 2, k, k + 2, k + 3);
      along += len;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aU', new Float32BufferAttribute(u, 1));
  g.setIndex(index);
  return g;
}

function ringMaterial({ height: [base, bumps], clump, freq, lit, shade, haze, seed }) {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, side: 2,
    uniforms: {
      uLit: { value: lit.clone().lerp(SKY, haze) }, uShade: { value: shade.clone().lerp(SKY, haze) }, uNight: LIGHT.night,
      uLitNight: { value: lit.clone().multiply(DARK).lerp(SKY_NIGHT, haze) }, uShadeNight: { value: shade.clone().multiply(DARK).lerp(SKY_NIGHT, haze) },
    },
    vertexShader: /* glsl */`
      attribute float aU;
      varying float vU, vY;
      void main() {
        vU = aU;
        vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${NOISE}
      uniform vec3 uLit, uShade, uLitNight, uShadeNight;
      uniform float uNight;
      varying float vU, vY;
      float n1(float x, float s) { return noise3(vec3(x, s, 0.0)); }
      // Round bumps of about width w along x, each a half circle of a size from noise.
      float clumps(float x, float w, float s) {
        float i = floor(x / w), t = fract(x / w) * 2.0 - 1.0;
        float size = 0.5 + 0.5 * fract(sin((i + s) * 12.9898) * 43758.5453);
        return size * w * 0.45 * sqrt(max(1.0 - t * t, 0.0));
      }
      void main() {
        // Canopy line: big crowns and gaps, then round leaf clumps at two sizes on top.
        float h = ${f(base)} + ${f(bumps)} * pow(n1(vU * ${f(freq)}, ${f(seed)}), 1.4)
          + max(clumps(vU, ${f(clump)}, ${f(seed)}), clumps(vU + ${f(clump * 0.5)}, ${f(clump * 0.6)}, ${f(seed + 9)}));
        float soft = 0.25 + fwidth(vY);
        float a = smoothstep(h + soft, h - soft, vY);
        if (a < 0.01) discard;
        // Clumps: lit on top, cool below, with a broken edge between them.
        float clump = h - 1.6 - 1.2 * n1(vU * 0.3, ${f(seed + 2)}) - 0.8 * noise3(vec3(vU * 0.6, vY * 0.6, ${f(seed + 3)}));
        float t = smoothstep(clump - soft, clump + soft, vY);
        vec3 col = mix(mix(uShade, uLit, t), mix(uShadeNight, uLitNight, t), uNight);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
}
