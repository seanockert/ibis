// moves.html: the props of the beak moves, so each move shows what it does: a tennis ball to peck, pick up,
// drop and throw, a garden gnome too big for the bill, hot chips to catch, toss, swallow and flick away,
// and a garden hose to tug. Scripted, with no physics engine: each card's MoveProps reads the starts of
// its actions (start()) and their events (update()).
//
//   const props = makeProps('Tug', asset);   // null for a move with no prop
//   scene.add(props.object);
//   props.start('tug', ibis);   // each c.act()
//   props.update(dt, ibis);     // after ibis.update(dt)
import { CapsuleGeometry, Curve, CylinderGeometry, Group, Matrix4, Quaternion, SphereGeometry, TubeGeometry, Vector3 } from 'three';
import { ITEMS, itemMesh } from '../gulp/items.js';
import { bezier, HEAD_SCALE, solveRig } from '../ibis/rig.js';
import { ACTIONS } from '../ibis/motion/actions.js';
import { Character } from '../ibis/motion/character.js';
import { smoothstep } from '../ibis/motion/spring.js';
import { toonParts } from '../world/props.js';
import { srgb } from '../world/util.js';

const G = 14;   // gravity, units/s^2: less than the game (22), so a throw hangs in the air, as a cartoon
// The bill's grip, head space, before HEAD_SCALE (as GRIP in src/gulp/game.js): a jaw opening and the
// middle of the gap, for a thin and a round thing, and the direction out of the gap.
const GRIP = { flat: [0.37, [0, -0.46, 0.73]], round: [0.7, [0, -0.51, 0.66]], out: [0, -0.89, 0.45] };
const BALL = { radius: 0.1, jaw: 0.37, edge: 0, bounce: 0.55, roll: 1.5 };   // a tennis ball: 6.7 cm
const HOSE = { radius: 0.035, points: 24, segment: 0.14, slack: 0.5, jaw: 0.2, iterations: 16 };
const POP = 0.15;
const GNOME_HEIGHT = 0.62, GNOME_BASE = 0.29;   // ITEMS.gnome: its height, and its feet below its middle   // seconds for a prop to pop in, scale 0 to 1

const C = {
  ball: [srgb(0.86, 0.94, 0.28), srgb(0.56, 0.7, 0.3), srgb(0.24, 0.3, 0.06)],
  seam: [srgb(0.98, 0.98, 0.92), srgb(0.78, 0.8, 0.84)],
  hose: [srgb(0.22, 0.64, 0.32), srgb(0.13, 0.43, 0.32), srgb(0.04, 0.18, 0.08)],
  nozzle: [srgb(0.98, 0.76, 0.2), srgb(0.78, 0.5, 0.22), srgb(0.38, 0.22, 0.04)],
};

const v3 = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

// The grip for a jaw opening: between the flat and the round grip.
function grip(jaw) {
  const [j0, a] = GRIP.flat, [j1, b] = GRIP.round, k = (jaw - j0) / (j1 - j0);
  return a.map((v, i) => v + (b[i] - v) * k);
}

// A head space point (before HEAD_SCALE) in character space, from a rig.
function headPoint(R, h) {
  return v3(...h).multiplyScalar(HEAD_SCALE).applyMatrix4(R.headRot).add(R.head);
}

// The middle of a held thing in character space: the grip for its jaw, and its edge out of the bill.
function holdLocal(R, jaw, edge) {
  const g = grip(jaw), k = edge / HEAD_SCALE;
  return headPoint(R, g.map((v, i) => v + k * GRIP.out[i]));
}

// Character space to world for a character: its place and heading.
function toWorld(c, p, out = v3()) {
  const cs = Math.cos(c.heading), sn = Math.sin(c.heading);
  return out.set(c.position.x + p.x * cs + p.z * sn, c.position.y + p.y, c.position.z - p.x * sn + p.z * cs);
}

// Where a thing of this jaw is in the bill at time t of an action, in character space, from a bird
// that starts that action at rest. jaw 'tip': the tip of the bill. For the place a prop waits on the ground.
const TIP = [0, -0.42, 0.86];   // head space: the bill tip (GRAB.tip in physics.js)
const spots = new Map();
function spotAt(name, t, jaw) {
  const key = `${name}|${t}|${jaw}`;
  if (!spots.has(key)) {
    const c = new Character();
    c.act(name, { fadeIn: 0 });
    for (let s = 0; s < t; s += 1 / 120) c.update(1 / 120);
    const R = solveRig(c.pose);
    spots.set(key, jaw === 'tip' ? headPoint(R, TIP) : holdLocal(R, jaw, 0));
  }
  return spots.get(key).clone();
}

// The swallow bulge (Ibis.bulge 0) at t seconds into the gulp action, for a lump [radius, length]; t < 0:
// none. As Game.bulges() in src/gulp/game.js, with its THROAT numbers.
const THROAT = { pouch: 1.15, lump: 1.2, front: 0.6, top: 0.85 };
const LUMP = 1.5;   // the moveset shows the lump bigger than the game, so it reads at card size
function swallow(ibis, t, [r, len] = [0, 0]) {
  const R = ibis.rig;
  if (t < 0) return ibis.bulge(0, v3(), v3(), 0, 0);
  if (t < 0.3) {
    // A pouch in the throat, under the base of the bill.
    const k = smoothstep(0.08, 0.22, t) * (1 - smoothstep(0.24, 0.3, t));
    return ibis.bulge(0, headPoint(R, [0, -0.36, 0.2]), headPoint(R, [0, -0.36, -0.05]), r * THROAT.pouch, k);
  }
  // Down the neck in three gulps (the beats of the gulp action), then into the belly.
  const s = 1 - (smoothstep(0.32, 0.44, t) + smoothstep(0.54, 0.66, t) + smoothstep(0.76, 0.88, t)) / 3;
  const into = smoothstep(0.86, 1.05, t), span = len / 2 / 0.7;
  const a = bezier(R.neckBase, R.neckCtrl, R.neckTip, Math.min(Math.max(s + span, 0), THROAT.top));
  const b = bezier(R.neckBase, R.neckCtrl, R.neckTip, Math.min(Math.max(s - span, 0), THROAT.top));
  // Out at the front of the throat: the back of the neck stays as it is.
  const along = b.clone().sub(a), front = v3(0, 0, 1);
  if (along.lengthSq() > 1e-6) front.addScaledVector(along.normalize(), -front.dot(along)).normalize();
  a.addScaledVector(front, r * THROAT.front);
  b.addScaledVector(front, r * THROAT.front);
  const belly = v3(0, 0.12, 0).applyMatrix4(R.body).add(R.pelvis);
  a.lerp(belly, into);
  b.lerp(belly, into);
  ibis.bulge(0, a, b, r * THROAT.lump, smoothstep(0.26, 0.32, t) * (1 - into));
}

// The seam of a tennis ball: one closed curve round the sphere.
class Seam extends Curve {
  getPoint(t, out = v3()) {
    const a = 2 * Math.PI * t, k = 0.42;
    return out.set(Math.cos(a) + k * Math.cos(3 * a), Math.sin(a) - k * Math.sin(3 * a), 2 * Math.sqrt(k) * Math.sin(2 * a)).normalize().multiplyScalar(BALL.radius * 1.01);
  }
}

const ballMesh = uniforms => new Group().add(...toonParts([
  [new SphereGeometry(BALL.radius, 18, 12), C.ball],
  [new TubeGeometry(new Seam(), 64, 0.008, 4, true), C.seam],
], uniforms));

// One thing: a ball, a chip, a gnome. state: 'hidden', 'held' (in the bill), 'air' (it falls, bounces
// and rolls), 'rest' (still on the ground), 'in' (it goes into the bill and shrinks: a swallow).
class Thing {
  constructor(mesh, { radius, jaw, edge, bounce = 0.35, roll = 4, up = null }) {
    Object.assign(this, { mesh, radius, jaw, edge, bounce, roll, up });
    this.pos = v3();
    this.vel = v3();
    this.spin = v3();
    this.quat = new Quaternion();
    this.from = v3();
    this.fromQuat = new Quaternion();
    this.state = 'hidden';
    this.t = 0;      // seconds in this state
    this.pop = 1;    // 0 to 1 as it pops in
    mesh.visible = false;
  }

  // Into the bill: from where it is, or at once (with a pop) from nothing.
  hold(c, now = false) {
    this.from.copy(this.pos);
    this.fromQuat.copy(this.quat);
    if (now || this.state === 'hidden') this.pop = 0, this.from.set(NaN, 0, 0);
    this.state = 'held';
    this.t = 0;
    c.controller.carry = this.jaw;
  }

  // Out of the bill (or from where it is) with a velocity in character space (x left, y up, z forward).
  throw(c, [x, y, z], spin = 8) {
    toWorld({ position: v3(), heading: c.heading }, v3(x, y, z), this.vel);
    this.spin.set(Math.cos(c.heading), 0, -Math.sin(c.heading)).multiplyScalar(spin);
    if (this.state === 'held') c.controller.carry = null;
    this.state = 'air';
    this.t = 0;
  }

  // Still on the ground at a character space point, popping in.
  place(c, p, yaw = 0) {
    toWorld(c, p, this.pos);
    this.pos.y = this.radius * (this.up ? 0 : 1) + (this.up?.base ?? 0);
    this.quat.setFromAxisAngle(v3(0, 1, 0), c.heading + yaw);
    if (this.up) this.quat.multiply(this.up.q);
    this.vel.set(0, 0, 0);
    this.state = 'rest';
    this.pop = 0;
    this.t = 0;
  }

  hide() { this.state = 'hidden'; }

  update(dt, ibis) {
    this.t += dt;
    this.pop = Math.min(this.pop + dt / POP, 1);
    const R = ibis.rig, o = ibis.object;
    if (this.state === 'held' || this.state === 'in') {
      const at = o.localToWorld(holdLocal(R, this.jaw, this.edge));
      const q = o.quaternion.clone().multiply(new Quaternion().setFromRotationMatrix(R.headRot)).multiply(HOLD_QUAT);
      if (this.state === 'in') {
        // Into the gap of the open bill, and smaller, to nothing: it stays in the gap, so it does not go
        // through the head.
        const k = smoothstep(0, 0.15, this.t);
        this.pos.copy(at).lerp(o.localToWorld(headPoint(R, [0, -0.25, 0.5])), 0.4 * k);
        this.quat.copy(q);
        this.pop = 1 - k;
        if (k >= 1) this.state = 'hidden';
      } else if (Number.isNaN(this.from.x)) {
        this.pos.copy(at);
        this.quat.copy(q);
      } else {
        const k = smoothstep(0, 0.06, this.t);
        this.pos.copy(this.from).lerp(at, k);
        this.quat.copy(this.fromQuat).slerp(q, k);
      }
    } else if (this.state === 'air') {
      this.vel.y -= G * dt;
      this.pos.addScaledVector(this.vel, dt);
      const turn = this.spin.length();
      if (turn > 0) this.quat.premultiply(new Quaternion().setFromAxisAngle(this.spin.clone().divideScalar(turn), turn * dt));
      if (this.pos.y < this.radius) {
        this.pos.y = this.radius;
        if (this.vel.y < -1.5) {
          this.vel.y *= -this.bounce;
          this.vel.x *= 0.7;
          this.vel.z *= 0.7;
          this.spin.multiplyScalar(0.6);
        } else {
          this.vel.y = 0;
          const f = Math.exp(-this.roll * dt);
          this.vel.multiplyScalar(f);
          this.spin.multiplyScalar(f);
          if (this.vel.lengthSq() < 0.01) this.state = 'rest';
        }
      }
      if (this.t > 4) this.state = 'hidden';
    }
    this.mesh.visible = this.state !== 'hidden';
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    // Pop in: a little over full size, then back.
    const s = this.state === 'in' ? this.pop : this.pop < 1 ? smoothstep(0, 1, this.pop) * (1 + 0.25 * Math.sin(Math.PI * this.pop)) : 1;
    this.mesh.scale.setScalar(Math.max(s, 1e-3) * (this.scale ?? 1));
  }
}

// A held thing lies with its x out of the bill and its y across it (the hold of physics.js).
const HOLD_QUAT = (() => {
  const out = v3(...GRIP.out).normalize(), across = v3(1, 0, 0);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(out, across, v3().crossVectors(out, across)));
})();

// A garden hose on the ground, one end at a tap far in front. The bill grips the other end, by the
// nozzle. Points with Verlet steps and length constraints; drawn as one capsule for each segment.
class Hose {
  constructor(uniforms) {
    const n = HOSE.points;
    this.p = Array.from({ length: n }, () => v3());
    this.prev = Array.from({ length: n }, () => v3());
    this.rest = HOSE.segment;
    this.gripped = false;
    this.object = new Group();
    this.parts = Array.from({ length: n - 1 }, () => {
      const g = new Group().add(...toonParts([[new CapsuleGeometry(HOSE.radius, HOSE.segment, 3, 8), C.hose]], uniforms));
      this.object.add(g);
      return g;
    });
    this.nozzle = new Group().add(...toonParts([[new CylinderGeometry(0.045, 0.055, 0.2, 10), C.nozzle]], uniforms));
    this.object.add(this.nozzle);
    this.object.visible = false;
  }

  // Lays it on the ground from a character space point a, straight ahead to the tap, with a little slack
  // as a gentle S on the ground.
  lay(c, a) {
    const n = HOSE.points, length = this.rest * (n - 1), reach = length - HOSE.slack;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const local = v3(a.x + 0.3 * Math.sin(Math.PI * 2 * k) * (1 - k), HOSE.radius, a.z + reach * k);
      toWorld(c, local, this.p[i]);
      this.prev[i].copy(this.p[i]);
    }
    this.object.visible = true;
  }

  update(dt, ibis, jaw) {
    if (!this.object.visible) return;
    const n = HOSE.points, h = Math.min(dt, 1 / 30);
    for (let i = 0; i < n; i++) {
      const p = this.p[i], q = this.prev[i], v = p.clone().sub(q).multiplyScalar(0.985);
      q.copy(p);
      p.add(v).y -= G * h * h;
    }
    const end = this.gripped ? ibis.object.localToWorld(holdLocal(ibis.rig, jaw, 0)) : null;
    for (let it = 0; it < HOSE.iterations; it++) {
      if (end) this.p[0].copy(end);
      this.p[n - 1].copy(this.prev[n - 1]);   // the tap end does not move
      for (let i = 0; i < n - 1; i++) {
        const a = this.p[i], b = this.p[i + 1], d = b.clone().sub(a), len = d.length() || 1e-6;
        const fix = d.multiplyScalar((len - this.rest) / len / 2);
        if (!(i === 0 && end)) a.add(fix);
        if (i + 1 !== n - 1) b.sub(fix);
      }
      for (let i = 0; i < n; i++) {
        const p = this.p[i];
        if (p.y < HOSE.radius) {
          p.y = HOSE.radius;
          this.prev[i].lerp(p, 0.3).y = p.y;   // friction on the ground
        }
      }
    }
    if (end) this.p[0].copy(end);
    const up = v3(0, 1, 0);
    this.parts.forEach((g, i) => {
      const a = this.p[i], b = this.p[i + 1], d = b.clone().sub(a), len = d.length();
      g.position.copy(a).add(b).multiplyScalar(0.5);
      g.quaternion.setFromUnitVectors(up, d.divideScalar(len || 1));
      g.scale.set(1, len / this.rest, 1);
    });
    // The nozzle: out of the first point, away from the second.
    const d = this.p[0].clone().sub(this.p[1]).normalize();
    this.nozzle.position.copy(this.p[0]).addScaledVector(d, 0.08);
    this.nozzle.quaternion.setFromUnitVectors(up, d);
  }
}

// The props of each move by its name in MOVES. things: the Things by name, on the MoveProps. start:
// { action: (props, c) => ... } when an action starts. on: { event: (props, c, e) => ... } at each
// character event. each: (props, c, dt, ibis) => ... each update. hose: a Hose.
const ballThing = uniforms => new Thing(ballMesh(uniforms), { ...BALL });
const itemThing = (name, uniforms, more = {}) => new Thing(itemMesh(ITEMS[name], uniforms), { ...ITEMS[name], ...more });

const PEEK = 0.08;   // the 'grab' time of a peck
const RIG = {
  'Peck': {
    things: u => ({ ball: ballThing(u) }),
    // Just in front of the bill tip, so the tip meets its back.
    start: { peck: (s, c) => s.ball.place(c, spotAt('peck', PEEK, 'tip').add(v3(0, 0, BALL.radius + 0.02))) },
    on: { grab: (s, c) => s.ball.throw(c, [0, 2.2, 2.6], 12) },   // boop: away in front, clear of the bill
  },
  'Pick up': {
    things: u => ({ ball: ballThing(u) }),
    start: { peck: (s, c) => s.ball.place(c, spotAt('peck', PEEK, BALL.jaw)) },
    on: { grab: (s, c) => s.ball.hold(c), drop: (s, c) => s.ball.throw(c, [0, 0.5, 0.6], 3) },
  },
  'Drop': {
    things: u => ({ ball: ballThing(u) }),
    start: { drop: (s, c) => s.ball.hold(c, true) },
    on: { drop: (s, c) => s.ball.throw(c, [0, 0, 0.4], 3) },
  },
  'Fumble': {
    things: u => ({ gnome: itemThing('gnome', u, { up: { q: new Quaternion().setFromAxisAngle(v3(0, 0, 1), -Math.PI / 2), base: GNOME_BASE } }) }),
    // Under the tip of the open bill, its hat in the gap of the bill.
    start: {
      fumble: (s, c) => {
        const spot = spotAt('fumble', 0.15, 'tip'), g = s.gnome;
        g.scale = (spot.y + 0.15) / GNOME_HEIGHT;
        g.up.base = GNOME_BASE * g.scale;
        g.place(c, spot.setY(0), Math.PI);
        s.wobble = 0;
        s.tilt = 0;
        s.c = c;
      },
    },
    on: { clack: s => { s.wobble = 7; } },   // it slips out of the bill: the gnome rocks
  },
  'Aim and fling': {
    things: u => ({ ball: ballThing(u) }),
    start: { aim: (s, c) => s.ball.hold(c, true) },
    on: { fling: (s, c) => s.ball.throw(c, [0, 7.5, 6], 14) },   // up and away, out of view
  },
  'Side throw': {
    things: u => ({ ball: ballThing(u) }),
    start: { sideThrow: (s, c) => s.ball.hold(c, true) },
    on: { fling: (s, c) => s.ball.throw(c, [-3.5, 6.5, 5], 14) },   // to the right, up and away
  },
  'Rummage': {
    things: u => ({ chip: itemThing('chip', u), chip2: itemThing('chip', u) }),
    start: { rummage: s => { s.chip.hide(); s.chip2.hide(); s.flicks = 0; } },
    // A chip out of the bill each flick, over a shoulder: the left, then the right.
    on: {
      whoosh: (s, c) => {
        const t = s.flicks++ ? s.chip2 : s.chip, side = s.flicks === 1 ? 1 : -1;
        t.pos.copy(s.bill(t));
        t.pop = 0;
        t.throw(c, [1.6 * side, 4.2, -1], 16);
      },
    },
  },
  'Catch': {
    things: u => ({ chip: itemThing('chip', u) }),
    // It falls into the bill just as the catch starts; it is eaten after a moment, and the next one falls.
    start: { catch: (s, c) => { s.chip.hold(c); s.held = 0; } },
    each: (s, c, dt, ibis) => {
      if (s.chip.state !== 'held') return;
      if ((s.held += dt) < 0.35) return;
      s.chip.state = 'in';   // swallowed
      s.chip.t = 0;
      c.controller.carry = null;
      s.next = (ACTIONS.catch.length + CATCH_GAP) - 0.35 - 0.45;   // falls 0.45 s
      s.drop = { at: 0, ibis };
    },
  },
  'Toss': {
    things: u => ({ chip: itemThing('chip', u) }),
    start: { toss: (s, c) => s.chip.hold(c, s.chip.state === 'hidden') },
    // Straight up, to come back to the bill at the next toss.
    on: { toss: (s, c) => s.chip.throw(c, [0, G * (ACTIONS.toss.length + TOSS_GAP - 0.13) / 2, 0], 9) },
  },
  'Gulp': {
    things: u => ({ chip: itemThing('roll', u) }),   // a sausage roll: a big lump
    // It pops into the bill (a catch), then goes down in the gulp: a pouch in the throat, then a lump
    // down the neck in three gulps, into the belly.
    start: { catch: (s, c) => { s.chip.hold(c, true); s.time = null; }, gulp: s => { s.time = 0; } },
    each: (s, c, dt, ibis) => {
      if (s.time === null) return swallow(ibis, -1);
      s.time += dt;
      if (s.chip.state === 'held' && s.time >= 0.18) { s.chip.state = 'in'; s.chip.t = 0; c.controller.carry = null; }
      swallow(ibis, s.time, ITEMS.roll.lump.map(v => v * LUMP));
    },
  },
  'Tug': {
    hose: true,
    start: { tug: (s, c) => { s.hose.gripped = false; s.hose.lay(c, spotAt('tug', 0.22, HOSE.jaw).setY(0)); } },
    on: { clack: s => { s.hose.gripped = true; }, drop: (s, c) => { s.hose.gripped = false; c.controller.carry = null; } },
  },
};
// The gaps of these moves in MOVES (src/moves.js), for the timing of a fall back into the bill.
export const CATCH_GAP = 0.9, TOSS_GAP = 0.4;

export class MoveProps {
  constructor(def, asset) {
    this.def = def;
    this.object = new Group();
    const things = def.things?.(asset.uniforms) ?? {};
    Object.assign(this, things);
    this.things = Object.values(things);
    for (const t of this.things) this.object.add(t.mesh);
    if (def.hose) {
      this.hose = new Hose(asset.uniforms);
      this.object.add(this.hose.object);
    }
  }

  start(name, c) { this.def.start?.[name]?.(this, c); }

  // The world point where a thing sits in the bill now.
  bill(thing) {
    return this.ibis.object.localToWorld(holdLocal(this.ibis.rig, thing.jaw, thing.edge));
  }

  update(dt, ibis) {
    const c = ibis.character;
    this.ibis = ibis;
    ibis.object.updateMatrixWorld();
    for (const e of c.events) this.def.on?.[e.type]?.(this, c, e);
    this.def.each?.(this, c, dt, ibis);
    // Catch: the next chip falls from above to the bill.
    if (this.drop && (this.drop.at += dt) >= this.next) {
      const fall = 0.45, chip = this.chip;
      chip.pos.copy(ibis.object.localToWorld(holdLocal(ibis.rig, chip.jaw, chip.edge)));
      chip.pos.y += 0.5 * G * fall * fall;
      chip.vel.set(0, 0, 0);
      chip.spin.set(1, 0.3, 0).multiplyScalar(9);
      chip.state = 'air';
      chip.t = 0;
      chip.pop = 0;
      this.drop = null;
    }
    for (const t of this.things) t.update(dt, ibis);
    if (this.gnome) this.rock(dt);
    this.hose?.update(dt, ibis, HOSE.jaw);
  }

  // The gnome: pulled toward the bird while the bill holds its hat, then it rocks on its base.
  rock(dt) {
    const g = this.gnome, c = this.c;
    if (!c || g.state !== 'rest') return;
    const pull = c.animator.playing?.name === 'fumble' && c.animator.playing.t < 0.26 ? -0.35 * smoothstep(0.04, 0.2, c.animator.playing.t) : 0;
    this.wobble += (-90 * (this.tilt - pull) - 5 * this.wobble) * dt;
    this.tilt += this.wobble * dt;
    // Tip about the base, toward the bird (its back is to the bird: -x of the stand is toward it).
    const base = g.pos.clone().setY(0);
    const axis = v3(Math.cos(c.heading), 0, -Math.sin(c.heading));
    const q = new Quaternion().setFromAxisAngle(axis, this.tilt);
    g.mesh.quaternion.copy(q).multiply(g.quat);
    g.mesh.position.copy(g.pos).sub(base).applyQuaternion(q).add(base);
  }
}

export function makeProps(name, asset) {
  return RIG[name] ? new MoveProps(RIG[name], asset) : null;
}
