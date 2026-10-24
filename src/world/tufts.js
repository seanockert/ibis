// Grass tufts: one family, from thin grass blades to a few wide leaves. The root takes the colour of the
// ground under it (grassColour() in street.js), so it melts into the grass. Above the root the tuft is one
// flat green, and a cooler one in the sun's shadow. The wind moves them in slow waves, and they bend away from the birds.
// One instanced draw of upright quads that turn to the camera about y. The shader cuts the blades.
// Placed by rules: clusters where a noise is high (one big tuft and small ones round it), and runs along
// the edges of the footpaths and kerbs, and long grass round the fence posts. Far tufts shrink to nothing, so they don't shimmer. A tuft is
// no taller than its distance to the nearest prop, so the grass doesn't go through a box on it.
//
//   const tufts = new Tufts();
//   scene.add(tufts.object);
//   tufts.update(camera, dt, ibises, solids);   // every frame. solids: [{ body, half, round }] from the props
import { InstancedBufferAttribute, InstancedBufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { lightUniforms, NOISE, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { hash } from '../ibis/motion/spring.js';
import { fencePosts } from './fence.js';
import { inPuddle, PUDDLE } from './puddle.js';
import { BLADES, GRASS, grassUniforms, JOINT, streetHeight, stripAt, STRIPS } from './street.js';
import { srgb, f } from './util.js';


export const TUFTS = {
  area: { x: [-84, 84], z: [-40, 20] },   // where the clusters go: past the play area by more than the fade
  tries: 1575,             // cluster tries: the density noise and the strips drop most of them
  density: 0.09,           // frequency of the density noise: clusters gather where it is high
  spread: [0.35, 0.9],     // distance of the small tufts from the big one
  joints: 0.3,             // part of the footpath joints with a small tuft
  edgeStep: 0.7,
  posts: { count: [4, 7], size: [0.55, 0.95], ring: [0.1, 0.45] },   // long thin grass round each fence post           // spacing of the tufts along a strip edge, where the noise lets them grow
  size: [0.18, 0.38],      // height of the big tuft, units (the bird is 2). Small ones are 0.4 to 0.75 of it
  fade: [26, 38],          // distance from the camera where tufts shrink to nothing
  wind: { dir: [0.8, 0.6], speed: 1.4, wave: 0.35, bend: 0.12 },   // wave: crests per unit; bend: of the height
  push: { radius: 0.9, bend: 0.7 },     // the birds push tufts aside
  seed: 11,
};
const MAX_BIRDS = 4;
const MAX_SOLIDS = 32;   // props' boxes: the ball, the bin and its lid, the boxes and flaps, cereal, stubbies
const TIP = srgb(0.86, 0.90, 0.50);     // the lit side moves toward this warm light green

export class Tufts {
  constructor() {
    const tufts = place();
    const g = new InstancedBufferGeometry();
    // Upright quad: x -1 to 1, y 0 to 1.1.
    g.setAttribute('position', new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1.1, 0, -1, 1.1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aTuft', new InstancedBufferAttribute(new Float32Array(tufts.flatMap(t => t.slice(0, 4))), 4));
    g.setAttribute('aLeafy', new InstancedBufferAttribute(new Float32Array(tufts.map(t => t[4])), 1));
    g.setAttribute('aGround', new InstancedBufferAttribute(new Float32Array(tufts.map(t => streetHeight(t[1]))), 1));   // the joints are on the raised footpath
    g.instanceCount = tufts.length;
    this.material = tuftMaterial();
    this.object = new Mesh(g, this.material);
    this.object.receiveShadow = true;
    this.object.frustumCulled = false;
    this.count = tufts.length;
  }

  update(camera, dt = 0, birds = [], solids = []) {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uBirds.value.forEach((v, i) => {
      const p = birds[i]?.object.position;
      v.set(p?.x ?? 0, p?.z ?? 0, p ? 1 : 0, 0);
    });
    // Each solid: its middle (w: 1 on), its turn, and its half size (w: 1 round).
    for (let i = 0; i < MAX_SOLIDS; i++) {
      const s = solids[i], at = u.uSolidAt.value[i];
      if (!s) { at.w = 0; continue; }
      at.set(...s.body.position, 1);
      u.uSolidQ.value[i].fromArray(s.body.quaternion);
      u.uSolidHalf.value[i].set(...s.half, s.round ? 1 : 0);
    }
  }
}

// Smooth value noise, 0 to 1, from hash().
function noise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const h = (i, j) => hash(Math.imul(ix + i, 73856093) ^ Math.imul(iz + j, 19349663) ^ seed);
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h(0, 0) + (h(1, 0) - h(0, 0)) * sx, b = h(0, 1) + (h(1, 1) - h(0, 1)) * sx;
  return a + (b - a) * sz;
}

// [x, z, height, seed, leafy] for each tuft.
function place() {
  const { area, tries, density, spread, edgeStep, size, seed } = TUFTS;
  let n = seed * 7919;
  const r = () => hash(n++);
  const out = [];
  const onGrass = z => stripAt(z) === 'grass' && stripAt(z + 0.25) === 'grass' && stripAt(z - 0.25) === 'grass';
  // None in the puddle or on its mud bank. The seed is taken first, so the other tufts don't move.
  const add = (x, z, h, leafy) => {
    const tuft = [x, z, h, r(), Math.min(Math.max(leafy, 0), 1)];
    if (!inPuddle(x, z, PUDDLE.bank + 0.1)) out.push(tuft);
  };
  // Clusters: one big tuft and 1 to 4 small ones round it, all of one kind (leafy), where the noise is high.
  for (let i = 0; i < tries; i++) {
    const cx = area.x[0] + (area.x[1] - area.x[0]) * r(), cz = area.z[0] + (area.z[1] - area.z[0]) * r();
    const d = noise2(cx * density, cz * density, seed);
    if (r() > (d - 0.45) * 3 || !onGrass(cz)) continue;
    const big = size[0] + (size[1] - size[0]) * r(), leafy = r();
    add(cx, cz, big, leafy);
    const count = 1 + Math.floor(r() * 4);
    for (let j = 0; j < count; j++) {
      const a = r() * 2 * Math.PI, dist = spread[0] + (spread[1] - spread[0]) * r();
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      if (onGrass(z)) add(x, z, big * (0.4 + 0.35 * r()), leafy + 0.3 * (r() - 0.5));
    }
  }
  // Runs along each edge between grass and a hard strip, on the grass side, with gaps from the noise.
  for (let i = 0; i < STRIPS.length - 1; i++) {
    const edge = STRIPS[i][1], near = STRIPS[i][0], far = STRIPS[i + 1][0];
    if ((near === 'grass') === (far === 'grass')) continue;
    const side = near === 'grass' ? 1 : -1;   // the near strip is at larger z
    for (let x = area.x[0]; x < area.x[1]; x += edgeStep) {
      const d = noise2(x * 0.25, edge, seed + 1);
      if (r() > (d - 0.4) * 2.5) continue;
      add(x + edgeStep * r(), edge + side * (0.08 + 0.15 * r()), size[0] + (size[1] - size[0]) * 0.6 * r(), 0.3 * r());
    }
  }
  // Small thin tufts in some joints of the footpath slabs.
  for (let i = 1; i < STRIPS.length; i++) {
    if (STRIPS[i][0] !== 'path') continue;
    const [far, near] = [STRIPS[i][1], STRIPS[i - 1][1]];
    for (let x = Math.ceil(area.x[0] / JOINT) * JOINT; x < area.x[1]; x += JOINT) {
      if (r() > TUFTS.joints) continue;
      add(x + 0.03 * (r() - 0.5), far + 0.3 + (near - far - 0.6) * r(), size[0] * (0.6 + 0.5 * r()), 0.15 * r());
    }
  }
  // Long thin grass round the foot of each fence post, where the mower can't reach. Each side of the
  // post along the fence, and behind it in the yard. Not on the footpath.
  const { count, size: tall, ring } = TUFTS.posts;
  for (const post of fencePosts()) {
    const yard = stripAt(post.z + 0.3) === 'grass' ? 1 : -1;
    const n = count[0] + Math.floor(r() * (count[1] - count[0] + 1));
    for (let j = 0; j < n; j++) {
      const x = post.x + (r() < 0.5 ? -1 : 1) * (ring[0] + (ring[1] - ring[0]) * r());
      // Half in the thin grass in front of the fence line, half behind it.
      const z = post.z + yard * (r() < 0.5 ? -0.09 * r() : 0.3 * r());
      if (stripAt(z) === 'grass') add(x, z, tall[0] + (tall[1] - tall[0]) * r(), 0.2 * r());
    }
  }
  return out;
}

function tuftMaterial() {
  const { wind, push } = TUFTS;
  const dir = new Vector3(wind.dir[0], 0, wind.dir[1]).normalize();
  return new ShaderMaterial({
    lights: true,
    alphaToCoverage: true,   // soft edges with the multisampled target in grade.js, no sorting
    side: 2,
    uniforms: {
      ...lightUniforms(), ...grassUniforms(),
      uTip: { value: TIP }, uTime: { value: 0 },
      uBirds: { value: Array.from({ length: MAX_BIRDS }, () => new Vector4()) },   // x, z, on
      uSolidAt: { value: Array.from({ length: MAX_SOLIDS }, () => new Vector4()) },
      uSolidQ: { value: Array.from({ length: MAX_SOLIDS }, () => new Vector4(0, 0, 0, 1)) },
      uSolidHalf: { value: Array.from({ length: MAX_SOLIDS }, () => new Vector4()) },
    },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      ${NOISE}
      ${GRASS}
      attribute vec4 aTuft;
      attribute float aLeafy, aGround;
      uniform float uTime;
      uniform vec4 uBirds[${MAX_BIRDS}];
      uniform vec4 uSolidAt[${MAX_SOLIDS}], uSolidQ[${MAX_SOLIDS}], uSolidHalf[${MAX_SOLIDS}];
      varying vec2 vUv, vPatch;
      varying float vSeed, vLeafy, vX, vNear;
      varying vec3 vRight;
      void main() {
        vec3 base = vec3(aTuft.x, aGround, aTuft.y);
        float h = aTuft.z * (1.0 - smoothstep(${f(TUFTS.fade[0])}, ${f(TUFTS.fade[1])}, distance(base, cameraPosition)));
        // Props: the tuft is no taller than the distance from its root to the nearest one (its blades
        // spread about as wide as it is tall), so none goes into a box, and none shows under one.
        for (int i = 0; i < ${MAX_SOLIDS}; i++) {
          if (uSolidAt[i].w == 0.0) continue;
          vec4 q = uSolidQ[i];
          vec3 v = base + vec3(0.0, 0.02, 0.0) - uSolidAt[i].xyz;
          vec3 p = v - 2.0 * cross(q.xyz, -cross(q.xyz, v) + q.w * v);   // into the solid's space: the inverse turn
          vec3 half_ = uSolidHalf[i].xyz;
          vec3 e = abs(p) - half_;
          float d = uSolidHalf[i].w > 0.5
            ? (length(p / half_) - 1.0) * min(half_.x, min(half_.y, half_.z))
            : length(max(e, 0.0)) + min(max(e.x, max(e.y, e.z)), 0.0);
          h = min(h, max(d * 1.2, 0.0));
        }
        // Turn to the camera about y: the camera's right vector, flat.
        vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]) + 1e-5);
        // Wind: slow waves across the lawn, and a small flutter of each tuft. The birds push tufts aside.
        float y = position.y * position.y;
        vec2 dir = vec2(${f(dir.x)}, ${f(dir.z)});
        float wave = sin(dot(base.xz, dir) * ${f(wind.wave * 2 * Math.PI)} - uTime * ${f(wind.speed)});
        vec2 bend = dir * (${f(wind.bend)} * (0.6 + 0.4 * wave) + 0.03 * sin(uTime * 3.1 + aTuft.w * 40.0));
        for (int i = 0; i < ${MAX_BIRDS}; i++) {
          vec2 d = base.xz - uBirds[i].xy;
          float k = uBirds[i].z * (1.0 - smoothstep(0.2, ${f(push.radius)}, length(d)));
          bend += normalize(d + 1e-4) * k * ${f(push.bend)};
        }
        vec3 offset = right * position.x * h + vec3(bend.x * h * y, position.y * h * (1.0 - 0.3 * dot(bend, bend)), bend.y * h * y);
        vec4 world = vec4(base + offset, 1.0);
        vUv = vec2(position.x * (fract(aTuft.w * 13.7) < 0.5 ? -1.0 : 1.0), position.y);
        vX = position.x;
        vSeed = aTuft.w;
        vLeafy = aLeafy;
        vRight = right;
        // The ground patches at the root, here and not for each pixel: the same for the whole tuft.
        vNear = patchNear(base);
        grassPatches(base.xz, 0.0, vPatch.x, vPatch.y);
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vec3(0, 1, 0));
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      ${NOISE}
      #define FRAGMENT
      ${GRASS}
      ${BLADES}
      uniform vec3 uTip;
      varying vec2 vUv, vPatch;
      varying float vSeed, vLeafy, vX, vNear;
      varying vec3 vRight;
      void main() {
        float across, d = tuft(vUv, vSeed, vLeafy, across);
        float a = smoothstep(-0.5, 0.5, d / max(fwidth(d), 1e-5));
        if (a < 0.01) discard;
        float lit = sunShadow();
        // Colours from the ground at the root. Thin grass: the lit side moves toward a warm light green.
        // Leaves: a darker, cooler green than the ground. The shade side is darker still.
        vec3 groundLit = grassColour(vPatch.x, vPatch.y, 1.0, vNear), groundShade = grassColour(vPatch.x, vPatch.y, 0.0, vNear);
        vec3 litCol = mix(mix(groundLit, uTip, 0.5), groundLit * vec3(0.72, 0.84, 0.80), vLeafy);
        vec3 shadeCol = mix(groundShade * vec3(0.86, 0.93, 0.92), groundShade * vec3(0.70, 0.82, 0.84), vLeafy);
        // One flat green: a split into a lit and a shade half looked too busy.
        vec3 col = mix(shadeCol, litCol, lit);
        // The root melts into the ground.
        col = mix(mix(groundShade, groundLit, lit), col, smoothstep(0.0, 0.1, vUv.y));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
}
