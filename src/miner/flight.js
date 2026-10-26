// Flight of the noisy miner. It circles over a centre, flapping and gliding, and banks into the turn. On
// dive() it turns toward the target, takes aim at where the target is then, folds its wings back and dives
// in a straight line at that point. It does not follow the target on the way down: a target that moves
// gets missed. Then it flaps hard and climbs back up in an arc. On land() it comes down in an arc onto a
// point (the top of a bin), flares and stands there. On takeOff() it jumps up and flies back to its circle.
// It owns the root in the air, as the Controller does on the ground, and makes a Pose for the rig.
// position is the root (the feet at rest) in world units. The Pose is in character units: the bird is
// scaled by MINER_SCALE.
//
//   const f = new Flight({ seed, height, radius });
//   f.centre.set(x, 0, z);    // the point it circles over
//   f.target.copy(head);      // what it dives at, world: keep it up to date while it dives
//   f.dive();
//   f.land(at, face);         // at: a Vector3, world: keep it up to date if the perch moves. face: optional
//                             // ground direction it lands along (either way), as across a rail. f.takeOff()
//   const pose = f.update(dt);   // then f.position and f.heading place the bird. f.events: 'dive', 'hit'
import { Vector3 } from 'three';
import { clipPose, mixPose, restPose } from '../ibis/rig.js';
import { TAU, clamp, damp, hash, mix, smoothstep, window4, wrapAngle } from '../ibis/motion/spring.js';

const STEP = 1 / 120;   // longest sub step, seconds, as in Character

export const FLIGHT = {
  speed: 4.2,         // circle speed, world units per second
  turnRate: 2.2,      // fastest turn, radians per second
  climb: 1.5,         // fastest climb or sink while it circles, units per second
  pull: 0.5,          // steers back onto the circle: part of a turn for each unit off it
  bank: 0.35,         // roll for each radian per second of turn
  pitch: 0.7,         // body pitch in flight, added to the rest pitch, so the body lies level
  // Wings: spread (radians from folded), beat size and beats per second. Fold: the dive, swept back.
  flap: { base: 1.35, amp: 0.55, freq: 6.5, sweep: 0 },
  glide: { base: 1.5, amp: 0.03, freq: 1.5, sweep: 0.05 },
  pump: { base: 1.3, amp: 0.65, freq: 8.5, sweep: 0 },
  fold: { base: 0.05, amp: 0.02, freq: 3, sweep: 0 },
  flare: { base: 1.3, amp: 0.6, freq: 9, sweep: 0.3 },
  rest: { base: 0.03, amp: 0.02, freq: 0.4, sweep: 0 },
  burst: [1.4, 1.0],  // seconds of flaps, then of glide, in the circle
  // Dive. turnRate: the turn toward the target first, radians per second. lined: it dives when it heads
  // this near the target (radians), or after lineUp seconds. speed: at the bottom, units per second (it
  // speeds up from its flight speed on the way down). up: seconds of the climb. over: the aim above the
  // target, so the body skims it. exit, rise: the climb ends this far past and above the aim. hit: the
  // hit distance from the body to the target.
  dive: { turnRate: 4, lined: 0.08, lineUp: 1.2, speed: 14, up: 0.9, over: 0.15, exit: 4, rise: 2.5, hit: 0.55 },
  // Perch. approach: speed of the way in, units per second, for its length in seconds (inTime: the
  // shortest and longest). touch: the speed at touch down, forward and down. flare: the last part of the
  // way in, where the body comes up and the legs reach down. out: seconds of the take off, and how far
  // forward and up it ends. jump: the speed up at the start.
  perch: { approach: 4, inTime: [1.2, 3], touch: [0.8, 0.6], flare: 0.6, outTime: 1.0, out: [3, 2.2], jump: 3 },
  centre: 0.2,        // the middle of the body above the root, world units
  // Legs tucked back under the body in flight, character space (left foot; the right is mirrored), with
  // the toes turned back.
  tuck: new Vector3(0.12, 0.42, -0.45),
};

// Cubic Hermite from a (velocity va) to b (velocity vb) over T seconds, at s (0 to 1): position into p,
// velocity into v.
function hermite(a, va, b, vb, T, s, p, v) {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
  p.set(0, 0, 0).addScaledVector(a, h00).addScaledVector(va, h10 * T).addScaledVector(b, h01).addScaledVector(vb, h11 * T);
  v.set(0, 0, 0).addScaledVector(a, d00 / T).addScaledVector(va, d10).addScaledVector(b, d01 / T).addScaledVector(vb, d11);
}

export class Flight {
  // height: circle height above the ground. radius: circle radius. Both world units. angle: where on
  // the circle it starts. dir: 1 circles one way, -1 the other.
  constructor({ seed = 0, height = 4, radius = 6, angle = 0, dir = 1 } = {}) {
    Object.assign(this, { seed, height, radius, dir });
    this.centre = new Vector3();
    this.target = new Vector3();
    this.position = new Vector3(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
    this.heading = angle + dir * Math.PI / 2;
    this.velocity = new Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(FLIGHT.speed);
    this.turn = 0;          // turn rate now, radians per second, smoothed: the bank
    this.climb = 0;         // flight path angle, more than 0 nose down, smoothed: the body pitch
    this.anger = 0;         // 0 to 1: the angry face of a dive, smoothed
    this.time = hash(seed * 31 + 7) * 3;   // so the birds don't beat together
    this.wing = { ...FLIGHT.flap };
    this.phase = 0;
    this.dived = null;      // the dive now, or null
    this.perched = null;    // the perch now (the way in, on it, the take off), or null
    this.stand = 0;         // 0 the flight pose, 1 standing: the legs, the body and the head
    this.lift = 0;          // the Pose lift, character units: the close views lift the bird off the ground
    this.events = [];   // this update: 'dive' (a dive starts), 'hit' { at } (world)
    this.pose = restPose();
    this.makePose();
  }

  get diving() { return this.dived !== null; }
  get circling() { return this.dived === null && this.perched === null; }
  get landed() { return this.perched?.phase === 'sit'; }

  // Comes down onto at (world). Phases: 'in' (the way in), 'sit', 'out' (the take off). t: seconds in
  // the phase.
  land(at, face = null) {
    if (!this.circling) return;
    const L = FLIGHT.perch, length = at.distanceTo(this.position);
    this.perched = { phase: 'in', t: 0, at, face, from: this.position.clone(), v0: this.velocity.clone(), time: clamp(length / L.approach, ...L.inTime) };
  }

  // Leaves the perch. On the way in, it turns back to its circle.
  takeOff() {
    const pe = this.perched;
    if (!pe || pe.phase === 'out') return;
    if (pe.phase === 'in') { this.perched = null; return; }
    Object.assign(pe, { phase: 'out', t: 0, from: this.position.clone() });
  }

  // Starts a dive at target from where the bird is now. Phases: 'line' (turn toward the target), 'down'
  // (the straight dive at the aim), 'up' (the climb). t: seconds in the phase.
  dive() {
    if (this.dived) return;
    this.dived = { phase: 'line', t: 0, from: new Vector3(), aim: new Vector3(), dir: new Vector3(), length: 0, v0: 0, time: 0, hit: false, told: false };
  }

  update(dt) {
    this.events.length = 0;
    if (this.dived && !this.dived.told) { this.dived.told = true; this.events.push({ type: 'dive' }); }
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    for (let i = 0; i < n; i++) this.step(dt / n);
    this.makePose();
    return this.pose;
  }

  step(dt) {
    this.time += dt;
    const before = this.heading;
    if (this.dived) this.diveStep(dt);
    else if (this.perched) this.perchStep(dt);
    else this.circleStep(dt);
    this.turn += (wrapAngle(this.heading - before) / dt - this.turn) * damp(0.15, dt);
    const v = this.velocity;
    this.climb += (Math.atan2(-v.y, Math.max(Math.hypot(v.x, v.z), 1e-3)) - this.climb) * damp(0.04, dt);
    const phase = this.dived?.phase, pe = this.perched;
    this.anger += ((phase === 'line' || phase === 'down' ? 1 : 0) - this.anger) * damp(0.06, dt);
    // Wings: ease toward the beat of the moment.
    const flare = pe?.phase === 'in' && pe.t > pe.time * (1 - FLIGHT.perch.flare);
    const want = phase === 'down' ? FLIGHT.fold : phase === 'up' || pe?.phase === 'out' ? FLIGHT.pump
      : pe?.phase === 'sit' ? FLIGHT.rest : flare ? FLIGHT.flare : pe ? FLIGHT.glide
      : phase === 'line' || this.position.y < this.height - 0.3 || (this.time % (FLIGHT.burst[0] + FLIGHT.burst[1])) < FLIGHT.burst[0] ? FLIGHT.flap : FLIGHT.glide;
    const k = damp(0.08, dt);
    for (const key in want) this.wing[key] += (want[key] - this.wing[key]) * k;
    this.phase = (this.phase + this.wing.freq * dt) % 1;
  }

  // Steer onto the circle round the centre, at the circle height.
  circleStep(dt) {
    const p = this.position, dx = p.x - this.centre.x, dz = p.z - this.centre.z, r = Math.max(Math.hypot(dx, dz), 1e-3);
    const off = clamp((r - this.radius) * FLIGHT.pull, -1, 1);
    const wx = -dz / r * this.dir - dx / r * off, wz = dx / r * this.dir - dz / r * off;
    const turn = clamp(wrapAngle(Math.atan2(wx, wz) - this.heading), -FLIGHT.turnRate * dt, FLIGHT.turnRate * dt);
    this.heading += turn;
    const v = this.velocity, speed = mix(Math.hypot(v.x, v.z), FLIGHT.speed, damp(0.5, dt));
    const vy = mix(v.y, clamp((this.height - p.y) * 1.2, -FLIGHT.climb, FLIGHT.climb), damp(0.3, dt));
    v.set(Math.sin(this.heading) * speed, vy, Math.cos(this.heading) * speed);
    p.addScaledVector(v, dt);
  }

  // Turn toward the target, a straight line down to the aim, then a climb past it in an arc.
  diveStep(dt) {
    const d = this.dived, D = FLIGHT.dive, p = this.position, v = this.velocity;
    d.t += dt;
    if (d.phase === 'line') {
      // Level, at its speed, it turns toward the target. Lined up, it takes aim at where the target is now.
      const off = wrapAngle(Math.atan2(this.target.x - p.x, this.target.z - p.z) - this.heading);
      this.heading += clamp(off, -D.turnRate * dt, D.turnRate * dt);
      const speed = Math.hypot(v.x, v.z);
      v.set(Math.sin(this.heading) * speed, mix(v.y, 0, damp(0.1, dt)), Math.cos(this.heading) * speed);
      p.addScaledVector(v, dt);
      if (Math.abs(off) < D.lined || d.t > D.lineUp) {
        d.from.copy(p);
        d.aim.copy(this.target).y += D.over;
        d.dir.subVectors(d.aim, d.from);
        d.length = Math.max(d.dir.length(), 1e-3);
        d.dir.divideScalar(d.length);
        d.v0 = Math.max(v.length(), 1);
        d.time = 2 * d.length / (d.v0 + D.speed);   // from v0 to D.speed at an even rate
        Object.assign(d, { phase: 'down', t: 0 });
      }
    } else if (d.phase === 'down') {
      // Distance along the line: v0 T s + (L - v0 T) s², so the speed goes from v0 to D.speed.
      const s = Math.min(d.t / d.time, 1), a = d.length - d.v0 * d.time;
      p.copy(d.from).addScaledVector(d.dir, d.v0 * d.time * s + a * s * s);
      v.copy(d.dir).multiplyScalar(d.v0 + 2 * a * s / d.time);
      if (s >= 1) Object.assign(d, { phase: 'up', t: 0 });
    } else {
      const s = Math.min(d.t / D.up, 1), flat = new Vector3(d.dir.x, 0, d.dir.z);
      if (flat.lengthSq() < 1e-6) flat.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      flat.normalize();
      const exit = d.aim.clone().addScaledVector(flat, D.exit).add(new Vector3(0, D.rise, 0));
      const out = flat.clone().multiplyScalar(FLIGHT.speed).add(new Vector3(0, 1.5, 0));
      hermite(d.aim, d.dir.clone().multiplyScalar(D.speed), exit, out, D.up, s, p, v);
      if (s >= 1) this.dived = null;
    }
    if (Math.hypot(v.x, v.z) > 1e-3) this.heading = Math.atan2(v.x, v.z);
    // A hit: the middle of the body comes near the target (where it is now), once a dive.
    if (d.phase !== 'line' && !d.hit && p.distanceTo(this.target) - FLIGHT.centre < D.hit) {
      d.hit = true;
      this.events.push({ type: 'hit', at: p.clone().setY(p.y + FLIGHT.centre) });
    }
  }

  // The way in, the perch and the take off.
  perchStep(dt) {
    const pe = this.perched, L = FLIGHT.perch, p = this.position, v = this.velocity;
    pe.t += dt;
    const ahead = new Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)), up = new Vector3(0, 1, 0);
    if (pe.phase === 'in') {
      const s = Math.min(pe.t / pe.time, 1), flat = new Vector3(pe.at.x - pe.from.x, 0, pe.at.z - pe.from.z);
      if (flat.lengthSq() < 1e-6) flat.copy(ahead);
      flat.normalize();
      // Along face, the way that is nearer the way in.
      if (pe.face) flat.copy(pe.face).multiplyScalar(pe.face.dot(flat) < 0 ? -1 : 1);
      const touch = flat.multiplyScalar(L.touch[0]).addScaledVector(up, -L.touch[1]);
      hermite(pe.from, pe.v0, pe.at, touch, pe.time, s, p, v);
      if (Math.hypot(v.x, v.z) > 0.3) this.heading = Math.atan2(v.x, v.z);
      this.stand = smoothstep(1 - L.flare, 1, s);
      if (s >= 1) Object.assign(pe, { phase: 'sit', t: 0 });
    } else if (pe.phase === 'sit') {
      p.copy(pe.at);
      v.set(0, 0, 0);
      this.stand = 1;
    } else {
      const s = Math.min(pe.t / L.outTime, 1);
      const exit = pe.from.clone().addScaledVector(ahead, L.out[0]).addScaledVector(up, L.out[1]);
      const out = ahead.clone().multiplyScalar(FLIGHT.speed).addScaledVector(up, 1);
      hermite(pe.from, ahead.clone().multiplyScalar(0.5).addScaledVector(up, L.jump), exit, out, L.outTime, s, p, v);
      this.stand = 1 - smoothstep(0.05, 0.45, s);
      if (s >= 1) { this.perched = null; this.stand = 0; }
    }
  }

  makePose() {
    const P = this.pose, w = this.wing, rest = restPose(), climb = this.climb, dive = this.anger;
    Object.assign(P, rest, { look: P.look.set(0, 0), lift: this.lift });
    P.pitch = rest.pitch + FLIGHT.pitch + clamp(climb, -0.6, 1.1);
    P.roll = clamp(-FLIGHT.bank * this.turn, -0.7, 0.7);
    // The head looks along the flight path, and down at the target in a dive.
    P.headPitch = 0.1 + 0.5 * clamp(climb, -0.6, 1.1) + 0.2 * dive;
    P.look.set(0, -0.3 * dive);
    const beat = Math.sin(TAU * this.phase);
    P.wingL = P.wingR = w.base + w.amp * beat;
    P.sweepL = P.sweepR = w.sweep;
    P.bob = -0.02 * beat;
    const t = FLIGHT.tuck;
    P.footL.set(t.x, t.y, t.z);
    P.footR.set(-t.x, t.y, t.z);
    P.footYawL = P.footYawR = Math.PI;
    P.air = 1;
    // Angry in the dive.
    P.lid = 0.3 * dive;
    P.lidTilt = 0.9 * dive;
    P.lowLid = 0.2 * dive;
    P.jaw = 0.2 * dive;
    if (this.stand > 0) this.standPose(beat);
  }

  // Blends toward standing: the idle clip of the ibis rig, with a dip at touch down and a crouch before
  // the jump of the take off. The wings keep their own beat. On the way in, the body comes up (a flare).
  standPose(beat) {
    const P = this.pose, pe = this.perched, w = this.wing;
    const S = clipPose('idle', this.time);
    S.lift = this.lift;
    if (pe?.phase === 'sit') S.bob -= 0.06 * Math.sin(Math.PI * Math.min(pe.t / 0.25, 1));
    if (pe?.phase === 'out') S.bob -= 0.1 * window4(0, 0.03, 0.06, 0.15, pe.t / FLIGHT.perch.outTime);
    if (pe?.phase === 'in') P.pitch -= 0.6 * this.stand;
    Object.assign(P, mixPose(P, S, this.stand));
    P.wingL = P.wingR = w.base + w.amp * beat;
    P.sweepL = P.sweepR = w.sweep;
  }
}

// The close views (sdf.html and index.html with fly): 1 circles. 2: a dive at a head at the origin as
// soon as the last one ends. 3: lands on a point in the middle of its circle, sits for 1.5 s, takes off,
// and again. The bird flies on the spot, lifted so the wings stay above the ground. Call the result each
// frame before flight.update().
export function flightDemo(flight, mode) {
  flight.target.set(0, 1.9, 0);
  flight.lift = 0.5;
  flight.makePose();
  const perch = new Vector3(0, 1.3, 0);
  let wait = 0.3;
  return dt => {
    if (mode === 2 && !flight.diving && (wait -= dt) <= 0) { flight.dive(); wait = 1; }
    if (mode === 3 && flight.circling && (wait -= dt) <= 0) { flight.land(perch); wait = 1.5; }
    if (mode === 3 && flight.landed && (wait -= dt) <= 0) { flight.takeOff(); wait = 1.5; }
  };
}
