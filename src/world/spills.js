// Spills: patches of mess on the ground that the bird slides on (src/world/combo.js). A tipped bin
// spills its rubbish, a squashed cereal box spills flakes, and a level can start with puddles. Each patch
// is an ellipse: a flat toon blob on the ground with bits of rubbish on it. It grows in when it spills.
//
//   const spills = new Spills(scene, asset, height);
//   spills.add({ at: [x, z], radii: [along, across], angle, kind: 'rubbish' });
//   spills.at(x, z)     // true on a patch
//   spills.update(dt)   // the grow in
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group } from 'three';
import { hash } from '../ibis/motion/spring.js';
import { toonParts } from './props.js';
import { srgb } from './util.js';

// grow: seconds to full size. lift: over the ground. rings, around: of the blob mesh. wobble: of the
// edge (part of the radius). bits: pieces of rubbish for each square unit, and their size range.
export const SPILL = { grow: 0.35, lift: 0.035, rings: 4, around: 32, wobble: 0.18, size: [0.08, 0.22] };

const pair = (r, g, b, k = 0.78) => [srgb(r, g, b), srgb(r * k, g * k * 0.95, b * k * 1.05)];
// Each kind: the colour of the blob, and the colours of its bits and how many for each square unit.
const KINDS = {
  rubbish: { blob: pair(0.58, 0.49, 0.36), bits: [pair(0.96, 0.94, 0.88), pair(0.98, 0.80, 0.36), pair(0.95, 0.55, 0.22), pair(0.80, 0.24, 0.22), pair(0.56, 0.74, 0.32)], density: 3.2 },
  cereal: { blob: pair(0.86, 0.72, 0.46), bits: [pair(0.95, 0.78, 0.40), pair(0.90, 0.66, 0.30)], density: 9 },
  puddle: { blob: pair(0.52, 0.60, 0.66), bits: [], density: 0 },
};

export class Spills {
  // height(x, z): the ground height.
  constructor(scene, asset, height) {
    Object.assign(this, { scene, asset, height });
    this.list = [];   // { x, z, a, b, cos, sin, object, t }
  }

  // at: [x, z]. radii: half length along angle (the heading, as the bird's) and across.
  add({ at: [x, z], radii: [a, b], angle = 0, kind = 'rubbish', seed = this.list.length, grown = false }) {
    const K = KINDS[kind], cos = Math.cos(angle), sin = Math.sin(angle);
    // Local x across, local z along (heading angle faces (sin, cos)).
    const world = (u, v) => [x + u * cos + v * sin, z - u * sin + v * cos];
    const edge = f => 1 + SPILL.wobble * (Math.sin(3 * f + seed) * 0.6 + Math.sin(5 * f + 2 * seed) * 0.4);
    // The blob: rings round the middle, each vertex on the ground.
    const pos = [], idx = [], { rings, around } = SPILL;
    const vertex = (u, v) => { const [wx, wz] = world(u, v); pos.push(wx - x, this.height(wx, wz) + SPILL.lift, wz - z); };
    vertex(0, 0);
    for (let r = 1; r <= rings; r++) for (let i = 0; i < around; i++) {
      const f = 2 * Math.PI * i / around, k = r / rings * edge(f);
      vertex(b * k * Math.cos(f), a * k * Math.sin(f));
    }
    for (let i = 0; i < around; i++) {
      const j = (i + 1) % around;
      idx.push(0, 1 + j, 1 + i);
      for (let r = 1; r < rings; r++) {
        const o = 1 + (r - 1) * around, n = o + around;
        idx.push(o + i, o + j, n + i, o + j, n + j, n + i);
      }
    }
    const blob = new BufferGeometry();
    blob.setAttribute('position', new Float32BufferAttribute(pos, 3));
    blob.setIndex(idx);
    blob.computeVertexNormals();
    const parts = [[blob, K.blob]];
    // Bits of rubbish: small flat boxes, turned at random, half in the blob.
    const n = Math.round(K.density * Math.PI * a * b);
    for (let i = 0; i < n; i++) {
      const h = k => hash(seed * 131 + i * 17 + k);
      const f = 2 * Math.PI * h(1), d = Math.sqrt(h(2)) * 0.85;
      const s = SPILL.size[0] + (SPILL.size[1] - SPILL.size[0]) * h(3);
      const u = b * d * Math.cos(f), v = a * d * Math.sin(f), [wx, wz] = world(u, v);
      const g = new BoxGeometry(s, s * 0.35, s * (0.5 + h(4))).rotateY(h(5) * 6.28).rotateX((h(6) - 0.5) * 0.5);
      parts.push([g, K.bits[Math.floor(h(7) * K.bits.length)], [wx - x, this.height(wx, wz) + SPILL.lift + s * 0.08, wz - z]]);
    }
    const object = new Group().add(...toonParts(parts, this.asset.uniforms));
    for (const m of object.children) { m.castShadow = false; m.renderOrder = -1; }
    object.position.set(x, 0, z);
    const spill = { x, z, a, b, cos, sin, object, t: grown ? SPILL.grow : 0 };
    this.grow(spill);
    this.scene.add(object);
    this.list.push(spill);
    return spill;
  }

  // True when x, z is on a patch (only the part that has grown in).
  at(x, z) {
    for (const s of this.list) {
      const dx = x - s.x, dz = z - s.z, k = Math.min(s.t / SPILL.grow, 1);
      const u = dx * s.cos - dz * s.sin, v = dx * s.sin + dz * s.cos;
      if (k > 0.5 && (u / s.b) ** 2 + (v / s.a) ** 2 < k * k) return true;
    }
    return false;
  }

  update(dt) {
    for (const s of this.list) if (s.t < SPILL.grow) { s.t += dt; this.grow(s); }
  }

  grow(s) {
    const k = Math.min(s.t / SPILL.grow, 1), e = 1 - (1 - k) ** 3;
    s.object.scale.set(e, 1, e);
  }
}
