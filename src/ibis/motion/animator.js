// Procedural animator: makes a Pose each step from the controller state, in layers.
//   1. Base: the idle clip, the waddle gait (by speed) and the air pose (by jump state).
//   2. Face: an expression for the state, smoothed, so the face never pops.
//   3. Actions: one-shot moves over the base, with channel masks (see actions.js).
//   4. Secondary: the look chain (eyes, then head, then body), lean into speed changes and turns,
//      squash and stretch, hit reactions and wing flicks on springs, and blinks.
// The pose comes only from the state and the time step, so the same input gives the same motion.
import { Vector2, Vector3 } from 'three';
import { clipPose, mixPose, restPose } from '../rig.js';
import { ACTIONS, FACE_KEYS, blendMasked, face } from './actions.js';
import { MOVE } from './controller.js';
import { Spring, TAU, clamp, damp, hash, mix, smoothstep, window4, wrapAngle } from './spring.js';

// Waddle. Pairs are [slow, fast]; the gait blends between them by speed.
export const GAIT = {
  cadence: [1.45, 2.6],   // foot cycles per second: short legs, quick steps
  duty: [0.62, 0.5],      // part of the cycle that a foot is on the ground
  lift: [0.11, 0.09],     // foot lift in the swing
  width: [0.25, 0.27],    // foot distance from the middle. Slow is the idle stance
  waddle: [0.11, 0.07],   // body roll toward the foot on the ground
  sway: [0.035, 0.02],    // pelvis moves over the foot on the ground
  splay: 0.25,            // toes turn out
  misstep: 0.1,           // part of the steps that scuff
  spinCadence: 2.8,       // quick small steps to turn on the spot
  spinLift: 0.07,
  footLock: 0.75,         // part of the body turn that a planted foot keeps (the rest is a pivot on the foot)
  settle: 0.04,           // after a stop, the bird steps until each foot is this near its place
};

const LOOK = {
  headHalflife: 0.05,     // the head follows the eyes this fast
  maxHeadYaw: 1.2,        // the body turns for the rest
  bodyShare: 0.15,        // part of the head turn that the body also turns
};

const BLINK_TIME = 0.16;

export class Animator {
  constructor(seed = 0) {
    this.seed = seed;
    this.time = 0;
    this.pose = restPose();
    this.events = [];

    this.phase = 0;                      // left foot cycle, 0..1. The right foot is half a cycle on
    this.steps = 0;
    this.scuff = [false, false];
    this.plants = [null, null];          // world { x, z, yaw } of each foot on the ground, or null
    this.swingFrom = [null, null];       // world { x, z, yaw } where each foot lifted off
    this.footError = 0;                  // how far the planted feet are from their places
    this.pivot = null;                   // world { x, z } of the foot that carries the weight
    this.twist = 0;                      // chest turn ahead of the legs
    this.turning = false;
    this.gait = new Spring(0, 4, 1);     // 0 idle, 1 walking
    this.airW = new Spring(0, 8, 1);     // 0 on the ground, 1 in the air
    this.air = { pitch: 0, tuck: 0, pedal: 0, headPitch: 0, lookY: 0, jaw: 0, wingBase: 0, wingAmp: 0, wingFreq: 3 };
    this.wingPhase = 0;

    this.lean = new Spring(0, 2.5, 0.6);   // pitch from speed changes
    this.bank = new Spring(0, 2.5, 0.6);   // roll into turns
    this.squash = new Spring(0, 3.2, 0.4); // more than 0 squash, less than 0 stretch
    this.hitPitch = new Spring(0, 2.6, 0.35);
    this.hitRoll = new Spring(0, 2.6, 0.35);
    this.flickL = new Spring(0, 3, 0.3);
    this.flickR = new Spring(0, 3, 0.3);

    this.faceNow = face('neutral');
    this.headHeading = 0;
    this.look = null;                    // { heading, until }: look at a heading for a time
    this.blinkAt = 1.6 + 2 * hash(seed);
    this.blinks = 0;

    this.actions = [];                   // playing: { name, def, t, weight, fadeIn, out, outFrom, outT }
  }

  // Plays an action from actions.js. The action that plays now fades out from where it is.
  play(name, { fadeIn } = {}) {
    const def = ACTIONS[name];
    this.stop();
    fadeIn = fadeIn ?? def.fadeIn;
    this.actions.push({ name, def, t: 0, weight: fadeIn > 0 ? 0 : 1, fadeIn, out: false, outFrom: 0, outT: 0 });
  }

  stop() {
    for (const a of this.actions) if (!a.out) Object.assign(a, { out: true, outFrom: a.weight, outT: 0 });
  }

  get action() { const a = this.actions.find(x => !x.out); return a ? a.name : null; }

  // Looks toward a world heading for some seconds. The head turns first, then the body if it must.
  lookAt(heading, seconds) { this.look = { heading, until: this.time + seconds }; }

  blink() { this.blinkAt = this.time; }

  // A prod at point (character space): the body rocks away from it, the eyes squeeze, the wings flick.
  prod(point) {
    const len = Math.hypot(point.x, point.z) || 1;
    this.hitRoll.kick(4 * point.x / len);
    this.hitPitch.kick(-4 * point.z / len);
    this.squash.kick(6);
    this.flickL.kick(6);
    this.flickR.kick(6);
  }

  step(dt, c) {
    this.time += dt;
    this.events.length = 0;
    for (const e of c.events) this.onEvent(e);

    const speed = Math.abs(c.speed);
    const fast = clamp((speed - MOVE.slow) / (MOVE.fast - MOVE.slow), 0, 1);
    const planted = this.plants[0] || this.plants[1];
    const settle = planted && this.footError > GAIT.settle ? 0.3 : 0;
    const drive = c.state === 'ground' ? Math.max(speed, Math.abs(c.turn) * 0.12, settle) : 0;
    const gaitW = this.gait.update(dt, drive > 0.04 ? 1 : 0);
    if (gaitW < 0.01 && drive <= 0.04) this.plants = [null, null];
    const airW = this.airW.update(dt, c.state === 'air' ? 1 : 0);

    // 1. Base.
    let P = clipPose('idle', this.time);
    if (gaitW > 0.001 || drive > 0.04) {
      const W = this.waddle(dt, c, fast, drive);
      P = mixPose(P, W, clamp(gaitW, 0, 1));
      // The planted feet start where the feet are, so while the gait drives, the legs take it at full
      // weight: a part blend would slide the feet.
      if (drive > 0.04) for (const key of ['footL', 'footR', 'footYawL', 'footYawR']) P[key] = W[key];
    } else this.pivot = null;
    if (airW > 0.001 || c.state === 'air') P = mixPose(P, this.airPose(dt, c), clamp(airW, 0, 1));

    // 2. Face.
    const want = face(c.state !== 'air' ? 'neutral' : c.fluttering ? 'effort' : c.vy < -1.5 ? 'wide' : 'neutral');
    for (const k of FACE_KEYS) P[k] = this.faceNow[k] += (want[k] - this.faceNow[k]) * damp(0.035, dt);

    // 3. Actions.
    const moving = clamp(Math.max(gaitW, airW), 0, 1);
    this.actions = this.actions.filter(a => this.runAction(a, P, dt, moving));

    // 4. Secondary.
    this.secondary(P, dt, c);
    P.lift = c.position.y;
    this.pose = P;
    return P;
  }

  // Root motion and input lock from the action that plays now. See actions.js.
  get root() {
    const a = this.actions.find(x => !x.out);
    return a && a.def.root ? a.def.root(a.t) : null;
  }

  // 0 to 1: how angry the bird looks now, from the actions that play (their anger times their weight).
  get anger() {
    return this.actions.reduce((m, a) => Math.max(m, (a.def.anger || 0) * a.weight), 0);
  }

  get locked() {
    const a = this.actions.find(x => !x.out);
    return !!a && !!a.def.lock && a.t < (a.def.cancelAfter ?? a.def.length);
  }

  onEvent(e) {
    if (e.type === 'thump') this.squash.kick(e.amount ?? 12);
    if (e.type === 'crouch') this.squash.kick(22);
    if (e.type === 'jump') { this.squash.kick(-30); this.wingPhase = 0.25; }
    if (e.type === 'land') {
      this.squash.kick(clamp(e.impact * 5, 6, 30));
      this.flickL.kick(4);
      this.flickR.kick(4);
      if (e.impact > 4) this.blink();
    }
    this.events.push(e);
  }

  // Waddle. A foot on the ground stays where it is in the world, so the feet never slide, and the body
  // walks over it. A foot in the air steps to a place ahead, turned into the turn. Turning on the spot
  // is quick small steps, inside foot first, with the weight over the pivot foot. The body rocks over the
  // foot on the ground, the head bobs with each step, and the wings lift a little for balance. Fast is a
  // scurry: quicker steps, body forward, wings out.
  waddle(dt, c, fast, drive) {
    const g = k => Array.isArray(GAIT[k]) ? mix(GAIT[k][0], GAIT[k][1], fast) : GAIT[k];
    const spin = clamp(Math.abs(c.turn) / 4, 0, 1) * (1 - clamp(Math.abs(c.speed) / MOVE.slow, 0, 1));
    const cadence = mix(g('cadence') * clamp(drive / 0.3, 0.7, 1), GAIT.spinCadence, spin);
    const duty = mix(g('duty'), 0.5, spin);
    const stance = duty / cadence;                 // seconds that a foot is on the ground
    const stride = c.speed * stance / 2;
    const ahead = clamp(c.turn * stance * 0.5, -0.6, 0.6);   // a foot lands turned by half its stance turn
    const sh = Math.sin(c.heading), ch = Math.cos(c.heading);
    const toWorld = (v, yaw) => ({ x: c.position.x + v.x * ch + v.z * sh, z: c.position.z - v.x * sh + v.z * ch, yaw: c.heading + yaw });
    const toLocal = (w, y) => {
      const dx = w.x - c.position.x, dz = w.z - c.position.z;
      return new Vector3(dx * ch - dz * sh, y, dx * sh + dz * ch);
    };
    const yawOf = w => clamp(wrapAngle(w.yaw - c.heading), -0.9, 0.9) * GAIT.footLock;
    const landing = side => {
      const x = side * g('width'), z = 0.06 + stride, ca = Math.cos(ahead), sa = Math.sin(ahead);
      return new Vector3(x * ca + z * sa, 0.05, z * ca - x * sa);
    };

    // First step at once: the inside foot of the turn lifts now, the other is planted where it stands.
    if (!this.plants[0] && !this.plants[1]) {
      const first = c.turn < -0.1 ? 1 : 0;
      this.phase = first === 0 ? duty - 1e-4 : (duty + 0.5 - 1e-4) % 1;
      ['footL', 'footR'].forEach((key, i) => { this.plants[i] = toWorld(this.pose[key], this.pose['footYaw' + key[4]]); });
    }

    const before = this.phase;
    this.phase = (this.phase + cadence * dt) % 1;
    const G = restPose();
    let error = 0, pivot = null, pivotDepth = 1;
    [[this.phase, before, 1], [(this.phase + 0.5) % 1, (before + 0.5) % 1, -1]].forEach(([p, prev, side], i) => {
      const key = i === 0 ? 'footL' : 'footR', yawKey = i === 0 ? 'footYawL' : 'footYawR';
      if (prev < duty && p >= duty) { this.liftOff(i, c); this.swingFrom[i] = this.plants[i]; this.plants[i] = null; }
      if (p < prev) { this.touchDown(i, side); this.plants[i] = toWorld(landing(side), ahead); }
      if (p < duty) {
        if (!this.plants[i]) this.plants[i] = toWorld(landing(side), ahead);
        const w = this.plants[i];
        G[key].copy(toLocal(w, 0.05));
        G[yawKey] = yawOf(w);
        const home = new Vector3(side * GAIT.width[0], 0.05, 0.06);
        error = Math.max(error, G[key].distanceTo(home), Math.abs(G[yawKey]) * 0.3);
        const depth = Math.abs(p / duty - 0.5);
        if (depth < pivotDepth) { pivotDepth = depth; pivot = w; }
      } else {
        const u = smoothstep(0, 1, (p - duty) / (1 - duty));
        const from = this.swingFrom[i];
        const start = from ? toLocal(from, 0.05) : landing(side);
        G[key].copy(start.lerp(landing(side), u));
        G[key].y += mix(g('lift'), GAIT.spinLift, spin) * (this.scuff[i] ? 0.25 : 1) * Math.sin(Math.PI * (p - duty) / (1 - duty));
        G[yawKey] = mix(from ? yawOf(from) : 0, ahead * GAIT.footLock, u);
      }
    });
    this.footError = error;
    this.pivot = pivot;

    // The weight goes over the foot on the ground, more so in a turn on the spot, with a lean into it.
    const m = TAU * (this.phase - duty / 2);   // 0 when the left foot is in the middle of its stance
    G.splay = GAIT.splay;
    G.x = (g('sway') + 0.03 * spin) * Math.cos(m);
    G.roll = -(g('waddle') + 0.04 * spin) * Math.cos(m) - 0.08 * spin * Math.sign(c.turn);
    G.yaw = 0.06 * (1 - 0.5 * fast) * Math.sin(m);
    G.bob = -0.03 - 0.01 * fast - 0.015 * spin + (0.025 + 0.015 * fast) * Math.cos(2 * m);
    G.pitch = 0.22 + 0.14 * fast;
    G.neck = 0.1 * fast;
    G.headFwd = (0.05 + 0.03 * fast) * Math.sin(2 * m + 1.0) + 0.04 * fast;
    G.headPitch = 0.16 + 0.05 * fast;
    const flap = fast * (0.42 + 0.12 * Math.sin(2 * m)) + 0.1 * spin;
    G.wingL = 0.05 + 0.04 * Math.max(Math.sin(m), 0) + flap;
    G.wingR = 0.05 + 0.04 * Math.max(-Math.sin(m), 0) + flap;
    G.look.set(0, 0.05);
    return G;
  }

  liftOff(i, c) {
    this.steps++;
    this.events.push({ type: 'liftOff', foot: i === 0 ? 'L' : 'R' });
    this.scuff[i] = c.speed > 0.3 && c.root === null && hash(this.steps * 7919 + this.seed) < GAIT.misstep;
  }

  // A scuffed step lands badly: the body lurches forward, a wing flicks out, the eyes blink.
  touchDown(i, side) {
    const scuff = this.scuff[i];
    this.scuff[i] = false;
    this.events.push({ type: 'step', foot: side > 0 ? 'L' : 'R', scuff });
    if (!scuff) return;
    this.hitPitch.kick(2.5);
    this.hitRoll.kick(-1.5 * side);
    (side > 0 ? this.flickR : this.flickL).kick(9);
    this.squash.kick(5);
    this.blink();
  }

  // In the air: wings beat, legs tuck on the way up, pedal in the flutter, reach down to land.
  airPose(dt, c) {
    const flutter = c.fluttering, up = c.vy > 0 && !flutter;
    const target = flutter
      ? { pitch: 0.12, tuck: 0.12, pedal: 1, headPitch: 0, lookY: 0.1, jaw: 0, wingBase: 1.0, wingAmp: 0.4, wingFreq: 7.5 }
      : up
        ? { pitch: -0.05, tuck: 0.12, pedal: 0, headPitch: -0.2, lookY: 0.25, jaw: 0.05, wingBase: 1.0, wingAmp: 0.55, wingFreq: 3.2 }
        : { pitch: 0.2, tuck: -0.02, pedal: 0, headPitch: 0.3, lookY: -0.3, jaw: 0.15, wingBase: 1.3, wingAmp: 0.08, wingFreq: 4 };
    const a = this.air, k = damp(0.04, dt);
    for (const key in target) a[key] += (target[key] - a[key]) * k;
    this.wingPhase = (this.wingPhase + a.wingFreq * dt) % 1;
    const beat = Math.sin(TAU * this.wingPhase);

    const A = restPose();
    const pedal = TAU * 3.2 * this.time;
    [['footL', 1, 0], ['footR', -1, Math.PI]].forEach(([key, side, off]) => {
      A[key].set(side * 0.22,
        0.05 + a.tuck + a.pedal * 0.07 * Math.sin(pedal + off),
        0.06 + 0.06 * Math.max(-a.tuck, 0) / 0.02 + a.pedal * 0.1 * Math.cos(pedal + off));
    });
    A.pitch = a.pitch;
    A.bob = flutter ? 0.02 * beat : 0;
    A.headPitch = a.headPitch;
    A.look = new Vector2(0, a.lookY);
    A.jaw = a.jaw;
    A.wingL = A.wingR = a.wingBase + a.wingAmp * beat;
    return A;
  }

  // Runs one action into P. Returns false when the action is done.
  runAction(a, P, dt, moving) {
    const { def } = a;
    const before = a.t;
    a.t += dt;
    for (const e of def.events ?? []) if (before < e.at && a.t >= e.at) this.onEvent({ ...e, action: a.name });
    if (!a.out && a.t >= def.length - def.fadeOut) Object.assign(a, { out: true, outFrom: a.weight, outT: 0 });
    if (a.out) {
      a.outT += dt;
      a.weight = a.outFrom * (1 - clamp(a.outT / def.fadeOut, 0, 1));
    } else {
      a.weight = a.fadeIn > 0 ? Math.min(a.t / a.fadeIn, 1) : 1;
    }
    if (a.weight <= 0) return false;

    const Q = mixPose(P, P, 0);
    if (def.face) Object.assign(Q, face(def.face));
    def.apply(Q, Math.min(a.t, def.length));
    const mask = {};
    for (const ch of new Set([...Object.keys(def.mask), ...Object.keys(def.moveMask)])) {
      mask[ch] = mix(def.mask[ch] || 0, def.moveMask[ch] || 0, moving);
    }
    blendMasked(P, Q, smoothstep(0, 1, a.weight), mask);
    return true;
  }

  secondary(P, dt, c) {
    // Look chain: the eyes go to the new heading at once, the head follows fast, the body last (the
    // controller turns it at its own rate). A big turn gets a blink, as an animator would draw it.
    if (this.look && this.time > this.look.until) this.look = null;
    const want = this.look ? this.look.heading : c.wantHeading;
    const gap = wrapAngle(want - this.headHeading);
    if (Math.abs(gap) > 0.9 && this.time - this.blinkAt > 0.4) this.blink();
    this.headHeading = wrapAngle(this.headHeading + gap * damp(LOOK.headHalflife, dt));
    const head = clamp(wrapAngle(this.headHeading - c.heading), -LOOK.maxHeadYaw, LOOK.maxHeadYaw);
    P.headYaw += head;
    P.yaw += LOOK.bodyShare * head;
    // The chest turns ahead of the legs. A big turn starts with a small dip, the wind-up.
    const left = wrapAngle(c.wantHeading - c.heading);
    this.twist += (clamp(left * 0.45, -0.45, 0.45) - this.twist) * damp(0.04, dt);
    P.yaw += this.twist;
    if (!this.turning && Math.abs(left) > 1.0 && c.grounded) { this.turning = true; this.squash.kick(5); }
    if (Math.abs(left) < 0.2) this.turning = false;
    P.look.x += clamp(1.2 * wrapAngle(want - this.headHeading), -0.8, 0.8);

    // Lean into speed changes and turns.
    P.pitch += this.lean.update(dt, clamp(c.accel * 0.025, -0.15, 0.15));
    P.roll += this.bank.update(dt, clamp(-c.turn * c.speed * 0.08, -0.2, 0.2));

    // Squash and stretch. No bone scale (the shader line tests do not know it): the body drops, the
    // head sinks into the shoulders and the wings rise.
    const s = clamp(this.squash.update(dt, c.state === 'crouch' ? 1 : 0), -1, 1.3);
    P.bob -= 0.1 * Math.max(s, 0);
    P.stretch *= 1 - 0.22 * s;
    P.headPitch += 0.2 * s;
    P.pitch += 0.1 * s;
    P.wingL += 0.15 * Math.max(s, 0);
    P.wingR += 0.15 * Math.max(s, 0);

    // Hit reactions and wing flicks.
    P.pitch += this.hitPitch.update(dt, 0);
    P.roll += this.hitRoll.update(dt, 0);
    P.wingL += Math.max(this.flickL.update(dt, 0), -0.05);
    P.wingR += Math.max(this.flickR.update(dt, 0), -0.05);

    // Blinks at random times, and on demand (blink()).
    if (this.time >= this.blinkAt + BLINK_TIME) {
      this.blinks++;
      this.blinkAt = this.time + 2 + 3 * hash(this.blinks * 31 + this.seed);
    }
    const b = window4(0, 0.04, 0.08, BLINK_TIME, this.time - this.blinkAt);
    P.lid = mix(P.lid, 1, b * (1 - P.blink));
  }
}
