// An oscillating lawn sprinkler on a hose from a tap: a light prop that sprays an arc of drops while the
// tap is open. A peck turns the tap's handle. Drops that hit a bird soak it, and drops on the ground make
// a wet patch. See docs/props.md.
//
//   const sprinkler = new Sprinkler(physics, asset, { at, heading, base, tap: [x, z], height });
//   sprinkler.update(ibises, dt, camera);   // every frame, after physics.step(dt)
//   sprinkler.events   // { type: 'soak', ibis, wet, wash }: drops that hit a bird this update
//   sprinkler.spray    // { amount, at }: for the sound
//   sprinkler.hull(id) // the handle's outline, when id is its switch (highlight.js)
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, SphereGeometry, DataTexture, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, LinearFilter, Matrix4, Mesh, Quaternion, RedFormat, ShaderMaterial, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hash } from '../ibis/motion/spring.js';
import { GRAVITY, yaw } from './physics.js';
import { Rest, smoothNormals, tone, toonParts } from './props.js';
import { GROUND_WET } from './street.js';
import { f, srgb } from './util.js';

// Sizes in units (the bird is 2), times in seconds. Each field is described in docs/props.md. The
// sprinkler's sizes (size, ridge, bar) are times scale; the tap's are times tap.scale, and its handle's
// times tap.handle.
export const SPRINKLER = {
  scale: 1.5, size: [1.15, 0.36, 0.42], ridge: 0.05, mass: 0.9, friction: 0.8,
  bar: { length: 0.95, radius: 0.035, height: 0.3, sweep: 1.1, period: 7, low: 1.25, follow: 3 },
  spray: { count: 240, rate: 210, speed: 9.5, fan: 0.2, scatter: 0.12, jitter: 0.04, size: [0.02, 0.07, 0.01] },
  hose: { slack: 1.25, radius: 0.07, rings: 33, sides: 6, pull: 40, damp: 6 },
  soak: { reach: 0.45, top: 1.9, wet: 0.0025, wash: 0.002 },
  wet: { cell: 0.25, add: 0.04, dry: 0.004, upload: 0.2, margin: 4.5 },
  flip: { up: -0.5, still: 0.5, push: 1.2 },
  tap: { scale: 1.5, handle: 2, reach: 0.25, turn: 6, rise: 2, low: 0.5 },
  far: 40,
};
const COLOURS = {
  base: [srgb(0.95, 0.78, 0.20), srgb(0.72, 0.52, 0.12), srgb(0.38, 0.25, 0.06)],
  gear: [srgb(0.30, 0.52, 0.36), srgb(0.21, 0.40, 0.37), srgb(0.07, 0.15, 0.16)],
  bar: [srgb(0.80, 0.82, 0.86), srgb(0.52, 0.54, 0.66), srgb(0.20, 0.21, 0.28)],
  hose: [srgb(0.36, 0.62, 0.34), srgb(0.22, 0.44, 0.38), srgb(0.08, 0.17, 0.14)],
  tap: [srgb(0.90, 0.92, 0.95), srgb(0.55, 0.58, 0.70), srgb(0.20, 0.21, 0.28)],   // chrome
};
// The tap at scale 1: the top of its head, and its spout's end (out from the pipe, up).
const TAP = { top: 0.65, spout: [0.16, 0.52] };
const WATER = [srgb(0.78, 0.89, 1.0), srgb(0.97, 1.0, 1.0)];   // edge, core
const v = new Vector3(), w = new Vector3(), turn = new Quaternion();   // scratch

export class Sprinkler {
  static footprint() {
    const { size: [x, y, z], scale: k } = SPRINKLER;
    return { half: [k * (x / 2 + 0.05), k * z / 2], height: k * y };
  }

  // tap: [x, z] of the tap the hose runs from. height(x, z): the ground.
  constructor(physics, asset, { at: [x, z], heading = 0, base = 0, tap, height }) {
    const S = SPRINKLER, k = S.scale, [sx, sy, sz] = S.size, B = S.bar, y0 = -sy / 2;
    Object.assign(this, { physics, height, n: 0, sweep: 0, centre: 0, upside: 0, open: true, pressure: 1, events: [], spray: { amount: 0, at: new Vector3() } });
    this.half = S.size.map(s => k * s / 2);
    // The solid narrows to a ridge along the bar, so the sprinkler can't rest upside down: it rolls onto a side.
    const [hx, hy, hz] = this.half, points = [];
    for (const px of [-hx, hx]) for (const pz of [-1, 1]) points.push(px, -hy, pz * hz, px, hy, pz * k * S.ridge);
    this.id = physics.addHull(points, { position: [x, base + hy, z], quaternion: yaw(heading), light: true, mass: S.mass, friction: S.friction });
    this.rest = new Rest(physics, [this.id]);
    // One mesh: a tray, a post at each end, the bar, and a gear box at one end with the hose inlet. The
    // bar is round, so its turn would not show: it is part of the body. Made at scale 1, then scaled.
    const scaled = (parts, s) => parts.map(([g, c, at]) => [g.scale(s, s, s), c, at.map(a => a * s)]);
    this.body = new Group().add(...toonParts(scaled([
      [new RoundedBoxGeometry(sx - 0.1, 0.12, sz, 2, 0.04), COLOURS.base, [0, y0 + 0.06, 0]],
      ...[-1, 1].map(s => [new BoxGeometry(0.07, B.height, 0.14), COLOURS.base, [s * (B.length / 2 + 0.04), y0 + B.height / 2, 0]]),
      [new CylinderGeometry(B.radius, B.radius, B.length, 10).rotateZ(Math.PI / 2), COLOURS.bar, [0, y0 + B.height, 0]],
      [new RoundedBoxGeometry(0.16, 0.24, 0.22, 2, 0.04), COLOURS.gear, [sx / 2 - 0.08, y0 + 0.14, 0]],
      [new CylinderGeometry(0.045, 0.045, 0.1, 10).rotateZ(Math.PI / 2), COLOURS.gear, [sx / 2 + 0.02, y0 + 0.1, 0]],
    ], k), asset.uniforms));
    this.inlet = new Vector3(sx / 2 + 0.07, y0 + 0.1, 0).multiplyScalar(k);   // body space
    this.nozzle = k * (y0 + B.height + B.radius);                             // body space height of the drops' start
    this.tap = new Vector3(tap[0], height(...tap), tap[1]);
    this.hoseLength = S.hose.slack * this.tap.distanceTo(v.set(x, base, z));
    this.hose = new Hose(this.tap, v.set(x, 0, z), height, asset.uniforms);
    // The tap's handle: a cross head, four spokes with round knobs, on a spindle on top of the tap. A
    // peck turns it (a switch: Physics.addSwitch()): a full turn, anticlockwise to open.
    const T = S.tap, t = this.tap, top = TAP.top * T.scale;
    this.handle = new Group().add(...toonParts(scaled([
      [new CylinderGeometry(0.02, 0.02, 0.05, 8), COLOURS.tap, [0, 0.025, 0]],
      [new CylinderGeometry(0.04, 0.04, 0.04, 10), COLOURS.tap, [0, 0.06, 0]],
      [new CylinderGeometry(0.016, 0.016, 0.26, 6).rotateZ(Math.PI / 2), COLOURS.tap, [0, 0.06, 0]],
      [new CylinderGeometry(0.016, 0.016, 0.26, 6).rotateX(Math.PI / 2), COLOURS.tap, [0, 0.06, 0]],
      ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [new SphereGeometry(0.032, 8, 6), COLOURS.tap, [0.14 * a, 0.06, 0.14 * b]]),
    ], T.handle), asset.uniforms));
    this.handle.position.copy(t).setY(t.y + top);
    this.handle.rotation.y = this.hose.turn;
    this.switch = physics.addSwitch(
      [t.x - T.reach, t.y + 0.75 * top, t.z - T.reach, t.x + T.reach, t.y + top + 0.1 * T.handle, t.z + T.reach],
      () => { this.open = !this.open; },
    );
    this.drops = new Drops(S.spray.count);
    this.wet = new WetGround(this.tap, this.hoseLength + S.wet.margin);
    this.object = new Group().add(this.body, this.hose.object, this.handle, this.drops.object);
    this.place();
  }

  update(ibises = [], dt = 0, camera = null) {
    this.events = [];
    const S = SPRINKLER, body = this.physics.body(this.id);
    if (!this.rest.still()) this.place();
    this.tether(body, dt);
    this.unflip(body, dt);
    this.turnTap(dt);
    // While the tap is open the bar sweeps and sprays. Shut, or far from the camera, it stops; the drops
    // in the air still fall.
    const near = !camera || camera.position.distanceTo(this.body.position) < S.far;
    const on = this.pressure > 0.02 && near;
    if (on) this.sweep += dt;
    this.aim(body, dt);
    const hits = this.drops.update(dt, on ? this.emitter(body) : null, ibises, this.height, this.wet, this.body.position, this.pressure);
    for (const [ibis, n] of hits) this.events.push({ type: 'soak', ibis, wet: n * S.soak.wet, wash: n * S.soak.wash });
    this.wet.update(dt);
    // No sound while it sprays into the ground (upside down, before it rolls over).
    this.spray.amount = on && this.upside === 0 ? this.pressure : 0;
    this.spray.at.copy(this.body.position);
  }

  // The body to its physics pose, and the hose to the inlet.
  place() {
    const body = this.physics.body(this.id);
    this.body.position.fromArray(body.position);
    this.body.quaternion.fromArray(body.quaternion);
    this.body.updateMatrixWorld();
    this.hose.to(this.body.localToWorld(v.copy(this.inlet)), this.hoseLength);
  }

  // The handle turns to the tap's state (a full turn: open at 0, shut at -2 pi), and the water pressure
  // follows it: it builds up over 1 / tap.rise seconds when opened, and falls away when shut.
  turnTap(dt) {
    const T = SPRINKLER.tap, want = this.open ? 0 : -2 * Math.PI, angle = this.handle.rotation.y - this.hose.turn;
    if (Math.abs(want - angle) > 1e-3) this.handle.rotation.y = this.hose.turn + angle + (want - angle) * Math.min(T.turn * dt, 1);
    this.pressure = Math.min(Math.max(this.pressure + (this.open ? 1 : -1) * T.rise * dt, 0), 1);
  }

  // The handle's outline (the line mesh) for the highlight, when id is its switch.
  hull(id) {
    if (id !== this.switch) return null;
    const line = this.handle.children[1];
    line.updateWorldMatrix(true, false);
    return { geometry: line.geometry, matrix: line.matrixWorld };
  }

  // The solids, for the grass tufts (tufts.js).
  solids() { return [{ body: this.physics.body(this.id), half: this.half }]; }

  // The hose pulls the sprinkler back when it is farther from the tap than the hose is long: a spring on
  // the inlet, with damping of the speed away from the tap.
  tether(body, dt) {
    if (dt <= 0) return;
    const H = SPRINKLER.hose, inlet = this.body.localToWorld(w.copy(this.inlet));
    const d = v.subVectors(this.tap, inlet).setY(0), length = d.length(), over = length - this.hoseLength;
    if (over <= 0) return;
    d.divideScalar(length);
    const [vx, , vz] = body.motionProperties.linearVelocity, away = -(vx * d.x + vz * d.z);
    const k = SPRINKLER.mass * (H.pull * over + H.damp * Math.max(away, 0)) * dt;
    this.physics.impulse(this.id, [d.x * k, 0, d.z * k], inlet.toArray());
  }

  // Upside down: the ridge makes it roll over by itself. If it still rests upside down for flip.still
  // seconds (balanced on the ridge), a push up on one side rolls it onto that side.
  unflip(body, dt) {
    const F = SPRINKLER.flip, [qx, , qz] = body.quaternion, up = 1 - 2 * (qx * qx + qz * qz);
    if (up > F.up) { this.upside = 0; return; }
    if ((this.upside += dt) < F.still) return;
    this.upside = 0;
    const side = this.body.localToWorld(v.set(0, 0, this.half[2]));
    this.physics.impulse(this.id, [0, F.push * SPRINKLER.mass, 0], side.toArray());
  }

  // The middle of the sweep, about the bar (0: the body's up). On its side the sprinkler would spray half
  // of each sweep into the ground: the middle turns, smoothly, just enough that it is bar.low (radians)
  // above level, toward the world's up. Upright it does not turn. Upside down nothing helps: it rolls over.
  aim(body, dt) {
    const B = SPRINKLER.bar;
    turn.fromArray(body.quaternion);
    const up = v.set(0, 1, 0).applyQuaternion(turn.invert()), r = Math.hypot(up.y, up.z), most = Math.atan2(up.z, up.y);
    const low = Math.sin(B.low);
    let want = 0;
    if (up.y < low) want = r <= low ? most : most - Math.sign(most) * Math.acos(low / r);
    this.centre += (want - this.centre) * Math.min(B.follow * dt, 1);
  }

  // A function that starts one drop (world position and velocity) from the bar: along its length, out in
  // a fan, at the bar's angle.
  emitter(body) {
    const { bar: B, spray: P } = SPRINKLER, angle = this.centre + B.sweep * Math.sin(2 * Math.PI * this.sweep / B.period);
    turn.fromArray(body.quaternion);
    w.fromArray(body.position);
    const r = () => hash(++this.n * 7919);
    return (pos, vel) => {
      const along = (2 * r() - 1) * 0.45, a = angle + P.jitter * (2 * r() - 1);
      pos.set(along * B.length * SPRINKLER.scale, this.nozzle, 0).applyQuaternion(turn).add(w);
      vel.set(P.fan * along / 0.45 + P.scatter * (2 * r() - 1), Math.cos(a), Math.sin(a)).normalize()
        .multiplyScalar(P.speed * (0.9 + 0.2 * r())).applyQuaternion(turn);
    };
  }
}

// The hose and the tap, one mesh (two draws). The tap is fixed. The hose is a tube from the tap's spout,
// down to the ground and along it to the inlet, with its slack as a bend to one side. Its vertices are
// made once and moved in place (to()), so a moving sprinkler makes no garbage, and only they upload.
class Hose {
  constructor(tap, toward, height, shared) {
    const { rings, sides } = SPRINKLER.hose;
    Object.assign(this, { tap, height });
    // The tap: a pipe, a brass head and a spout that points toward the sprinkler.
    this.out = new Vector3().subVectors(toward, tap).setY(0).normalize();
    this.turn = Math.atan2(-this.out.x, -this.out.z);   // the tap's turn about y: its -z along out
    const place = new Matrix4().makeRotationY(this.turn).setPosition(tap);
    const k = SPRINKLER.tap.scale;
    const parts = [
      [new CylinderGeometry(0.05, 0.05, 0.6, 8), [0, 0.3, 0]],
      [new BoxGeometry(0.14, 0.1, 0.1), [0, 0.6, 0]],
      [new CylinderGeometry(0.04, 0.04, 0.14, 8).rotateX(Math.PI / 2), [0, TAP.spout[1], -0.09]],
    ].map(([g, at]) => {
      g.translate(...at).scale(k, k, k).applyMatrix4(place);
      g.setAttribute('_outline', smoothNormals(g));
      return tone(g, COLOURS.tap);
    });
    // The tube: rings of sides vertices; the outline normal of a round tube is its normal.
    const tube = rings * sides, count = tube + parts.reduce((n, g) => n + g.attributes.position.count, 0);
    const names = ['position', 'normal', '_outline', 'aLit', 'aShade', 'aLine'];
    const g = new BufferGeometry();
    for (const name of names) g.setAttribute(name, new Float32BufferAttribute(new Float32Array(count * 3), 3));
    for (const name of names.slice(0, 3)) g.attributes[name].setUsage(DynamicDrawUsage);
    const index = [];
    for (let i = 0; i < rings - 1; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      index.push(a, b, a + sides, b, b + sides, a + sides);   // outward: the ring turns from n to b = t x n
    }
    let at = tube;
    for (const p of parts) {
      for (const name of names) g.attributes[name].array.set(p.attributes[name].array, at * 3);
      for (const i of p.index.array) index.push(at + i);
      at += p.attributes.position.count;
    }
    COLOURS.hose.forEach((c, k) => { for (let i = 0; i < tube; i++) c.toArray(g.attributes[names[3 + k]].array, 3 * i); });
    g.setIndex(index);
    this.geometry = g;
    // The shared prop materials, from a throwaway part. Flat on the ground: no shadow.
    this.object = new Group().add(...toonParts([[new BoxGeometry(0.1, 0.1, 0.1), COLOURS.hose]], shared));
    for (const mesh of this.object.children) {
      mesh.geometry.dispose();
      mesh.geometry = g;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
    }
    this.points = Array.from({ length: 10 }, () => new Vector3());
    this.c = new Vector3();
    this.frame = { t: new Vector3(), n: new Vector3(), b: new Vector3(), last: new Vector3() };
  }

  // Moves the tube to end at inlet (world). length: the hose's length, for the bend.
  to(at, length) {
    const { radius: R, rings, sides } = SPRINKLER.hose, P = this.points, out = this.out, inlet = P[9].copy(at);
    // Control points: the spout, the ground below it, then along the ground with the bend, the inlet.
    const k = SPRINKLER.tap.scale;
    P[0].copy(this.tap).addScaledVector(out, k * TAP.spout[0]).setY(this.tap.y + k * TAP.spout[1]);
    P[1].copy(this.tap).addScaledVector(out, k * TAP.spout[0] + 0.2).setY(this.tap.y + R);
    const d = v.subVectors(inlet, P[1]).setY(0).length(), bend = 0.3 * Math.sqrt(Math.max(length ** 2 - d * d, 0));
    const sx = -v.z / Math.max(d, 1e-4), sz = v.x / Math.max(d, 1e-4);
    for (let i = 2; i < 9; i++) {
      const t = (i - 1) / 8, s = bend * Math.sin(Math.PI * t), p = P[i].copy(P[1]).lerp(inlet, t);
      p.x += sx * s;
      p.z += sz * s;
      p.y = this.height(p.x, p.z) + R;
    }
    // Rings along a Catmull-Rom curve through the points, each frame carried on from the last.
    const pos = this.geometry.attributes.position.array, nor = this.geometry.attributes.normal.array, line = this.geometry.attributes._outline.array;
    const { t, n, b, last } = this.frame;
    for (let r = 0; r < rings; r++) {
      const u = r / (rings - 1) * (P.length - 1), i = Math.min(Math.floor(u), P.length - 2);
      const c = catmull(this.c, P, i, u - i);
      if (r === 0) t.subVectors(catmull(w, P, 0, 0.01), c).normalize();
      else t.subVectors(c, last).normalize();
      last.copy(c);
      if (r === 0) n.set(0, 0, 1).cross(t);
      else n.addScaledVector(t, -n.dot(t));
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
      n.normalize();
      b.crossVectors(t, n);
      for (let j = 0; j < sides; j++) {
        const a = j / sides * 2 * Math.PI, cs = Math.cos(a), sn = Math.sin(a), k = 3 * (r * sides + j);
        const nx = n.x * cs + b.x * sn, ny = n.y * cs + b.y * sn, nz = n.z * cs + b.z * sn;
        pos[k] = c.x + nx * R; pos[k + 1] = c.y + ny * R; pos[k + 2] = c.z + nz * R;
        nor[k] = line[k] = nx; nor[k + 1] = line[k + 1] = ny; nor[k + 2] = line[k + 2] = nz;
      }
    }
    for (const name of ['position', 'normal', '_outline']) {
      const a = this.geometry.attributes[name];
      a.clearUpdateRanges();
      a.addUpdateRange(0, rings * sides * 3);
      a.needsUpdate = true;
    }
  }
}

// A point on the Catmull-Rom curve through P, in segment i at t (0 to 1), in out.
function catmull(out, P, i, t) {
  const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
  const t2 = t * t, t3 = t2 * t;
  const k = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  return out.set(k(p0.x, p1.x, p2.x, p3.x), k(p0.y, p1.y, p2.y, p3.y), k(p0.z, p1.z, p2.z, p3.z));
}

// The drops: a ring buffer of streaks, one instanced draw. A drop's flight is a parabola, so the vertex
// shader places it from its start, velocity and start time: only new drops upload, not every drop each
// frame. Its landing (time and place) is found once when it starts. Hits on a bird are tested only while
// a bird is near.
class Drops {
  constructor(count) {
    Object.assign(this, { count, head: 0, clock: 0, carry: 0, last: -1 });
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    // aStart: x, y, z, start time. aVel: velocity, and life (seconds to the landing, or to a hit).
    this.start = new InstancedBufferAttribute(new Float32Array(count * 4).fill(-1e3), 4).setUsage(DynamicDrawUsage);
    this.vel = new InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(DynamicDrawUsage);
    g.setAttribute('aStart', this.start);
    g.setAttribute('aVel', this.vel);
    g.instanceCount = count;
    this.land = new Float32Array(count * 2);    // landing x, z
    this.done = new Uint8Array(count).fill(1);  // 1 when landed or hit
    this.material = dropMaterial();
    this.object = new Mesh(g, this.material);
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.p = new Vector3();
    this.u = new Vector3();
  }

  // Starts new drops with emit (or none), lands the drops that are due, and tests the drops near the
  // birds. centre: the sprinkler. Returns the hits on each bird: Map of ibis to the number of drops.
  // pressure (0 to 1): the rate, and part of the speed.
  update(dt, emit, ibises, height, wet, centre, pressure = 1) {
    const hits = new Map(), s = this.start.array, u = this.vel.array, S = SPRINKLER;
    if (dt <= 0) return hits;
    const now = this.clock += dt;
    this.material.uniforms.uTime.value = now;
    this.start.clearUpdateRanges();
    this.vel.clearUpdateRanges();
    // New drops, in the next slots of the ring.
    this.carry = emit ? this.carry + S.spray.rate * pressure * dt : 0;
    const first = this.head;
    let made = 0;
    for (; this.carry >= 1 && made < this.count; this.carry--, made++) {
      const i = this.head;
      this.head = (i + 1) % this.count;
      emit(this.p, this.u);
      this.u.multiplyScalar(S.tap.low + (1 - S.tap.low) * pressure);
      const life = flight(this.p, this.u, height);
      this.p.toArray(s, 4 * i);
      s[4 * i + 3] = now;
      this.u.toArray(u, 4 * i);
      u[4 * i + 3] = life;
      this.land[2 * i] = this.p.x + this.u.x * life;
      this.land[2 * i + 1] = this.p.z + this.u.z * life;
      this.done[i] = 0;
      this.last = Math.max(this.last, now + life);
    }
    if (made) this.upload(first, made);
    // Hits: a drop inside a bird's body (a round column), only for birds within the spray's reach.
    const reach = S.spray.speed ** 2 / GRAVITY * 1.2 + 1;
    const near = ibises.filter(b => Math.hypot(b.object.position.x - centre.x, b.object.position.z - centre.z) < reach);
    for (let i = 0; i < this.count; i++) {
      if (this.done[i]) continue;
      const t = now - s[4 * i + 3];
      if (t >= u[4 * i + 3]) {
        this.done[i] = 1;
        wet.add(this.land[2 * i], this.land[2 * i + 1]);
        continue;
      }
      if (!near.length) continue;
      const x = s[4 * i] + u[4 * i] * t, y = s[4 * i + 1] + (u[4 * i + 1] - 0.5 * GRAVITY * t) * t, z = s[4 * i + 2] + u[4 * i + 2] * t;
      for (const ibis of near) {
        const b = ibis.object.position;
        if (y < b.y || y > b.y + S.soak.top || Math.hypot(x - b.x, z - b.z) > S.soak.reach) continue;
        hits.set(ibis, (hits.get(ibis) ?? 0) + 1);
        this.done[i] = 1;
        u[4 * i + 3] = t;   // it ends here: the shader hides it
        this.vel.addUpdateRange(4 * i + 3, 1);
        this.vel.needsUpdate = true;
        break;
      }
    }
    this.object.visible = now < this.last;
    return hits;
  }

  // Marks count slots from first (round the ring) to upload.
  upload(first, count) {
    const wrap = Math.max(first + count - this.count, 0);
    for (const a of [this.start, this.vel]) {
      a.addUpdateRange(4 * first, 4 * (count - wrap));
      if (wrap) a.addUpdateRange(0, 4 * wrap);
      a.needsUpdate = true;
    }
  }
}

// Seconds until a drop from p with velocity u lands. The ground height at the landing place changes the
// landing, so it is found again there. A drop that starts below the ground ends at once.
function flight(p, u, height) {
  const land = fall => {
    const d = u.y * u.y + 2 * GRAVITY * fall;   // below 0: it never comes up to that height
    return d < 0 ? 0 : (u.y + Math.sqrt(d)) / GRAVITY;
  };
  const fall = p.y - height(p.x, p.z);
  if (fall < 0) return 0.02;
  const t = land(fall);
  return land(p.y - height(p.x + u.x * t, p.z + u.z * t)) || t;
}

// The wet patch: wetness on a grid of cells round the tap (as far as the spray can reach), that the
// drops raise and the sun dries. The ground shader (street.js) darkens the ground with it (GROUND_WET).
// Only the wet cells dry, and the texture uploads only when a cell changes.
class WetGround {
  constructor(centre, half) {
    const W = SPRINKLER.wet, n = Math.ceil(2 * half / W.cell);
    Object.assign(this, { n, x0: centre.x - half, z0: centre.z - half, wait: 0, changed: false });
    this.value = new Float32Array(n * n);
    this.cells = new Set();   // cells with water
    this.texture = new DataTexture(new Uint8Array(n * n), n, n, RedFormat);
    this.texture.magFilter = this.texture.minFilter = LinearFilter;
    this.texture.unpackAlignment = 1;   // rows of one byte for each cell: not a multiple of 4
    this.texture.needsUpdate = true;
    GROUND_WET.map.value = this.texture;
    GROUND_WET.area.value.set(this.x0, this.z0, n * W.cell, 1);
  }

  // A drop at x, z: on its cell, and half as much on the cells round it, so the patch is smooth.
  add(x, z) {
    const W = SPRINKLER.wet, i = Math.floor((x - this.x0) / W.cell), j = Math.floor((z - this.z0) / W.cell);
    if (i < 1 || j < 1 || i >= this.n - 1 || j >= this.n - 1) return;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = (j + dj) * this.n + i + di;
      this.value[k] = Math.min(this.value[k] + W.add * (di || dj ? 0.5 : 1), 1);
      this.cells.add(k);
    }
  }

  // Dries the wet cells and uploads the texture if a cell changed, every W.upload seconds.
  update(dt) {
    const W = SPRINKLER.wet;
    if ((this.wait -= dt) > 0 || !this.cells.size) return;
    const dry = W.dry * (W.upload - this.wait), data = this.texture.image.data;
    this.wait = W.upload;
    let changed = false;
    for (const k of this.cells) {
      this.value[k] = Math.max(this.value[k] - dry, 0);
      const b = Math.round(this.value[k] * 255);
      if (b !== data[k]) { data[k] = b; changed = true; }
      if (this.value[k] === 0) this.cells.delete(k);
    }
    if (changed) this.texture.needsUpdate = true;
  }
}

// Drops: streaks along their motion on the screen, pale water with a light core. Unlit: they glint.
function dropMaterial() {
  const [width, length, stretch] = SPRINKLER.spray.size;
  return new ShaderMaterial({
    alphaToCoverage: true,   // soft edges with the multisampled target in grade.js, no sorting
    uniforms: { uTime: { value: 0 }, uEdge: { value: WATER[0] }, uCore: { value: WATER[1] } },
    vertexShader: /* glsl */`
      attribute vec4 aStart, aVel;   // start xyz, start time; velocity, life
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float t = uTime - aStart.w, on = step(0.0, t) * step(t, aVel.w);
        vec3 vel = aVel.xyz - vec3(0.0, ${f(GRAVITY)} * t, 0.0);
        vec3 p = aStart.xyz + (aVel.xyz + vel) * 0.5 * t;
        vec4 view = viewMatrix * vec4(p, 1.0);
        vec2 s = (viewMatrix * vec4(vel, 0.0)).xy;
        float speed = length(s);
        vec2 along = speed > 1e-3 ? s / speed : vec2(0.0, 1.0), side = vec2(along.y, -along.x);   // x right of along: the quad faces the camera
        view.xy += (along * position.y * (${f(length)} + ${f(stretch)} * speed) + side * position.x * ${f(width)}) * on;
        gl_Position = projectionMatrix * view;
        vUv = position.xy;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uEdge, uCore;
      varying vec2 vUv;
      void main() {
        float d = length(vUv);
        if (d > 1.0) discard;
        gl_FragColor = vec4(mix(uCore, uEdge, smoothstep(0.2, 0.8, abs(vUv.x))), smoothstep(1.0, 0.7, d));
        #include <colorspace_fragment>
      }`,
  });
}
