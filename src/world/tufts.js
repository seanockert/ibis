// Grass tufts: one family, from thin grass blades to a few wide leaves. The root takes the colour of the
// ground under it (grassColour() in street.js), so it melts into the grass. Above the root the tuft is one
// flat green, and a cooler one in the sun's shadow. Some tufts are dry, grey straw, most of them in dry
// patches. The wind moves them in slow waves. The birds push them
// aside: each tuft near a bird has a spring, so it parts as the bird walks through and wobbles back after.
// One instanced draw of upright cards that turn to the camera about y. The shader cuts the blades. Each card
// is a hull round the blades, not a quad, so the shader runs on about half the pixels.
// Placed by rules: clusters where a noise is high (one big tuft and small ones round it), and runs along
// the edges of the footpaths and kerbs, long grass round the fence posts and the lamp posts, and patches of
// long grass where a second noise is high. None in the mulch beds. Far tufts shrink to nothing, so they don't shimmer. A tuft is
// no taller than its distance to the nearest prop, so the grass doesn't go through a box on it. Tufts near
// the camera shrink to nothing too, so a tall tuft never fills the screen.
//
//   const tufts = new Tufts({ ground, beds, poles, posts, clear });   // beds: mulch (street.js), no tufts; poles: [x, z], long grass round each; posts: fence posts (Vector3), long grass round each; clear: [{ at, radius }], no tufts
//   scene.add(tufts.object);
//   tufts.update(camera, dt, ibises, solids);   // every frame. solids: [{ body, half, round }] from the props
//   tufts.rustle                                 // { amount, at, dry }: the grass that moves now, for the sound
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { lightUniforms, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { hash } from '../ibis/motion/spring.js';
import { inPuddle, PUDDLE } from './puddle.js';
import { BLADES, GRASS, grassUniforms, inBed, JOINT, STRIPS } from './street.js';
import { srgb, f } from './util.js';


export const TUFTS = {
  area: { x: [-84, 84], z: [-40, 20] },   // where the clusters go: past the play area by more than the fade
  tries: 1575,             // cluster tries: the density noise and the strips drop most of them
  density: 0.09,           // frequency of the density noise: clusters gather where it is high
  spread: [0.35, 0.9],     // distance of the small tufts from the big one
  joints: 0.3,             // part of the footpath joints with a small tuft
  edgeStep: 0.7,           // spacing of the tufts along a strip edge, where the noise lets them grow
  posts: { count: [4, 7], size: [0.55, 0.95], ring: [0.1, 0.45] },   // long thin grass round each fence post
  poles: { count: [6, 9], size: [0.45, 0.85], ring: [0.3, 0.6] },     // and round each lamp post: all round, out from its base (radius 0.25)
  size: [0.18, 0.38],      // height of the big tuft, units (the bird is 2). Small ones are 0.4 to 0.75 of it
  fade: [26, 38],          // distance from the camera where tufts shrink to nothing
  near: [1.2, 2.5],        // and near the camera
  wind: { dir: [0.8, 0.6], speed: 1.4, wave: 0.35, bend: 0.12 },   // wave: crests per unit; bend: of the height
  // Patches of long grass: grid step, and width (1: as wide as the other tufts). size: height at the patch
  // edge and in the middle, units: the middle hides the bird (2 tall).
  long: { density: 0.2, above: 0.85, step: 0.4, size: [0.6, 2.1], wide: 0.6 },
  // Dry tufts: patches where a noise is above above, and scatter: part of the other tufts.
  dry: { density: 0.12, above: 0.6, scatter: 0.08 },
  // The birds push tufts aside. bend: of the height, at the bird; drag: part of the push along the bird's
  // move at run speed (run). stiffness and damping: of each tuft's spring, so it wobbles back once or twice.
  // A tuft taller than tall springs slower (stiffness / height).
  push: { radius: 1.0, bend: 0.75, drag: 0.6, run: 6, stiffness: 55, damping: 4.5, tall: 0.5 },
  seed: 11,
};
const CLEAR_MARGIN = 0.8;   // past a clear area: bees drift over a clover edge
const MAX_SOLIDS = 32;   // props' boxes: the ball, the bin and its lid, the boxes and flaps, cereal, stubbies
const TIP = srgb(0.86, 0.90, 0.50);     // the lit side moves toward this warm light green
// Hull round the blades of tuft() (BLADES in street.js), uv units, the right half: x at each y, from a
// measure of the blades of many tufts with a margin. Mirrored for the left half.
const HULL = [[0.53, 0], [0.66, 0.45], [0.66, 0.62], [0.5, 0.85], [0.3, 1.0], [0.12, 1.06]];
const DRY = [srgb(0.80, 0.77, 0.66), srgb(0.56, 0.58, 0.62)];   // dry tufts: lit straw, cool grey shade

export class Tufts {
  constructor({ ground, beds = [], poles = [], posts = [], clear = [] }) {
    const tufts = place(ground, beds, poles, posts, clear);
    const g = new InstancedBufferGeometry();
    // Upright card: the hull, left and right side by side, as a strip of quads up the tuft.
    g.setAttribute('position', new Float32BufferAttribute(HULL.flatMap(([x, y]) => [-x, y, 0, x, y, 0]), 3));
    g.setIndex(HULL.slice(1).flatMap((_, i) => [2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2]));
    g.setAttribute('aTuft', new InstancedBufferAttribute(new Float32Array(tufts.flatMap(t => t.slice(0, 4))), 4));
    g.setAttribute('aLeafy', new InstancedBufferAttribute(new Float32Array(tufts.map(t => t[4])), 1));
    this.dry = tufts.map(t => dryness(t[0], t[1]));
    g.setAttribute('aLook', new InstancedBufferAttribute(new Float32Array(tufts.flatMap((t, i) => [this.dry[i], t[5]])), 2));
    g.setAttribute('aGround', new InstancedBufferAttribute(new Float32Array(tufts.map(t => ground.height(t[0], t[1]))), 1));   // the joints are on the raised footpath
    this.bend = new InstancedBufferAttribute(new Float32Array(tufts.length * 2), 2).setUsage(DynamicDrawUsage);
    g.setAttribute('aBend', this.bend);
    g.instanceCount = tufts.length;
    this.material = tuftMaterial();
    this.object = new Mesh(g, this.material);
    this.object.receiveShadow = true;
    this.object.frustumCulled = false;
    this.count = tufts.length;
    this.tufts = tufts;
    this.speed = new Float32Array(tufts.length * 2);   // the bend's speed, for each tuft
    this.active = new Set();   // tufts with a spring that moves
    this.prev = [];            // each bird's last position, for its speed
    this.rustle = { amount: 0, at: new Vector3(), dry: 0 };
    // Grid of the tufts, cells 1 unit, to find the ones near a bird.
    this.grid = new Map();
    tufts.forEach((t, i) => {
      const key = cell(Math.floor(t[0]), Math.floor(t[1]));
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    });
  }

  update(camera, dt = 0, birds = [], solids = []) {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    this.push(dt, birds);
    // Each solid: its middle (w: 1 on), its turn, and its half size (w: 1 round).
    for (let i = 0; i < MAX_SOLIDS; i++) {
      const s = solids[i], at = u.uSolidAt.value[i];
      if (!s) { at.w = 0; continue; }
      at.set(...s.body.position, 1);
      u.uSolidQ.value[i].fromArray(s.body.quaternion);
      u.uSolidHalf.value[i].set(...s.half, s.round ? 1 : 0);
    }
  }

  // Springs of the tufts near the birds. Each pulls the tuft's bend toward the push of the birds: away from
  // the bird, and along its move. When the bird goes, the tuft springs back past straight and settles.
  push(dt, birds) {
    this.rustle.amount = 0;
    if (dt <= 0) return;
    const { radius, bend, drag, run, stiffness, damping, tall } = TUFTS.push;
    const near = birds.map((bird, i) => {
      const p = bird.object.position, last = this.prev[i] ?? p;
      let vx = (p.x - last.x) / dt, vz = (p.z - last.z) / dt;
      if (Math.hypot(vx, vz) > 4 * run) vx = vz = 0;   // a jump to a new place: no move
      this.prev[i] = p.clone();
      for (let x = Math.floor(p.x - radius); x <= Math.floor(p.x + radius); x++) {
        for (let z = Math.floor(p.z - radius); z <= Math.floor(p.z + radius); z++) {
          for (const j of this.grid.get(cell(x, z)) ?? []) this.active.add(j);
        }
      }
      return { x: p.x, z: p.z, vx, vz };
    });
    if (!this.active.size) return;
    const b = this.bend.array, v = this.speed, steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    let sum = 0, sx = 0, sz = 0, dry = 0;
    for (const i of this.active) {
      const [tx, tz, height, seed] = this.tufts[i];
      let px = 0, pz = 0;
      for (const bird of near) {
        const dx = tx - bird.x, dz = tz - bird.z, d = Math.hypot(dx, dz);
        if (d >= radius) continue;
        const t = Math.min(Math.max((d - 0.2) / (radius - 0.2), 0), 1);
        const w = bend * (1 - t * t * (3 - 2 * t)) / Math.max(d, 1e-4);
        const s = drag * Math.min(Math.hypot(bird.vx, bird.vz) / run, 1) / Math.max(Math.hypot(bird.vx, bird.vz), 1e-4);
        px += dx * w + bird.vx * s * w * d;
        pz += dz * w + bird.vz * s * w * d;
      }
      const l = Math.hypot(px, pz);   // no more than the bend at the bird
      if (l > bend) { px *= bend / l; pz *= bend / l; }
      const k = stiffness * (0.8 + 0.4 * seed) * Math.min(tall / height, 1);   // each tuft a little out of step
      for (let n = 0; n < steps; n++) {
        v[2 * i] += (k * (px - b[2 * i]) - damping * v[2 * i]) * h;
        v[2 * i + 1] += (k * (pz - b[2 * i + 1]) - damping * v[2 * i + 1]) * h;
        b[2 * i] += v[2 * i] * h;
        b[2 * i + 1] += v[2 * i + 1] * h;
      }
      // Rustle: the speed of the blades that a bird pushes now, more for taller tufts. Not the tufts that
      // spring back after the bird: the rustle stops as the bird leaves the grass.
      const loud = l > 0 ? Math.hypot(v[2 * i], v[2 * i + 1]) * height : 0;
      sum += loud; sx += tx * loud; sz += tz * loud; dry += this.dry[i] * loud;
      // At rest: off the list.
      if (l === 0 && Math.abs(b[2 * i]) + Math.abs(b[2 * i + 1]) < 1e-3 && Math.abs(v[2 * i]) + Math.abs(v[2 * i + 1]) < 1e-2) {
        b[2 * i] = b[2 * i + 1] = v[2 * i] = v[2 * i + 1] = 0;
        this.active.delete(i);
      }
    }
    this.bend.needsUpdate = true;
    if (sum > 0) this.rustle.at.set(sx / sum, 0.3, sz / sum);
    Object.assign(this.rustle, { amount: sum, dry: sum > 0 ? dry / sum : 0 });
  }
}

const cell = (x, z) => x * 4096 + z;

// Dryness of a tuft at x, z, 0 or 0.6 to 1. From the place, not from the hash() sequence of place().
function dryness(x, z) {
  const { density, above, scatter } = TUFTS.dry;
  const d = noise2(x * density, z * density, TUFTS.seed + 3);
  const chance = Math.max(Math.min((d - above) / 0.15, 1), 0) + scatter;
  const n = Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663);
  return hash(n) < chance ? 0.6 + 0.4 * hash(n + 1) : 0;
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
function place(ground, beds, poles, posts, clear) {
  const { area, tries, density, spread, edgeStep, size, seed } = TUFTS;
  let n = seed * 7919;
  let r = () => hash(n++);
  // A rule with its own stream of random values, so a change to one rule (a post more) does not move
  // the tufts of the others. key: a number for the rule, or a place.
  const own = key => { let k = Math.imul(Math.floor(key * 1000), 2654435761) ^ seed; r = () => hash(k++); };
  const out = [];
  const kind = ground.kind;
  const onGrass = (x, z) => kind(x, z) === 'grass' && kind(x, z + 0.25) === 'grass' && kind(x, z - 0.25) === 'grass';
  // None in the puddle or on its mud bank. The seed is taken first, so the other tufts don't move.
  const add = (x, z, h, leafy, wide = 1) => {
    const tuft = [x, z, h, r(), Math.min(Math.max(leafy, 0), 1), wide];
    const cleared = clear.some(({ at, radius }) => Math.hypot(x - at[0], z - at[1]) < radius + CLEAR_MARGIN);
    if (!inPuddle(x, z, PUDDLE.bank + 0.1) && !inBed(beds, x, z, 0.1) && !cleared) out.push(tuft);
  };
  // Clusters: one big tuft and 1 to 4 small ones round it, all of one kind (leafy), where the noise is high.
  for (let i = 0; i < tries; i++) {
    const cx = area.x[0] + (area.x[1] - area.x[0]) * r(), cz = area.z[0] + (area.z[1] - area.z[0]) * r();
    const d = noise2(cx * density, cz * density, seed);
    if (r() > (d - 0.45) * 3 || !onGrass(cx, cz)) continue;
    const big = size[0] + (size[1] - size[0]) * r(), leafy = r();
    add(cx, cz, big, leafy);
    const count = 1 + Math.floor(r() * 4);
    for (let j = 0; j < count; j++) {
      const a = r() * 2 * Math.PI, dist = spread[0] + (spread[1] - spread[0]) * r();
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      if (onGrass(x, z)) add(x, z, big * (0.4 + 0.35 * r()), leafy + 0.3 * (r() - 0.5));
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
  for (const post of posts) {
    own(post.x * 7.3 + post.z * 131.1);
    const yard = kind(post.x, post.z + 0.3) === 'grass' ? 1 : -1;
    const n = count[0] + Math.floor(r() * (count[1] - count[0] + 1));
    for (let j = 0; j < n; j++) {
      const x = post.x + (r() < 0.5 ? -1 : 1) * (ring[0] + (ring[1] - ring[0]) * r());
      // Half in the thin grass in front of the fence line, half behind it.
      const z = post.z + yard * (r() < 0.5 ? -0.09 * r() : 0.3 * r());
      if (kind(x, z) === 'grass') add(x, z, tall[0] + (tall[1] - tall[0]) * r(), 0.2 * r());
    }
  }
  // Long thin grass all round the foot of each lamp post.
  for (const [px, pz] of poles) {
    own(px * 7.3 + pz * 131.1 + 0.5);
    const { count: pc, size: ps, ring: pr } = TUFTS.poles;
    const n = pc[0] + Math.floor(r() * (pc[1] - pc[0] + 1));
    for (let j = 0; j < n; j++) {
      const a = (j + 0.6 * r()) / n * 2 * Math.PI, dist = pr[0] + (pr[1] - pr[0]) * r();
      const x = px + Math.cos(a) * dist, z = pz + Math.sin(a) * dist;
      if (kind(x, z) === 'grass') add(x, z, ps[0] + (ps[1] - ps[0]) * r(), 0.2 * r());
    }
  }
  // Patches of long thin grass on a jittered grid, shorter toward the patch edge.
  const long = TUFTS.long;
  own(-1);
  for (let x = area.x[0]; x < area.x[1]; x += long.step) {
    for (let z = area.z[0]; z < area.z[1]; z += long.step) {
      const d = noise2(x * long.density, z * long.density, seed + 2);
      if (d < long.above) continue;
      const px = x + long.step * r(), pz = z + long.step * r(), deep = Math.min((d - long.above) / 0.08, 1);
      const tall = long.size[0] + (long.size[1] - long.size[0]) * deep * (0.75 + 0.25 * r());
      if (onGrass(px, pz)) add(px, pz, tall, 0.25 * r(), long.wide);
    }
  }
  return out;
}

function tuftMaterial() {
  const { wind } = TUFTS;
  const dir = new Vector3(wind.dir[0], 0, wind.dir[1]).normalize();
  return new ShaderMaterial({
    lights: true,
    alphaToCoverage: true,   // soft edges with the multisampled target in grade.js, no sorting
    side: 2,
    uniforms: {
      ...lightUniforms(), ...grassUniforms(),
      uTip: { value: TIP }, uDryLit: { value: DRY[0] }, uDryShade: { value: DRY[1] }, uTime: { value: 0 },
      uSolidAt: { value: Array.from({ length: MAX_SOLIDS }, () => new Vector4()) },
      uSolidQ: { value: Array.from({ length: MAX_SOLIDS }, () => new Vector4(0, 0, 0, 1)) },
      uSolidHalf: { value: Array.from({ length: MAX_SOLIDS }, () => new Vector4()) },
    },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      ${GRASS}
      attribute vec4 aTuft;
      attribute float aLeafy, aGround;
      attribute vec2 aBend, aLook;   // aLook: dry, width
      uniform float uTime;
      uniform vec4 uSolidAt[${MAX_SOLIDS}], uSolidQ[${MAX_SOLIDS}], uSolidHalf[${MAX_SOLIDS}];
      varying vec2 vUv, vPatch;
      varying float vSeed, vLeafy, vX, vNear, vDry;
      varying vec3 vRight;
      void main() {
        vec3 base = vec3(aTuft.x, aGround, aTuft.y);
        float far = distance(base, cameraPosition);
        float h = aTuft.z * (1.0 - smoothstep(${f(TUFTS.fade[0])}, ${f(TUFTS.fade[1])}, far)) * smoothstep(${f(TUFTS.near[0])}, ${f(TUFTS.near[1])}, far);
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
        // Wind: slow waves across the lawn, and a small flutter of each tuft. The birds push tufts aside (aBend).
        float y = position.y * position.y;
        vec2 dir = vec2(${f(dir.x)}, ${f(dir.z)});
        float wave = sin(dot(base.xz, dir) * ${f(wind.wave * 2 * Math.PI)} - uTime * ${f(wind.speed)});
        vec2 bend = dir * (${f(wind.bend)} * (0.6 + 0.4 * wave) + 0.03 * sin(uTime * 3.1 + aTuft.w * 40.0)) + aBend;
        vec3 offset = right * position.x * h * aLook.y + vec3(bend.x * h * y, position.y * h * (1.0 - 0.3 * dot(bend, bend)), bend.y * h * y);
        vec4 world = vec4(base + offset, 1.0);
        vUv = vec2(position.x * (fract(aTuft.w * 13.7) < 0.5 ? -1.0 : 1.0), position.y);
        vX = position.x;
        vSeed = aTuft.w;
        vLeafy = aLeafy;
        vDry = aLook.x;
        vRight = right;
        // The ground patches at the root, here and not for each pixel: the same for the whole tuft.
        vNear = patchNear(base);
        grassPatches(base.xz, 0.0, vPatch.x, vPatch.y);
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vec3(0, 1, 0));
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      #define FRAGMENT
      ${GRASS}
      ${BLADES}
      uniform vec3 uTip, uDryLit, uDryShade;
      varying vec2 vUv, vPatch;
      varying float vSeed, vLeafy, vX, vNear, vDry;
      varying vec3 vRight;
      void main() {
        float across, d = tuft(vUv, vSeed, vLeafy, across);
        float a = smoothstep(-0.5, 0.5, d / max(fwidth(d), 1e-5));
        if (a < 0.01) discard;
        vec2 lamp = lampLight(vec3(0.0, 1.0, 0.0));
        float lit = lampBand(sunShadow(), lamp);
        // Colours from the ground at the root. Thin grass: the lit side moves toward a warm light green.
        // Leaves: a darker, cooler green than the ground. The shade side is darker still.
        vec3 groundLit = grassColour(vPatch.x, vPatch.y, 1.0, vNear), groundShade = grassColour(vPatch.x, vPatch.y, 0.0, vNear);
        vec3 litCol = mix(mix(groundLit, uTip, 0.5), groundLit * vec3(0.72, 0.84, 0.80), vLeafy);
        vec3 shadeCol = mix(groundShade * vec3(0.86, 0.93, 0.92), groundShade * vec3(0.70, 0.82, 0.84), vLeafy);
        // One flat green: a split into a lit and a shade half looked too busy.
        vec3 col = mix(shadeCol, litCol, lit);
        col = mix(col, mix(uDryShade, uDryLit, lit), vDry);
        // The root melts into the ground.
        col = mix(mix(groundShade, groundLit, lit), col, smoothstep(0.0, 0.1, vUv.y));
        gl_FragColor = vec4(night(col, lamp), a);
        #include <colorspace_fragment>
      }`,
  });
}
