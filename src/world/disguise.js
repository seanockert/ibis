// Disguises: rubbish that the ibis hides in, as a hermit crab in a shell. A peck near a loose one puts
// the bird in it: only its legs show under it, and two eyes peek out of the front. A peck in it hops
// out. The bird can carry a prop in and out. The miners (sentry.js, gaze) only notice a disguise that
// moves while they look at it.
//
//   const box = new Disguise(physics, asset, { as: 'box', at: [x, z], heading, base, size });
//   const hiding = new Hiding(level, disguises);   // Level.populate() makes it
//   hiding.steer(ibis);                           // before ibis.update(): the speed in a disguise
//   hiding.update(dt, camera);                    // after the props update
//   hiding.target(ibis);                          // the loose disguise a peck goes into now, or null
//
// A loose disguise is one heavy box body with the mesh of the real prop (a Box or a Bin from props.js,
// made in a world of its own that never steps). In use, it has no body: the mesh follows the bird.
import { CircleGeometry, Group, Vector3 } from 'three';
import { Physics, yaw } from './physics.js';
import { Bin, Box, Rest, toonParts } from './props.js';
import { srgb } from './util.js';

// Each kind: speed (part of the walk speed in it), slow (the miners' meter fills this many times slower
// while it moves: a bin looks more at home than a box that walks), mass (loose). lift: the mesh is this
// high over the feet, so the legs show. reach, ahead: a peck goes in when its side is this near a point
// ahead of the bird (on the ground).
export const DISGUISE = {
  box: { speed: 0.85, slow: 1, mass: 1.5 },
  bin: { speed: 0.5, slow: 2.2, mass: 4 },
  lift: 0.42, reach: 0.9, ahead: 0.9,
  // Waddle in use: side to side tilt (radians) and bob (units) at full speed; steps per unit walked.
  waddle: { tilt: 0.07, bob: 0.05, rate: 3.2 },
  // Eyes in a dark peep hole on the front, at the bird's eye height (over the disguise's bottom), at most
  // top below the top: radius, pupil radius, gap between them; the hole's width and height.
  eye: { r: 0.12, pupil: 0.06, gap: 0.3, at: 1.5, top: 0.3, hole: [0.8, 0.36] },
};
const WHITE = [srgb(0.98, 0.97, 0.94), srgb(0.80, 0.80, 0.86), srgb(0.10, 0.10, 0.14)];
const INK = [srgb(0.10, 0.10, 0.14), srgb(0.08, 0.08, 0.12)];
const HOLE = [srgb(0.16, 0.12, 0.12), srgb(0.12, 0.09, 0.10), srgb(0.10, 0.07, 0.06)];
const LEGS = [3];   // the part group of the legs (tools/bake/bake.js)

export class Disguise {
  static footprint({ as, size, small = false }) {
    return as === 'bin' ? Bin.footprint({ small }) : Box.footprint({ size });
  }

  // as: 'box' (size: [x, y, z]) or 'bin' (small, lid: as the Bin).
  constructor(physics, asset, { as = 'box', at: [x, z], heading = 0, base = 0, size = [1.5, 1.6, 1.3], small = false, lid = 'red' }) {
    this.physics = physics;
    this.as = as;
    this.disguise = DISGUISE[as];
    this.slow = this.disguise.slow;
    this.events = [];
    this.wearer = null;
    // The real prop's mesh, from a world of its own, with its bottom at 0.
    const own = new Physics();
    const prop = as === 'bin' ? new Bin(own, asset, { at: [0, 0], small, lid }) : new Box(own, asset, { at: [0, 0], size });
    const { half, height } = Disguise.footprint({ as, size, small });
    this.size = as === 'bin' ? [prop.half[0] * 2, height, prop.half[2] * 2] : [...size];
    this.half = this.size.map(v => v / 2);
    this.line = prop.tub.children[1];   // the outline of the tub, for the highlight
    this.look = new Group().add(prop.object);
    this.look.position.y = -this.size[1] / 2;   // the body's middle is the origin
    this.eyes = eyes(asset, this.half);
    this.eyes.visible = false;
    this.object = new Group().add(this.look, this.eyes);
    this.reachHalf = half;
    this.waddle = 0;
    this.blink = 0;
    this.addBody([x, base + this.size[1] / 2, z], yaw(heading));
  }

  addBody(position, quaternion) {
    this.id = this.physics.addBox(this.size, { position, quaternion, mass: this.disguise.mass, friction: 0.8, com: -this.size[1] * 0.25 });
    this.rest = new Rest(this.physics, [this.id]);
    this.place();
  }

  place() {
    const body = this.physics.body(this.id);
    this.object.position.fromArray(body.position);
    this.object.quaternion.fromArray(body.quaternion);
  }

  // The bird goes in: no body, and the mesh follows it.
  enter(ibis) {
    this.wearer = ibis;
    this.physics.remove(this.id);
    this.id = null;
    this.eyes.visible = true;
  }

  // The bird hops out forward: the disguise stays behind it, a body again.
  leave() {
    const c = this.wearer.character, h = c.heading, back = this.half[2] + 0.5;
    const at = new Vector3(c.position.x - Math.sin(h) * back, 0, c.position.z - Math.cos(h) * back);
    this.wearer = null;
    this.eyes.visible = false;
    this.object.rotation.z = 0;
    this.addBody([at.x, c.position.y + this.size[1] / 2 + 0.02, at.z], yaw(h));
  }

  // In use: on the bird, turned with it, waddling as it walks. Eyes blink.
  follow(dt) {
    const c = this.wearer.character, W = DISGUISE.waddle, speed = Math.abs(c.controller.speed);
    this.waddle += speed * dt * W.rate * Math.PI;
    const k = Math.min(speed / 1.0, 1);
    this.object.position.set(c.position.x, c.position.y + DISGUISE.lift + this.size[1] / 2 + W.bob * k * Math.abs(Math.sin(this.waddle)), c.position.z);
    this.object.rotation.set(0, c.heading, W.tilt * k * Math.sin(this.waddle));
    this.blink += dt;
    const b = this.blink % 3.7;
    this.eyes.scale.y = b < 0.12 ? 0.15 : 1;
  }

  update(ibises, dt) {
    if (this.wearer) this.follow(dt);   // after the physics step, so it is where the bird is now
    else if (!this.rest.still()) this.place();
  }

  solids() { return this.id === null ? [] : [{ body: this.physics.body(this.id), half: this.half }]; }

  // The outline for the highlight (highlight.js): id is the disguise itself (Hiding.target()).
  hull(id) {
    if (id !== this || this.wearer) return null;
    this.line.updateWorldMatrix(true, false);
    return { geometry: this.line.geometry, matrix: this.line.matrixWorld };
  }

  // Distance on the ground from a world point to the side of the loose body, or Infinity.
  distance(p) {
    if (this.id === null) return Infinity;
    const body = this.physics.body(this.id), q = body.quaternion;
    const h = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[2] * q[2]));
    const dx = p.x - body.position[0], dz = p.z - body.position[2];
    const lx = dx * Math.cos(h) - dz * Math.sin(h), lz = dx * Math.sin(h) + dz * Math.cos(h);
    return Math.hypot(Math.max(Math.abs(lx) - this.half[0], 0), Math.max(Math.abs(lz) - this.half[2], 0));
  }
}

// Two cartoon eyes in a peep hole on the front (+z) of the disguise.
function eyes(asset, half) {
  const E = DISGUISE.eye, y = Math.min(E.at, 2 * half[1] - E.top) - half[1], z = half[2] + 0.012;
  const hole = new CircleGeometry(0.5, 24).scale(...E.hole, 1);
  const parts = [[hole, HOLE, [0, y, z - 0.004]]];
  for (const side of [-1, 1]) {
    parts.push([new CircleGeometry(E.r, 20), WHITE, [side * E.gap / 2, y, z]]);
    parts.push([new CircleGeometry(E.pupil, 16), INK, [side * E.gap / 2 + side * 0.01, y - 0.02, z + 0.006]]);
  }
  return new Group().add(...toonParts(parts, asset.uniforms));
}

export class Hiding {
  constructor(level, disguises) {
    this.level = level;
    this.disguises = disguises;
    this.events = [];
    // A peck goes into a disguise in reach (or hops out): Character.act() asks.
    for (const ibis of level.ibises) ibis.character.canHide = () => this.target(ibis) !== null;
  }

  // The loose disguise a peck goes into: the nearest within DISGUISE.reach of a point DISGUISE.ahead in
  // front of the bird, so not the one it just left (behind it). Null in one already, or when the peck
  // would take a prop (loot wins).
  target(ibis) {
    const c = ibis.character;
    if (c.inside || this.level.physics.target(ibis) !== null) return null;
    const at = new Vector3(c.position.x + DISGUISE.ahead * Math.sin(c.heading), 0, c.position.z + DISGUISE.ahead * Math.cos(c.heading));
    let best = null, near = DISGUISE.reach;
    for (const d of this.disguises) {
      const dist = d.wearer ? Infinity : d.distance(at);
      if (dist < near) { near = dist; best = d; }
    }
    return best;
  }

  // In a disguise: slower, no run, no jump.
  steer(ibis) {
    const c = ibis.character, d = c.inside;
    if (!d) return;
    c.input.move.multiplyScalar(d.disguise.speed);
    c.input.fast = false;
    c.input.jump = false;
  }

  update() {
    this.events = [];
    const { level } = this;
    for (const ibis of level.ibises) {
      const c = ibis.character;
      const hit = ibis === level.player && level.fliers.some(f => f.events.some(e => e.type === 'hit'));
      if (c.inside && (c.hop || hit)) this.leave(ibis);
      else if (c.hop) { const d = this.target(ibis); if (d) this.enter(ibis, d); }
      c.hop = false;
    }
  }

  enter(ibis, d) {
    const c = ibis.character;
    d.enter(ibis);
    c.inside = d;
    ibis.showOnly(LEGS);
    // The prop in the bill would poke out: hide it while in.
    const id = this.level.physics.birds.find(b => b.ibis === ibis)?.held ?? null;
    d.carried = id === null ? null : this.level.props.find(p => p.id === id) ?? null;
    if (d.carried) d.carried.object.visible = false;
    c.events.push({ type: 'pick', hold: 'round' });   // a soft pop (sound.js)
    this.level.fx.impact(ibis.object.position.clone().setY(ibis.object.position.y + 0.3));
    this.events.push({ type: 'in', ibis, as: d.as });
  }

  leave(ibis) {
    const c = ibis.character, d = c.inside;
    d.leave();
    c.inside = null;
    ibis.showOnly(null);
    if (d.carried) d.carried.object.visible = true;
    d.carried = null;
    this.level.fx.impact(d.object.position.clone());
    this.events.push({ type: 'out', ibis, as: d.as });
  }

}

