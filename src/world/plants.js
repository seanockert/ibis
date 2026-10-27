// Trees and shrubs of a Brisbane street: a gum, a bottlebrush and a garden shrub. Each one grows from a
// seed, so no two have the same branches and crown. The same toon look as the props: bark and flowers
// through toonParts() (props.js), lit and shade colours and an outline. The leaves are round clumps of
// balls in one draw, with two tones (shade, lit) and a light edge of round leaf lobes, as in the concept art.
//
//   const plants = new Plants(asset, physics, [{ kind: 'gum', at: [x, z], seed: 3 }, ...]);
//   scene.add(plants.object);
//   plants.update(camera, dt);   // every frame: the wind (wind.js) sways them, with their outlines and shadows
//
// Options of a plant: kind (a key of PLANTS), at [x, z], seed (default: its place in the list), scale
// (default 1), flowers (a shrub: 'yellow', 'pink' or none), perch (a bottlebrush: [x, z], the world
// direction of a bare perch branch for a miner, or none). A plant in PLAY gets a solid in the physics: a
// tree its trunk, a shrub a core (its branches), so the bird goes into the leaves at the edge but not
// through the middle. The street puts most of them in the yards. A plant that the camera is in fades
// all over (seeId in props.js), as a prop in seeInside().
//
//   plants.perches();   // where a flying miner can land: the perch branches (as fence.perches())
import { Box3, CatmullRomCurve3, Color, CylinderGeometry, Float32BufferAttribute, BufferGeometry, Group, IcosahedronGeometry, Line3, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { lightUniforms, NOISE, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { hash } from '../ibis/motion/spring.js';
import { FAR_LAYER } from './farShadow.js';
import { outlineMaterial, SEE, SEE_THROUGH, SEE_VERTEX, seeId, seeOn, toonParts } from './props.js';
import { inPlay, streetHeight } from './street.js';
import { srgb, f } from './util.js';
import { swayReach, swayWeight, WIND_SWAY, windDepthMaterial, windTime } from './wind.js';


// Sizes in units (the bird is 2 tall, 1 unit is about 35 cm), a little smaller than real, as the rest of
// the street. [min, max] pairs: the seed picks a value between them.
// height: of the tree. fork: height of the fork, a part of the height. lean: of the trunk top, a part
// of the height. trunk: radius at the foot and at the fork; flare: the foot is this much wider. limbs:
// how many. tilt: from upright, radians. reach: limb length, a part of the height. twigs: side branches
// on each limb; limb: limb radius at its foot and its end. clump: radius of the leaf clump at each branch end; flat: its height
// to its width. balls: in each clump; ball: their radius. fill: a clump on the fork too (a dense crown).
// crown: a dome crown (dome()) in place of the open one: the height of its middle, a part of the height;
// its half width, a part of the height; flat: its height to its width; clumps: on it; under: the part of
// the clumps below its middle that are kept (fewer, so the branches show).
// spikes: bottlebrush flowers (count for each 8 leaf balls, radius, length).
export const PLANTS = {
  // Tall and open: a pale trunk, limbs that fork high, separate clumps of olive leaves with sky between.
  gum: {
    height: [22, 27], fork: [0.32, 0.4], lean: 0.05, trunk: [0.8, 0.5], flare: 0.5, limbs: [3, 4],
    tilt: [0.45, 0.8], reach: [0.38, 0.46], twigs: [1, 2], limb: [0.42, 0.1],
    clump: [2.2, 2.8], flat: 0.6, balls: [6, 8], ball: [0.6, 0.85], fill: false,
    bark: [srgb(0.95, 0.91, 0.84), srgb(0.72, 0.69, 0.76), srgb(0.55, 0.45, 0.34)],
    leaves: { lit: srgb(0.64, 0.68, 0.36), shade: srgb(0.32, 0.49, 0.37), line: srgb(0.15, 0.27, 0.23) },
  },
  // Small and round: a brown trunk that forks low into steep stems, a full round crown of dark green
  // clumps with the branches seen through the gaps under it, and red brush flowers.
  bottlebrush: {
    height: [10, 12.5], fork: [0.12, 0.17], lean: 0.05, trunk: [0.55, 0.36], flare: 0.45, limbs: [3, 5],
    limb: [0.3, 0.07], crown: { centre: 0.6, width: [0.3, 0.35], flat: 0.75, clumps: [16, 20], under: 0.45 },
    clump: [1.3, 1.65], flat: 0.7, balls: [4, 6], ball: [0.55, 0.8],
    spikes: { count: [4, 6], radius: 0.12, length: 0.9 },
    perch: { height: 3.3, length: 1.5, radius: [0.13, 0.06] },
    bark: [srgb(0.58, 0.40, 0.28), srgb(0.38, 0.27, 0.29), srgb(0.27, 0.18, 0.14)],
    leaves: { lit: srgb(0.55, 0.65, 0.31), shade: srgb(0.25, 0.43, 0.32), line: srgb(0.09, 0.21, 0.19) },
    flower: [srgb(0.94, 0.27, 0.20), srgb(0.66, 0.16, 0.27), srgb(0.42, 0.08, 0.10)],
  },
  // A garden shrub: a dome of leaves on the ground, as tall as the bird, with or without flowers.
  shrub: {
    height: [1.7, 2.5], width: [1.1, 1.5], balls: [11, 15], ball: [0.45, 0.65],
    blooms: { count: [10, 16], radius: 0.11 },
    leaves: { lit: srgb(0.55, 0.68, 0.33), shade: srgb(0.26, 0.45, 0.35), line: srgb(0.11, 0.24, 0.21) },
    flowers: {
      yellow: [srgb(0.99, 0.86, 0.30), srgb(0.82, 0.60, 0.32), srgb(0.48, 0.34, 0.12)],
      pink: [srgb(0.98, 0.50, 0.55), srgb(0.73, 0.32, 0.46), srgb(0.45, 0.14, 0.22)],
    },
  },
};
// Leaf light. canopy: how much of the clump's round shape is in the normal (1: one big ball, 0: each
// ball on its own). wrap: added to N.L, so more of a clump is lit than of a solid (light goes through
// leaves). side: the leaf light is the sun with its ground part this much larger, lower than the sun,
// so the light edge runs across a clump at a slant and not in flat bands. lobes: leaf lobes across the
// width of a clump; lobe: their effect on N.L, so the light edge is a chain of round lobes.
const LEAF = { canopy: 0.75, wrap: -0.15, side: 0.6, lobes: 1.5, lobe: 1.4 };
const LINE_BACK = 4;       // the leaf outline shows only against what is this far behind it, units: none inside a crown
const BALL_DETAIL = 1;     // icosphere detail of a leaf ball: 80 triangles
const BARK_SIDES = 7;
const SOLID = 0.15;        // the physics trunk is this much wider than the trunk
const CORE = [0.7, 0.7];   // a shrub's solid core: radius, a part of its half width; height, a part of its height
const CHUNK = 32;
const SINK = 0.4;          // a shrub's low balls are this part of their radius in the ground
const HIDDEN = 0.97;       // a leaf triangle with its corners this far inside another ball is left out          // chunk width along x: a chunk is a few draws, culled as one

export class Plants {
  constructor(asset, physics = null, list = []) {
    // The plants in chunks along x, so the camera and the shadow skip the chunks out of their view.
    const chunks = new Map();
    this.spots = [];
    this.volumes = [];
    list.forEach((def, i) => {
      const plant = grow(def, def.seed ?? i), key = Math.floor(def.at[0] / CHUNK);
      this.spots.push(...plant.perches);
      this.volumes.push(plant.volume);
      // The plant's id (seeId) on all its vertices: its place in the list.
      for (const [g] of plant.bark) g.setAttribute('aSeeId', new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i), 1));
      for (const b of plant.balls) b.id = i;
      if (!chunks.has(key)) chunks.set(key, { bark: [], balls: [] });
      chunks.get(key).bark.push(...plant.bark);
      chunks.get(key).balls.push(...plant.balls);
      if (physics && plant.solid) physics.addTerrain(plant.solid);
    });
    this.object = new Group();
    const leaf = leafMaterial(asset.uniforms);
    for (const { bark, balls } of chunks.values()) this.object.add(...chunkMeshes(bark, balls, leaf, asset.uniforms));
    this.count = list.length;
  }

  update(camera, dt = 0) {
    windTime.value += dt;
    seeId.value = this.volumes.findIndex(v => inside(v, camera.position));
  }

  // Perches for the flying miners (src/characters/sentry.js), as perch() on a prop: a point on top of a
  // perch branch, where a bird stands across the branch (face). They do not sway: that low, the wind
  // moves a branch about 0.1 units.
  perches() {
    return this.spots.map(({ at, face }) => ({ perch: (out = new Vector3()) => out.copy(at), face }));
  }
}

// Four draws for a chunk: bark and flowers with their outline (toonParts()), leaves, and the leaf
// outline, pushed back LINE_BACK, so it is only round the outside of a crown.
function chunkMeshes(bark, balls, leaf, shared) {
  const geometry = leafGeometry(balls);
  const leaves = new Mesh(geometry, leaf);
  leaves.castShadow = true;
  leaves.customDepthMaterial = windDepthMaterial();
  leaves.layers.enable(FAR_LAYER);
  const leafLine = new Mesh(geometry, outlineMaterial(new Color(), shared, { tones: true, wind: true, back: LINE_BACK, ids: true }));
  if (!bark.length) return [leaves, leafLine];   // shrubs with no flowers
  const [body, line] = toonParts(bark, shared, { wind: true, ids: true });
  body.layers.enable(FAR_LAYER);
  return [body, line, leaves, leafLine];
}

// One plant in world space: bark parts for toonParts() ([geometry, colours]), leaf balls ({ centre,
// radius, clump: the centre and half sizes of its clump, colours }), the solid (points) or null, and
// the volume that the camera can be in (inside()).
function grow(def, seed) {
  let n = 0;
  const rand = () => hash(seed * 7919 + 101 * n++);
  const range = ([a, b]) => a + (b - a) * rand();
  const kind = PLANTS[def.kind], scale = def.scale ?? 1;
  const out = def.kind === 'shrub' ? shrub(kind, def, rand, range) : tree(kind, rand, range);
  // To the world: a turn about y from the seed, the scale, and the ground at its place.
  const [x, z] = def.at, base = new Vector3(x, streetHeight(z), z);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI * 2);
  const place = p => p.multiplyScalar(scale).applyQuaternion(turn).add(base);
  const perches = [];
  if (def.perch && kind.perch) {
    const dir = new Vector3(def.perch[0], 0, def.perch[1]).normalize().applyQuaternion(turn.clone().invert());
    const branch = perchBranch(kind, out.limbs, dir);
    out.bark.push(branch.bark);
    perches.push(branch);
  }
  for (const [geometry] of out.bark) {
    geometry.scale(scale, scale, scale).applyQuaternion(turn).translate(base.x, base.y, base.z);
    const pos = geometry.attributes.position;
    geometry.setAttribute('aSway', new Float32BufferAttribute(Array.from({ length: pos.count }, (_, i) => swayWeight(pos.getY(i) - base.y)), 1));
  }
  for (const b of out.balls) {
    place(b.centre);
    b.radius *= scale;
    b.ground = base.y;
  }
  for (const c of new Set(out.balls.map(b => b.clump))) {   // balls share their clump: once each
    place(c.centre);
    c.half.multiplyScalar(scale);
  }
  for (const p of perches) {
    place(p.at);
    p.face.applyQuaternion(turn);
  }
  // The volume: a capsule round each branch and a sphere round each leaf ball, SEE.margin larger and as
  // much as the wind moves them.
  const volume = { box: new Box3(), branches: [], balls: [] }, pad = y => SEE.margin + swayReach(y - base.y);
  for (const [geometry] of out.bark) {
    const tube = geometry.userData.tube;
    if (!tube) continue;   // flowers
    for (let i = 0; i < tube.n; i++) {
      const [a, b] = [i, i + 1].map(k => place(tube.curve.getPointAt(k / tube.n)));
      const r = Math.max(tube.radius(i / tube.n), tube.radius((i + 1) / tube.n)) * scale + pad(Math.max(a.y, b.y));
      volume.branches.push({ line: new Line3(a, b), r });
      volume.box.expandByPoint(a.clone().subScalar(r)).expandByPoint(a.clone().addScalar(r));
      volume.box.expandByPoint(b.clone().subScalar(r)).expandByPoint(b.clone().addScalar(r));
    }
  }
  for (const { centre, radius } of out.balls) {
    const r = radius + pad(centre.y + radius);
    volume.balls.push({ centre, r });
    volume.box.expandByPoint(centre.clone().subScalar(r)).expandByPoint(centre.clone().addScalar(r));
  }
  // The solid: an upright prism of 8 sides round the foot (out.solid: radius and height).
  let solid = null;
  if (inPlay(x, z)) {
    const [w, h] = out.solid.map(v => v * scale);
    solid = Array.from({ length: 8 }, (_, i) => i / 8 * Math.PI * 2)
      .flatMap(a => [0, h].flatMap(y => [base.x + Math.cos(a) * w, base.y + y, base.z + Math.sin(a) * w]));
  }
  return { bark: out.bark, balls: out.balls, perches, solid, volume };
}

// True when a point is in the volume of a plant (grow()).
function inside({ box, branches, balls }, p) {
  return box.containsPoint(p) && (balls.some(({ centre, r }) => centre.distanceToSquared(p) < r * r)
    || branches.some(({ line, r }) => line.closestPointToPoint(p, true, closest).distanceToSquared(p) < r * r));
}

const closest = new Vector3();   // scratch

// A tree in its own space (the foot at the origin): a trunk to the fork, limbs out and up from it, a
// side branch on some, a leaf clump at each branch end. limbs: the low limbs of a dome crown, for a perch branch.
function tree(kind, rand, range) {
  const height = range(kind.height), fork = height * range(kind.fork), up = new Vector3(0, 1, 0);
  const lean = new Vector3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(2 * kind.lean * height);
  const top = new Vector3(lean.x, fork, lean.z);
  const wobble = s => new Vector3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(s);
  const bark = [[tube([
    new Vector3(0, -0.3, 0),
    lean.clone().multiplyScalar(0.25).add(wobble(0.3)).setY(fork * 0.35),
    lean.clone().multiplyScalar(0.7).add(wobble(0.3)).setY(fork * 0.7),
    top,
  ], kind.trunk, kind.flare), kind.bark]];
  const clumps = [];
  if (kind.fill) clumps.push({ centre: top.clone().addScaledVector(up, range(kind.clump) * 0.9), size: range(kind.clump) * 1.1 });
  const limbs = (kind.crown ? dome : open)(kind, height, top, bark, clumps, rand, range);
  const balls = clumps.flatMap(c => clump(c.centre, new Vector3(c.size, c.size * kind.flat, c.size), kind, rand, range));
  if (kind.spikes) bark.push(...spikes(balls, kind, rand, range));
  return { bark, balls, limbs, solid: [kind.trunk[0] + SOLID, fork] };
}

// An open crown (a gum): limbs out and up from the fork, a side branch on some, and a leaf clump at each
// branch end, with sky between.
function open(kind, height, top, bark, clumps, rand, range) {
  const up = new Vector3(0, 1, 0);
  const limbs = Math.round(range(kind.limbs)), turn0 = rand() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const a = turn0 + (i + 0.4 * (rand() - 0.5)) * Math.PI * 2 / limbs, tilt = range(kind.tilt), len = height * range(kind.reach);
    const dir = new Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
    // Out along dir, then curving up at the end.
    const start = top.clone().addScaledVector(up, -0.15);
    const mid = start.clone().addScaledVector(dir, len * 0.5);
    const end = start.clone().addScaledVector(dir, len * 0.8).addScaledVector(up, len * 0.25);
    bark.push([tube([start, mid, end], kind.limb), kind.bark]);
    const size = range(kind.clump);
    clumps.push({ centre: end.clone().addScaledVector(up, size * 0.35), size });
    const twigs = Math.round(range(kind.twigs)), side = rand() < 0.5 ? -1 : 1;
    for (let j = 0; j < twigs; j++) {
      // Side branches along the limb, flatter, to one side and then the other.
      const b = a + side * (j % 2 ? -1 : 1) * range([0.6, 1.1]), t2 = Math.min(tilt + 0.35, 1.3), l2 = len * range([0.35, 0.5]);
      const d2 = new Vector3(Math.sin(t2) * Math.cos(b), Math.cos(t2), Math.sin(t2) * Math.sin(b));
      const s2 = curvePoint(start, mid, end, range([0.35, 0.7])), e2 = s2.clone().addScaledVector(d2, l2).addScaledVector(up, l2 * 0.2);
      bark.push([tube([s2, s2.clone().lerp(e2, 0.5).addScaledVector(up, 0.1), e2], [kind.limb[0] * 0.6, kind.limb[1]]), kind.bark]);
      const s = size * range([0.6, 0.8]);
      clumps.push({ centre: e2.clone().addScaledVector(up, s * 0.35), size: s });
    }
  }
}

// A dome crown (a bottlebrush): leaf clumps over the top and sides of a round crown and only some below
// its middle, so it reads as one full shape, with the branches seen through the gaps under it. Limbs
// from the fork, each in two branches up into the crown, and a twig from the nearest branch to each clump.
// Gives the low limbs (fork to split).
function dome(kind, height, top, bark, clumps, rand, range) {
  const { centre, width, flat, clumps: count, under } = kind.crown, up = new Vector3(0, 1, 0);
  const w = height * range(width), half = new Vector3(w, w * flat, w), middle = new Vector3(top.x, height * centre, top.z);
  const limbs = [], low = [], n = Math.round(range(kind.limbs)), turn0 = rand() * Math.PI * 2;
  const split = kind.limb[0] * 0.6;   // radius where a limb splits in two
  for (let i = 0; i < n; i++) {
    // Evenly round, out and up from the fork, then in two branches (a Y) that spread into the crown.
    const a = turn0 + (i + 0.4 * (rand() - 0.5)) * Math.PI * 2 / n, out = new Vector3(Math.cos(a), 0, Math.sin(a));
    const start = top.clone().addScaledVector(up, -0.15).addScaledVector(out, kind.trunk[1] * 0.5);
    const fork = start.clone().lerp(middle, range([0.4, 0.55])).addScaledVector(out, w * range([0.25, 0.4])).setY(start.y + (middle.y - half.y - start.y) * range([0.55, 0.8]));
    const mid = start.clone().lerp(fork, 0.5).addScaledVector(out, w * 0.06);
    bark.push([tube([start, mid, fork], [kind.limb[0], split]), kind.bark]);
    limbs.push([start, mid, fork]);
    low.push([start, mid, fork]);
    for (const side of [-1, 1]) {
      const b = a + side * range([0.35, 0.7]), along = new Vector3(Math.cos(b), 0, Math.sin(b));
      const end = middle.clone().addScaledVector(along, w * range([0.5, 0.75])).addScaledVector(up, half.y * range([-0.3, 0.3]));
      const bend = fork.clone().lerp(end, 0.5).addScaledVector(up, 0.3);
      bark.push([tube([fork, bend, end], [split, kind.limb[1]]), kind.bark]);
      limbs.push([fork, bend, end]);
    }
  }
  // Clumps on the crown's shell, in a spiral (the golden angle) from the top down to under its middle.
  const total = Math.round(range(count)), near = new Vector3(), p = new Vector3();
  for (let i = 0; i < total; i++) {
    const y = 1 - (i + 0.5) / total * 1.6;
    if (y < 0 && rand() > under) continue;
    const ring = Math.sqrt(1 - y * y), a = i * 2.39996 + rand() * 0.5;
    const at = new Vector3(Math.cos(a) * ring, y, Math.sin(a) * ring).multiply(half).multiplyScalar(0.85).add(middle);
    clumps.push({ centre: at, size: range(kind.clump) });
    let best = Infinity;
    for (const limb of limbs) {
      for (let t = 0.2; t <= 1.001; t += 0.2) {
        p.copy(curvePoint(...limb, Math.min(t, 1)));
        if (p.distanceTo(at) < best) { best = p.distanceTo(at); near.copy(p); }
      }
    }
    bark.push([tube([near.clone(), near.clone().lerp(at, 0.5).addScaledVector(up, 0.15), at], [kind.limb[0] * 0.45, kind.limb[1]]), kind.bark]);
  }
  return low;
}

// A bare perch branch (tree space), about level along dir from the low limb that points most along dir,
// out past the other limbs under the crown, so a miner on it is in clear view. It starts on the limb at
// the perch height, or at the limb's end if that is lower. The perch is near its tip, on top: { bark,
// at, face }. A perch over the fence post tops (3.2) takes a miner near both from the posts (sentry.js).
function perchBranch(kind, limbs, dir) {
  const { height, length, radius } = kind.perch;
  const along = l => l[2].clone().sub(l[0]).setY(0).normalize().dot(dir);
  const limb = limbs.reduce((a, b) => along(b) > along(a) ? b : a);
  let t = 0;
  while (t < 1 && curvePoint(...limb, t).y < height - 0.1) t += 0.05;
  const start = curvePoint(...limb, Math.min(t, 1));
  const end = start.clone().addScaledVector(dir, length).setY(height + 0.1);
  const mid = start.clone().lerp(end, 0.5).setY(height);
  const at = curvePoint(start, mid, end, 0.8).add(new Vector3(0, radius[0] + (radius[1] - radius[0]) * 0.8, 0));
  return { bark: [tube([start, mid, end], radius), kind.bark], at, face: new Vector3(dir.z, 0, -dir.x) };
}

// A point at t (0 to 1) on the smooth curve through three points.
const curvePoint = (a, b, c, t) => new CatmullRomCurve3([a, b, c]).getPointAt(t);

// A shrub: one clump with its shell down to the ground, and the low balls sunk into the ground (SINK
// of their radius), so it sits on a wide foot and does not float.
function shrub(kind, def, rand, range) {
  const h = range(kind.height), w = range(kind.width);
  const half = new Vector3(w, h * 0.5, w * range([0.8, 1]));
  const balls = clump(new Vector3(0, h * 0.42, 0), half, kind, rand, range, -1);
  for (const b of balls) b.centre.y = Math.max(b.centre.y, b.radius * (1 - SINK));
  const colours = kind.flowers[def.flowers];
  const bark = colours ? blooms(balls, colours, kind, rand, range) : [];
  return { bark, balls, solid: [CORE[0] * Math.min(half.x, half.z), CORE[1] * h] };
}

// Leaf balls of one clump: a big ball in the middle, and balls on a shell round it, more on top and
// smaller below. below: the lowest shell height, -1 to 1 (a shrub stops near the ground).
function clump(centre, half, kind, rand, range, below = -0.45) {
  const count = Math.round(range(kind.balls)), size = (half.x + half.z) / 2;
  const leaves = kind.leaves, colours = [leaves.lit, leaves.shade, leaves.line];
  const c = { centre, half };
  const balls = [{ centre: centre.clone(), radius: size * 0.7, clump: c, colours }];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i + 0.5) / count * (1 - below), ring = Math.sqrt(1 - y * y), a = i * 2.39996 + rand() * 0.8;
    const p = new Vector3(Math.cos(a) * ring, y, Math.sin(a) * ring).multiply(half).multiplyScalar(0.72);
    balls.push({ centre: p.add(centre), radius: range(kind.ball) * size / 1.2 * (y < 0 ? 0.8 : 1), clump: c, colours });
  }
  return balls;
}

// A point on the outside of the crown: on a ball, and not inside another ball. dir(): the side to try,
// from the ball centre. null when none is found.
function outside(balls, rand, dir, depth = 0.95) {
  for (let tries = 0; tries < 12; tries++) {
    const b = balls[Math.floor(rand() * balls.length)], d = dir(b);
    const p = b.centre.clone().addScaledVector(d, b.radius * depth);
    if (balls.every(o => o === b || o.centre.distanceTo(p) > o.radius * 1.02)) return { p, d };
  }
  return null;
}

// Bottlebrush flowers: red brushes out of the crown, near upright, on the top and the sides.
function spikes(balls, kind, rand, range) {
  const { count, radius, length } = kind.spikes, out = [];
  const total = Math.round(range(count) * balls.length / 8);
  const side = b => b.centre.clone().sub(b.clump.centre).setY(0).normalize().add(new Vector3(rand() - 0.5, range([0.1, 0.9]), rand() - 0.5)).normalize();
  for (let i = 0; i < total; i++) {
    const at = outside(balls, rand, side);
    if (!at) continue;
    const axis = at.d.clone().addScaledVector(new Vector3(0, 1, 0), 1.2).normalize();
    const g = brush(radius, length);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis));
    g.translate(...at.p.addScaledVector(axis, length * 0.25).toArray());
    out.push([g, kind.flower]);
  }
  return out;
}

// A bottlebrush flower along y, centred: a tube with a star section (ridges, so the outline reads as
// bristles), near straight in its length and closed to a point at each end.
function brush(radius, length) {
  const sides = 12, g = new CylinderGeometry(radius, radius, length, sides, 4, true);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / length + 0.5, ridge = i % (sides + 1) % 2 ? 0.55 : 1;
    const r = ridge * Math.sin(Math.PI * t) ** 0.25;
    pos.setX(i, pos.getX(i) * r);
    pos.setZ(i, pos.getZ(i) * r);
  }
  g.computeVertexNormals();
  return g;
}

// Shrub flowers: small flat discs on the outside of the dome, facing out.
function blooms(balls, colours, kind, rand, range) {
  const { count, radius } = kind.blooms, out = [];
  const total = Math.round(range(count));
  const side = () => new Vector3(rand() - 0.5, range([-0.1, 0.8]), rand() - 0.5).normalize();
  for (let i = 0; i < total; i++) {
    const at = outside(balls, rand, side, 1);
    if (!at) continue;
    const g = new IcosahedronGeometry(radius, 0).scale(1, 1, 0.55);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), at.d));
    g.translate(...at.p.toArray());
    out.push([g, colours]);
  }
  return out;
}

// A branch: a tube along a smooth curve through points, the radius from r0 to r1, closed to a point at
// the end. flare: the foot is this much wider.
function tube(points, [r0, r1], flare = 0) {
  const curve = new CatmullRomCurve3(points);
  const n = Math.max(3, Math.ceil(curve.getLength() / 0.6)), sides = BARK_SIDES;
  const radius = t => (r0 + (r1 - r0) * t) * (1 + flare * (1 - t) ** 8);
  const { tangents, normals, binormals } = curve.computeFrenetFrames(n, false);
  const position = [], normal = [], index = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPointAt(t), r = radius(t);
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      const d = normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(binormals[i], Math.sin(a));
      position.push(p.x + d.x * r, p.y + d.y * r, p.z + d.z * r);
      normal.push(d.x, d.y, d.z);
    }
  }
  const tip = curve.getPointAt(1).addScaledVector(tangents[n], r1);
  position.push(...tip.toArray());
  normal.push(...tangents[n].toArray());
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      index.push(a, b, b + sides, a, b + sides, a + sides);
    }
  }
  const last = n * sides, end = (n + 1) * sides;
  for (let j = 0; j < sides; j++) index.push(last + j, last + (j + 1) % sides, end);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  g.userData.tube = { curve, n, radius };   // tree space, for the volume (grow())
  return g;
}

// All leaf balls in one geometry: position, normal, aCanopy (the normal of the clump's ellipsoid), aLobe
// (the place in the lobe grid: the clump's size, so a small and a large clump get as many lobes), the
// tones (aLit, aShade), the outline (_outline, aLine), the wind weight (aSway) and the plant (aSeeId). A triangle inside
// another ball can't be seen: it is left out (about half of them).
function leafGeometry(balls) {
  const unit = new IcosahedronGeometry(1, BALL_DETAIL).attributes.position.array, corners = unit.length / 3;
  const names = ['position', 'normal', 'aCanopy', 'aLobe', 'aLit', 'aShade', 'aLine'];
  const data = Object.fromEntries(names.map(name => [name, []])), weights = [], ids = [];
  const p = new Vector3(), c = new Vector3(), tri = [new Vector3(), new Vector3(), new Vector3()];
  for (const ball of balls) {
    const { centre, radius, clump, colours, ground, id } = ball;
    const near = balls.filter(o => o !== ball && o.centre.distanceTo(centre) < o.radius + radius);
    for (let t = 0; t < corners; t += 3) {
      tri.forEach((v, i) => v.fromArray(unit, (t + i) * 3).multiplyScalar(radius).add(centre));
      if (near.some(o => tri.every(v => v.distanceTo(o.centre) < o.radius * HIDDEN))) continue;
      for (let i = 0; i < 3; i++) {
        p.fromArray(unit, (t + i) * 3);
        data.normal.push(p.x, p.y, p.z);
        data.position.push(...tri[i].toArray());
        weights.push(swayWeight(tri[i].y - ground));
        ids.push(id);
        c.copy(tri[i]).sub(clump.centre).divide(clump.half).divide(clump.half).normalize();
        data.aCanopy.push(c.x, c.y, c.z);
        c.copy(tri[i]).sub(clump.centre).multiplyScalar(LEAF.lobes / (clump.half.x + clump.half.z)).add(clump.centre);   // the centre: each clump its own lobes
        data.aLobe.push(c.x, c.y, c.z);
        ['aLit', 'aShade', 'aLine'].forEach((name, k) => data[name].push(colours[k].r, colours[k].g, colours[k].b));
      }
    }
  }
  const g = new BufferGeometry();
  for (const name of names) g.setAttribute(name, new Float32BufferAttribute(data[name], 3));
  g.setAttribute('_outline', g.attributes.normal);
  g.setAttribute('aSway', new Float32BufferAttribute(weights, 1));
  g.setAttribute('aSeeId', new Float32BufferAttribute(ids, 1));
  return g;
}

// Leaves: two tones, split by the toon band on a normal between the ball and the clump, so each clump
// reads as one shape, with round leaf lobes on the light edge. No shadow map on the leaves: the sway
// and the coarse far map gave streaks and soft bands on the crowns.
function leafMaterial(shared) {
  return new ShaderMaterial({
    lights: true,
    defines: { SEE_ID: '' },
    uniforms: { ...lightUniforms(), uSun: shared.uSun, uSee: seeOn, uSeeId: seeId, uWindTime: windTime },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      ${WIND_SWAY}
      ${SEE_VERTEX}
      attribute vec3 aCanopy, aLobe, aLit, aShade;
      varying vec3 vNormal, vCanopy, vLobe, vWorld, vLit, vShade;
      void main() {
        vLobe = aLobe;   // from the rest position: the lobes stay on the leaves as they sway
        vec4 world = modelMatrix * vec4(sway(position), 1.0);
        vWorld = world.xyz;
        vNormal = normal;
        vCanopy = aCanopy;
        vLit = aLit; vShade = aShade;
        seeVertex();
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      ${NOISE}
      ${SEE_THROUGH}
      uniform vec3 uSun;
      varying vec3 vNormal, vCanopy, vLobe, vWorld, vLit, vShade;
      // 1 at the middle of a lobe, less to its edge: one minus the distance to the nearest point of a
      // jittered grid. Its rings are round, so a light edge on it is a chain of round lobes.
      float lobe(vec3 p) {
        vec3 cell = floor(p), d = vec3(0.0);
        float best = 9.0;
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
          vec3 c = cell + vec3(x, y, z);
          d = c + vec3(hash3(c), hash3(c + 17.3), hash3(c + 41.9)) * 0.8 + 0.1 - p;
          best = min(best, dot(d, d));
        }
        return 1.0 - sqrt(best);
      }
      void main() {
        if (seeHidden(seeThrough(vWorld))) discard;
        vec3 light = normalize(uSun + vec3(uSun.x, 0.0, uSun.z) * ${f(LEAF.side)});
        vec3 n = normalize(mix(normalize(vNormal), normalize(vCanopy), ${f(LEAF.canopy)}));
        float ndl = dot(n, light) + ${f(LEAF.wrap)} + ${f(LEAF.lobe)} * (lobe(vLobe) - 0.5);
        float w = 0.5 * max(fwidth(ndl), 1e-5);
        gl_FragColor = vec4(mix(vShade, vLit, smoothstep(BAND_SPLIT - w, BAND_SPLIT + w, ndl)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
