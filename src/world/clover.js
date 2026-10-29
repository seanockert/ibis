// White clover patches with bees (bees.js): a low base, outlined clump domes and white heads on stems.
// All patches: one toon and one outline draw (toonParts()).
//
//   const clover = new Clover(asset, [{ at: [x, z], radius: 1.3, bees: [0, 3] }], ground);   // bees: n or [min, max]
//   clover.update(camera, dt, ibises);
//   clover.height(x, z)   // top of the clover, or the ground
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, SphereGeometry, Vector3 } from 'three';
import { hash } from '../ibis/motion/spring.js';
import { Bees } from './bees.js';
import { toonParts } from './props.js';
import { srgb } from './util.js';

// Units (1 is about 35 cm). height: base. clumps, flowers: per square unit. edge: wobble of the patch
// radius. inner: flowers out to this part of the edge. stem: head height over the leaves.
export const CLOVER = {
  height: 0.12, clumps: 4, clump: { radius: [0.22, 0.36], height: [0.22, 0.32] },
  rings: 6, segments: 40, edge: 0.3,
  flowers: 0.8, inner: 0.75, head: [0.08, 0.1], stem: [0.08, 0.16],
  seed: 23,
};
const COLOURS = {
  leaf: [srgb(0.36, 0.60, 0.29), srgb(0.21, 0.40, 0.27), srgb(0.10, 0.22, 0.14)],
  head: [srgb(0.98, 0.97, 0.92), srgb(0.72, 0.76, 0.84), srgb(0.32, 0.36, 0.38)],
  stem: [srgb(0.42, 0.62, 0.31), srgb(0.24, 0.43, 0.28)],
};
const SINK = 0.01;   // below the ground, so no gap shows

export class Clover {
  constructor(asset, patches, ground) {
    this.ground = ground;
    let n = CLOVER.seed * 7919;
    const r = () => hash(n++);
    this.patches = patches.map(def => patch(def, r, ground));
    const parts = this.patches.flatMap(p => [[base(p, ground), COLOURS.leaf], ...p.clumps.map(c => [dome(c, ground), COLOURS.leaf]), ...p.heads.flatMap(h => [[ball(h), COLOURS.head], [stalk(h), COLOURS.stem]])]);
    this.bees = new Bees(this.patches.map(p => ({ at: p.at, radius: p.radius, count: p.bees, flowers: p.tops })), (x, z) => this.height(x, z));
    this.object = new Group().add(...toonParts(parts, asset.uniforms), this.bees.object);
  }

  update(camera, dt = 0, ibises = []) {
    this.bees.update(dt, ibises, camera);
  }

  height(x, z) {
    let h = 0;
    for (const p of this.patches) h = Math.max(h, top(p, x, z));
    return this.ground.height(x, z) + h;
  }
}

// A patch: edge, clumps, heads, head tops (for the bees) and bee count.
function patch({ at, radius = 1.2, bees = [0, 3] }, r, ground) {
  const { clumps, clump, flowers, inner, head, stem } = CLOVER;
  const range = ([a, b]) => a + (b - a) * r();
  const p = { at, radius, phase: r() * 6.3, clumps: [], heads: [], tops: [] };
  p.bees = Array.isArray(bees) ? bees[0] + Math.floor(r() * (bees[1] - bees[0] + 1)) : bees;
  const area = Math.PI * radius * radius;
  const spot = u => {
    const a = r() * 2 * Math.PI, d = u * Math.sqrt(r()) * edgeAt(p, a);
    return [at[0] + Math.cos(a) * d, at[1] + Math.sin(a) * d];
  };
  for (let i = 0, count = Math.round(clumps * area); i < count; i++) {
    const [x, z] = spot(0.85);
    if (ground.kind(x, z) === 'grass') p.clumps.push({ x, z, radius: range(clump.radius), height: range(clump.height) });
  }
  for (let i = 0, count = Math.round(flowers * area); i < count; i++) {
    const [x, z] = spot(inner), size = range(head);
    if (ground.kind(x, z) !== 'grass') continue;
    const leaves = ground.height(x, z) + top(p, x, z), y = leaves + range(stem);
    p.heads.push({ x, y, z, size, leaves });
    p.tops.push(new Vector3(x, y + 0.85 * size, z));
  }
  return p;
}

// Patch radius at angle a.
const edgeAt = (p, a) => p.radius * (1 - CLOVER.edge * (0.5 + 0.3 * Math.sin(3 * a + p.phase) + 0.2 * Math.sin(5 * a + 2 * p.phase)));

// Base height over the ground.
function low(p, x, z) {
  const dx = x - p.at[0], dz = z - p.at[1], u = Math.hypot(dx, dz) / edgeAt(p, Math.atan2(dz, dx));
  return u >= 1 ? 0 : Math.pow(1 - u ** 4, 0.6) * CLOVER.height - SINK;
}

// Clover height over the ground: the base or the highest clump.
function top(p, x, z) {
  let h = low(p, x, z);
  for (const c of p.clumps) {
    const t = 1 - ((x - c.x) ** 2 + (z - c.z) ** 2) / (c.radius * c.radius);
    if (t > 0) h = Math.max(h, c.height * Math.sqrt(t) - SINK);
  }
  return Math.max(h, 0);
}

// The base: a polar grid.
function base(p, ground) {
  const { rings, segments } = CLOVER, pos = [], index = [];
  const at = (x, z) => pos.push(x, ground.height(x, z) + low(p, x, z), z);
  at(...p.at);
  for (let i = 1; i <= rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = j / segments * 2 * Math.PI, d = Math.min(i / rings, 0.9999) * edgeAt(p, a);
      at(p.at[0] + Math.cos(a) * d, p.at[1] + Math.sin(a) * d);
    }
  }
  const v = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * segments + (j % segments));
  for (let j = 0; j < segments; j++) index.push(0, v(1, j + 1), v(1, j));
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segments; j++) index.push(v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i + 1, j));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A clump: half a flat ellipsoid.
function dome({ x, z, radius, height }, ground) {
  return new SphereGeometry(1, 14, 5, 0, 2 * Math.PI, 0, Math.PI / 2).scale(radius, height, radius).translate(x, ground.height(x, z) - SINK, z);
}

// A stem: from in the leaves to the head.
function stalk({ x, y, z, leaves }) {
  const from = leaves - 0.06;
  return new CylinderGeometry(0.008, 0.011, y - from, 4, 1, true).translate(x, (y + from) / 2, z);
}

// A head: a ball, a little flat.
function ball({ x, y, z, size }) {
  return new SphereGeometry(size, 10, 7).scale(1, 0.85, 1).translate(x, y, z);
}
