// Set pieces and loot of a back yard (src/levels/barbie.json): a timber deck with steps, the back wall of
// the house, a barbecue, a Hills Hoist (a rotary clothes line that turns in the wind), a picnic rug,
// fairy bread (the loot) and the nest (the goal). Sizes for a bird 2 units tall (1 unit is about 35 cm).
//
// The static pieces are terrain in the physics (the bird walks on the deck and the steps, and bumps the
// barbecue and the hoist pole). The deck and the barbecue go before the props on them in the level
// list, so stack() (place.js) puts those on top.
import { CapsuleGeometry, CircleGeometry, CylinderGeometry, ExtrudeGeometry, Group, OctahedronGeometry, PlaneGeometry, Shape, SphereGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hash } from '../ibis/motion/spring.js';
import { yaw } from './physics.js';
import { Rest, toonParts } from './props.js';
import { srgb } from './util.js';

// lit, shade, line.
const C = {
  timber: [srgb(0.80, 0.58, 0.38), srgb(0.58, 0.40, 0.33), srgb(0.30, 0.18, 0.12)],
  timberDark: [srgb(0.62, 0.43, 0.29), srgb(0.44, 0.30, 0.26), srgb(0.24, 0.14, 0.10)],
  groove: [srgb(0.45, 0.30, 0.20), srgb(0.34, 0.22, 0.19)],
  board: [srgb(0.97, 0.88, 0.66), srgb(0.80, 0.70, 0.62), srgb(0.40, 0.30, 0.22)],
  boardLine: [srgb(0.84, 0.74, 0.54), srgb(0.68, 0.58, 0.52)],
  trim: [srgb(0.40, 0.55, 0.46), srgb(0.28, 0.40, 0.40), srgb(0.12, 0.18, 0.18)],
  glass: [srgb(0.45, 0.60, 0.72), srgb(0.30, 0.40, 0.56), srgb(0.12, 0.16, 0.24)],
  roof: [srgb(0.78, 0.38, 0.26), srgb(0.55, 0.25, 0.25), srgb(0.28, 0.10, 0.10)],
  steel: [srgb(0.72, 0.74, 0.78), srgb(0.50, 0.52, 0.62), srgb(0.20, 0.21, 0.28)],
  charcoal: [srgb(0.27, 0.28, 0.32), srgb(0.17, 0.18, 0.23), srgb(0.07, 0.07, 0.10)],
  gas: [srgb(0.90, 0.85, 0.82), srgb(0.70, 0.66, 0.72), srgb(0.30, 0.26, 0.28)],
  wire: [srgb(0.40, 0.42, 0.48), srgb(0.30, 0.32, 0.40)],
  towelA: [srgb(0.98, 0.62, 0.55), srgb(0.75, 0.42, 0.45), srgb(0.40, 0.18, 0.20)],
  towelB: [srgb(0.50, 0.78, 0.88), srgb(0.34, 0.56, 0.70), srgb(0.14, 0.26, 0.36)],
  rugRed: [srgb(0.86, 0.26, 0.24), srgb(0.60, 0.17, 0.24)],
  rugWhite: [srgb(0.98, 0.95, 0.90), srgb(0.78, 0.76, 0.82)],
  rugLine: [srgb(0.98, 0.95, 0.90), srgb(0.78, 0.76, 0.82), srgb(0.42, 0.12, 0.14)],
  bread: [srgb(0.99, 0.97, 0.90), srgb(0.82, 0.80, 0.80), srgb(0.55, 0.40, 0.26)],
  twig: [srgb(0.58, 0.44, 0.30), srgb(0.38, 0.28, 0.24), srgb(0.20, 0.13, 0.09)],
  twigDark: [srgb(0.40, 0.30, 0.21), srgb(0.27, 0.19, 0.17)],
  marker: [srgb(1.0, 0.86, 0.25), srgb(0.92, 0.62, 0.20), srgb(0.30, 0.18, 0.06)],
  lemon: [srgb(1.0, 0.88, 0.22), srgb(0.88, 0.62, 0.18), srgb(0.42, 0.28, 0.06)],
  lemonTip: [srgb(0.92, 0.80, 0.20), srgb(0.78, 0.56, 0.16)],
  stalk: [srgb(0.40, 0.50, 0.22), srgb(0.28, 0.36, 0.20)],
};
const SPRINKLES = [srgb(0.98, 0.36, 0.56), srgb(0.99, 0.84, 0.22), srgb(0.30, 0.66, 0.98), srgb(0.40, 0.84, 0.44), srgb(0.99, 0.56, 0.20), srgb(0.70, 0.45, 0.95)];

const SOLID_DEPTH = 1.5;   // static hulls go this far below their base, into the ground

// A static box hull in the physics: world centre x, z, from y0 to y1, size w by d, turned by heading.
function terrainBox(physics, [x, z], y0, y1, [w, d], heading = 0) {
  const cs = Math.cos(heading), sn = Math.sin(heading), pts = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = u * w / 2, lz = v * d / 2;
    pts.push(x + lx * cs + lz * sn, y0, z - lx * sn + lz * cs, x + lx * cs + lz * sn, y1, z - lx * sn + lz * cs);
  }
  physics.addTerrain(pts);
}

// A deck: a timber platform raise over the highest ground under it, axis aligned, with steps. size:
// [x, z]. steps: [{ side: 'front' (-z) | 'back' | 'left' (-x) | 'right', at: offset along the side,
// width }]. Each flight goes down to the ground in steps of DECK.rise (under the bird's step up).
export const DECK = { rise: 0.2, run: 0.55, slab: 0.14, plank: 0.4 };

export class Deck {
  static footprint({ size: [w, d], raise = 0.6 }) { return { half: [w / 2, d / 2], height: raise }; }

  // height: the ground (the level gives it).
  constructor(physics, asset, { at: [x, z], size: [w, d], raise: h = 0.6, steps = [], base = 0, height: ground }) {
    this.events = [];
    const top = base + h;
    this.top = top;
    terrainBox(physics, [x, z], base - SOLID_DEPTH, top, [w, d]);
    const parts = [
      [new RoundedBoxGeometry(w, DECK.slab, d, 2, 0.03), C.timber, [x, top - DECK.slab / 2, z]],
      [new RoundedBoxGeometry(w - 0.2, h + SOLID_DEPTH, d - 0.2, 1, 0.02), C.timberDark, [x, top - (h + SOLID_DEPTH) / 2 - DECK.slab, z]],
    ];
    // Grooves between the planks, along x.
    for (let k = 1; k < d / DECK.plank; k++) parts.push([new PlaneGeometry(w - 0.06, 0.035).rotateX(-Math.PI / 2), C.groove, [x, top + 0.004, z - d / 2 + k * DECK.plank]]);
    for (const s of steps) {
      // Outward direction and the along-side axis.
      const out = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] }[s.side];
      const along = [out[1] !== 0 ? 1 : 0, out[0] !== 0 ? 1 : 0];
      const edge = [x + out[0] * w / 2 + along[0] * (s.at ?? 0), z + out[1] * d / 2 + along[1] * (s.at ?? 0)];
      // Steps of DECK.rise down from the top, out until the next would be under the ground there.
      for (let i = 0; i < 40; i++) {
        const y1 = top - (i + 1) * DECK.rise, c = [edge[0] + out[0] * DECK.run * (i + 0.5), edge[1] + out[1] * DECK.run * (i + 0.5)];
        const low = ground(...c);
        if (y1 < low + 0.02) break;
        const size = out[0] !== 0 ? [DECK.run, s.width] : [s.width, DECK.run];
        terrainBox(physics, c, low - SOLID_DEPTH, y1, size);
        const hgt = y1 - (low - 0.3);
        parts.push([new RoundedBoxGeometry(size[0], hgt, size[1], 1, 0.02), i % 2 ? C.timberDark : C.timber, [c[0], y1 - hgt / 2, c[1]]]);
      }
    }
    this.object = new Group().add(...toonParts(parts, asset.uniforms));
  }

  update() {}
}

// The back wall of the house: weatherboards, a sliding door, a window, a tiled roof edge. A wall in the
// physics. at: the middle of the wall's foot. width along x; the wall faces -z.
export const HOUSE = { height: 7, board: 0.42, door: [4.2, 4.6], window: [4, 2.6], eave: 1.4 };

export class House {
  static footprint({ width = 30 }) { return { half: [width / 2, 0.3], height: 0.01 }; }

  constructor(physics, asset, { at: [x, z], width = 30, door = 0, window: win = 8, base = 0 }) {
    this.events = [];
    const H = HOUSE, y0 = base - 2;
    terrainBox(physics, [x, z + 0.3], y0 - SOLID_DEPTH, base + H.height, [width, 0.6]);
    const parts = [[new RoundedBoxGeometry(width, H.height - y0 + base, 0.6, 1, 0.02), C.board, [x, (y0 + base + H.height) / 2, z + 0.3]]];
    for (let y = y0 + H.board; y < base + H.height; y += H.board) parts.push([new PlaneGeometry(width - 0.1, 0.04), C.boardLine, [x, y, z - 0.005]]);
    const doorY = base + H.door[1] / 2, winY = base + 3.3;
    parts.push([new RoundedBoxGeometry(H.door[0] + 0.3, H.door[1] + 0.3, 0.1, 1, 0.02), C.trim, [x + door, doorY + 0.15, z - 0.03]]);
    parts.push([new PlaneGeometry(H.door[0], H.door[1]), C.glass, [x + door, doorY, z - 0.09]]);
    parts.push([new PlaneGeometry(0.08, H.door[1]), C.trim, [x + door, doorY, z - 0.1]]);
    parts.push([new RoundedBoxGeometry(H.window[0] + 0.3, H.window[1] + 0.3, 0.1, 1, 0.02), C.trim, [x + win, winY, z - 0.03]]);
    parts.push([new PlaneGeometry(...H.window), C.glass, [x + win, winY, z - 0.09]]);
    // Roof: a slope of tiles over the wall, and a gutter.
    const roof = new Shape([{ x: -H.eave, y: 0 }, { x: 4, y: 2.2 }, { x: 4, y: 2.5 }, { x: -H.eave, y: 0.3 }]);
    parts.push([new ExtrudeGeometry(roof, { depth: width + 1, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(width / 2 + 0.5, 0, 0), C.roof, [x, base + H.height, z]]);
    parts.push([new CylinderGeometry(0.12, 0.12, width + 1, 10).rotateZ(Math.PI / 2), C.steel, [x, base + H.height, z - H.eave]]);
    this.object = new Group().add(...toonParts(parts, asset.uniforms));
  }

  update() {}
}

// A barbecue: a charcoal hood on a steel trolley with a side shelf and a gas bottle. A miner can sit on
// the hood (perch()).
export const BBQ = { size: [1.7, 1.55, 0.85] };

export class Barbecue {
  static footprint() { return { half: [BBQ.size[0] / 2 + 0.5, BBQ.size[2] / 2], height: BBQ.size[1] }; }

  constructor(physics, asset, { at: [x, z], heading = 0, base = 0 }) {
    this.events = [];
    const [w, h, d] = BBQ.size;
    terrainBox(physics, [x, z], base - SOLID_DEPTH, base + h, [w, d], heading);
    const parts = [
      [new RoundedBoxGeometry(w, 0.45, d, 2, 0.12), C.charcoal, [0, h - 0.22, 0]],
      [new RoundedBoxGeometry(w * 1.02, 0.22, d * 1.02, 2, 0.04), C.charcoal, [0, h - 0.56, 0]],
      [new RoundedBoxGeometry(0.7, 0.05, d * 0.9, 1, 0.02), C.steel, [w / 2 + 0.35, h - 0.62, 0]],
      [new CylinderGeometry(0.05, 0.05, 0.6, 8).rotateZ(Math.PI / 2), C.steel, [0, h - 0.18, -d / 2 - 0.08]],
      [new CylinderGeometry(0.22, 0.22, 0.7, 14), C.gas, [-w / 2 + 0.3, 0.35, 0.05]],
    ];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push([new CylinderGeometry(0.04, 0.04, h - 0.6, 6), C.steel, [sx * (w / 2 - 0.1), (h - 0.6) / 2, sz * (d / 2 - 0.1)]]);
    this.object = new Group().add(...toonParts(parts, asset.uniforms));
    this.object.position.set(x, base, z);
    this.object.rotation.y = heading;
    this.spot = new Vector3(x, base + h, z);
    this.face = new Vector3(-Math.sin(heading), 0, -Math.cos(heading));
  }

  perch(out = new Vector3()) { return out.copy(this.spot); }

  update() {}
}

// A Hills Hoist: a rotary clothes line on a steel pole. The arms turn slowly in the wind (spin, radians
// per second), with two towels on the lines. A miner can sit on the top of the pole (perch()).
export const HOIST = { pole: 5.0, radius: 4.2, droop: 0.35, lines: [1.5, 2.5, 3.5] };

export class HillsHoist {
  static footprint() { return { half: [0.2, 0.2], height: HOIST.pole }; }

  constructor(physics, asset, { at: [x, z], spin = 0.3, base = 0 }) {
    this.events = [];
    this.spin = spin;
    this.angle = 0;
    const H = HOIST;
    terrainBox(physics, [x, z], base - SOLID_DEPTH, base + H.pole, [0.16, 0.16]);
    const pole = toonParts([
      [new CylinderGeometry(0.07, 0.08, H.pole, 10), C.steel, [0, H.pole / 2, 0]],
      [new CylinderGeometry(0.13, 0.13, 0.12, 12), C.steel, [0, H.pole, 0]],
    ], asset.uniforms);
    // The arms out from a collar under the top, a little down at the ends. The lines: a square at each
    // radius, between the arms.
    const hub = H.pole - 0.25, arms = [], y = r => hub - H.droop * r / H.radius;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, dir = new Vector3(Math.sin(a), 0, Math.cos(a));
      const len = Math.hypot(H.radius, H.droop), mid = dir.clone().multiplyScalar(H.radius / 2).setY(hub - H.droop / 2);
      const g = new CylinderGeometry(0.035, 0.035, len, 6).rotateX(Math.PI / 2).rotateX(Math.atan2(H.droop, H.radius)).rotateY(a);
      arms.push([g, C.steel, mid.toArray()]);
    }
    for (const r of H.lines) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, side = r * Math.SQRT2;
      const mid = new Vector3(Math.sin(a) * r / Math.SQRT2, y(r) - 0.01, Math.cos(a) * r / Math.SQRT2);
      arms.push([new CylinderGeometry(0.012, 0.012, side, 4).rotateZ(Math.PI / 2).rotateY(a), C.wire, mid.toArray()]);
    }
    // Two towels, pegged on lines.
    for (const [r, a, colour] of [[2.5, Math.PI / 4, C.towelA], [3.5, Math.PI * 1.25, C.towelB]]) {
      const mid = new Vector3(Math.sin(a) * r / Math.SQRT2, y(r) - 0.8, Math.cos(a) * r / Math.SQRT2);
      arms.push([new RoundedBoxGeometry(1.6, 1.5, 0.04, 1, 0.015).rotateY(a), colour, mid.toArray()]);
    }
    this.arms = new Group().add(...toonParts(arms, asset.uniforms));
    this.object = new Group().add(...pole, this.arms);
    this.object.position.set(x, base, z);
    this.spot = new Vector3(x, base + H.pole + 0.06, z);
  }

  perch(out = new Vector3()) { return out.copy(this.spot); }

  update(ibises, dt = 0) {
    this.angle += this.spin * dt;
    this.arms.rotation.y = this.angle;
  }
}

// A picnic rug: a red and white check, flat on what it lies on. No body.
export const RUG = { check: 0.4 };

export class Rug {
  static footprint({ size: [w, d] }) { return { half: [w / 2, d / 2], height: 0.02 }; }

  constructor(physics, asset, { at: [x, z], size: [w, d], heading = 0, base = 0 }) {
    this.events = [];
    const n = [Math.round(w / RUG.check), Math.round(d / RUG.check)], parts = [];
    for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) {
      parts.push([new PlaneGeometry(w / n[0], d / n[1]).rotateX(-Math.PI / 2), (i + j) % 2 ? C.rugRed : C.rugWhite, [(i + 0.5) * w / n[0] - w / 2, 0.012, (j + 0.5) * d / n[1] - d / 2]]);
    }
    parts.push([new RoundedBoxGeometry(w, 0.012, d, 1, 0.004), C.rugLine, [0, 0.006, 0]]);
    this.object = new Group().add(...toonParts(parts, asset.uniforms));
    this.object.position.set(x, base, z);
    this.object.rotation.y = heading;
  }

  update() {}
}

// Fairy bread: a triangle of white bread with butter and hundreds and thousands, the loot. About 15 cm.
// A light prop that a peck picks up by its edge ('flat' hold, as a cereal box). Its body z is the thin
// side (across the bill), so it lies with z up, sprinkles on top.
export const FAIRY = { size: [0.56, 0.44, 0.1], mass: 0.08, bite: 0.1, sprinkles: 26 };

export class FairyBread {
  static footprint() { return { half: [FAIRY.size[0] / 2, FAIRY.size[1] / 2], height: FAIRY.size[2] }; }

  constructor(physics, asset, { at: [x, z], heading = 0, base = 0, seed = 0 }) {
    const [w, h, d] = FAIRY.size;
    this.physics = physics;
    this.loot = true;
    this.events = [];
    this.half = FAIRY.size.map(v => v / 2);
    const flat = yawFlat(heading);
    this.id = physics.addBox(FAIRY.size, {
      position: [x, base + d / 2 + 0.01, z], quaternion: flat, mass: FAIRY.mass, friction: 0.9, light: true,
      grab: { hold: 'flat', edge: w / 2 - FAIRY.bite },
    });
    this.rest = new Rest(physics, [this.id]);
    // A right triangle across the box, the cut edge from corner to corner.
    const tri = new Shape([{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: -w / 2, y: h / 2 }]);
    const parts = [[new ExtrudeGeometry(tri, { depth: d * 0.8, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.01, bevelSegments: 1 }), C.bread, [0, 0, -d * 0.4]]];
    for (let i = 0; i < FAIRY.sprinkles; i++) {
      // A point in the triangle: u + v < 1.
      let u = hash(seed * 97 + i * 3), v = hash(seed * 97 + i * 3 + 1);
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const px = -w / 2 + 0.04 + u * (w - 0.1), py = -h / 2 + 0.04 + v * (h - 0.1), c = SPRINKLES[i % SPRINKLES.length];
      parts.push([new CapsuleGeometry(0.012, 0.035, 2, 4).rotateZ(hash(i * 5 + seed) * Math.PI), [c, c.clone().multiplyScalar(0.8)], [px, py, d * 0.42]]);
    }
    const meshes = toonParts(parts, asset.uniforms);
    this.line = meshes[1];
    this.object = new Group().add(...meshes);
    this.place();
  }

  place() {
    const body = this.physics.body(this.id);
    this.object.position.fromArray(body.position);
    this.object.quaternion.fromArray(body.quaternion);
  }

  update() { if (!this.rest.still()) this.place(); }

  solids() { return [{ body: this.physics.body(this.id), half: this.half }]; }

  hull(id) {
    if (id !== this.id) return null;
    this.line.updateWorldMatrix(true, false);
    return { geometry: this.line.geometry, matrix: this.line.matrixWorld };
  }

  position(out = new Vector3()) { return out.fromArray(this.physics.body(this.id).position); }
}

// A lemon off the backyard tree: something to throw. About 9 cm, so 0.36 long here, a little big for
// the bird so it reads. A light prop with a 'round' hold, as a stubby.
export const LEMON = { radii: [0.15, 0.15, 0.19], mass: 0.12, restitution: 0.35 };

export class Lemon {
  static footprint() { return { half: [LEMON.radii[0], LEMON.radii[2]], height: 2 * LEMON.radii[1] }; }

  constructor(physics, asset, { at: [x, z], heading = 0, base = 0 }) {
    const [a, b, c] = LEMON.radii;
    this.physics = physics;
    this.events = [];
    this.half = LEMON.radii;
    const pts = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j < 10; j++) {
      const t = Math.PI * i / 8, f = 2 * Math.PI * j / 10, tip = 1 + 0.12 * Math.abs(Math.cos(t)) ** 8;
      pts.push(a * Math.sin(t) * Math.cos(f), b * Math.sin(t) * Math.sin(f), c * Math.cos(t) * tip);
    }
    this.id = physics.addHull(pts, { position: [x, base + b, z], quaternion: yaw(heading), mass: LEMON.mass, light: true, restitution: LEMON.restitution, damping: 0.2, grab: { hold: 'round' } });
    this.rest = new Rest(physics, [this.id]);
    const skin = new SphereGeometry(1, 18, 12).scale(a, b, c);
    const meshes = toonParts([
      [skin, C.lemon],
      [new SphereGeometry(0.035, 8, 6), C.lemonTip, [0, 0, c * 1.02]],
      [new CapsuleGeometry(0.015, 0.05, 2, 4).rotateX(Math.PI / 2), C.stalk, [0, 0, -c - 0.02]],
    ], asset.uniforms);
    this.line = meshes[1];
    this.object = new Group().add(...meshes);
    this.place();
  }

  place() {
    const body = this.physics.body(this.id);
    this.object.position.fromArray(body.position);
    this.object.quaternion.fromArray(body.quaternion);
  }

  update() { if (!this.rest.still()) this.place(); }

  solids() { return [{ body: this.physics.body(this.id), half: this.half, round: true }]; }

  hull(id) {
    if (id !== this.id) return null;
    this.line.updateWorldMatrix(true, false);
    return { geometry: this.line.geometry, matrix: this.line.matrixWorld };
  }
}

// Turned by heading about y, then local z up.
function yawFlat(heading) {
  const s = Math.sin(heading / 2), c = Math.cos(heading / 2), k = Math.SQRT1_2;
  // q = yaw(heading) * rotX(-PI / 2)
  const [ax, ay, az, aw] = [0, s, 0, c], [bx, by, bz, bw] = [-k, 0, 0, k];
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

// The nest: a ring of twigs on the ground, the goal. No body: the bird walks over it.
export const NEST = { radius: 0.9, tube: 0.22, goal: 1.2 };

export class Nest {
  static footprint() { return { half: [NEST.radius + NEST.tube, NEST.radius + NEST.tube], height: 2 * NEST.tube }; }

  constructor(physics, asset, { at: [x, z], heading = 0, height }) {
    this.at = new Vector3(x, height(x, z), z);
    this.nest = true;
    this.events = [];
    const { radius: r, tube: t } = NEST;
    const parts = [
      [new CylinderGeometry(r + t, r + t * 1.2, t * 1.4, 24, 1, true), C.twig, [0, t * 0.7, 0]],
      [new CircleGeometry(r + t * 0.9, 24).rotateX(-Math.PI / 2), C.twigDark, [0, 0.05, 0]],
    ];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + hash(i) * 0.5, len = 0.7 + 0.3 * hash(i + 9);
      const g = new CapsuleGeometry(0.028, len, 2, 5).rotateZ(Math.PI / 2 + 0.3 * (hash(i + 3) - 0.5)).rotateY(-a + 0.6 * (hash(i + 5) - 0.5));
      parts.push([g, C.twig, [(r + t) * Math.cos(a), t * 1.3, (r + t) * Math.sin(a)]]);
    }
    this.object = new Group().add(...toonParts(parts, asset.uniforms));
    this.object.position.copy(this.at);
    this.object.rotation.y = heading;
  }

  update() {}

  // Is a world point in the nest?
  holds(p) { return Math.hypot(p.x - this.at.x, p.z - this.at.z) < NEST.goal && p.y < this.at.y + 0.8; }
}

// A marker that bobs over a point: a yellow diamond with an outline. For the mission view (hud.js).
export function marker(asset) {
  const object = new Group().add(...toonParts([[new OctahedronGeometry(0.26, 0).scale(0.8, 1.3, 0.8), C.marker]], asset.uniforms));
  object.renderOrder = 5;
  return object;
}
