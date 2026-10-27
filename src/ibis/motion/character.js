// A controllable ibis: the controller (where it is) and the animator (how it looks), stepped together
// at a fixed rate.
//
//   const c = new Character();
//   c.input.move.set(x, z);   // wanted direction on the ground, length 0 to 1
//   c.input.fast = true;      // run
//   c.input.jump = true;      // held: jump, then flutter
//   c.act('happy');           // an action from actions.js
//   const pose = c.update(dt);   // then c.position and c.heading place the character in the world
import { Animator } from './animator.js';
import { Controller } from './controller.js';
import { hash } from './spring.js';

const STEP = 1 / 120;      // longest sub step, seconds
const PROD_MEMORY = 3;     // seconds: a prod within this time of the last one adds to the annoyance
const TRIP_SPEED = 1.7;    // a prod at this speed or more trips the bird: a run (a walk tops out at 1.25)
// A knock into a heavy prop trips the bird only at about a full run, and only sometimes (never the first):
// most knocks are a headbutt push.
const KNOCK_TRIP = { speed: 2.8, chance: 0.25 };

export class Character {
  constructor({ seed = 0 } = {}) {
    this.controller = new Controller();
    this.animator = new Animator(seed);
    this.events = [];   // this update: controller and animator events, for sound and effects
    // (controller, dt) => void, or null. Runs after each controller sub step, and can move the root
    // back out of solid things (src/world/physics.js).
    this.collide = null;
    this.snapAt = null;   // a miner that a peck snaps at now (world point, from sentry.js), or null
  }

  get input() { return this.controller.input; }
  get position() { return this.controller.position; }
  get heading() { return this.controller.heading; }
  get pose() { return this.animator.pose; }
  get action() { return this.animator.action; }

  // A peck with a prop in the bill drops it. With a miner to snap at (snapAt), a peck is a snap at it,
  // with the head turned to it.
  act(name, options) {
    if (name === 'peck' && this.controller.carry !== null) name = 'drop';
    else if (name === 'peck' && this.snapAt) {
      name = 'snap';
      const p = this.position, m = this.snapAt;
      this.animator.lookAt(Math.atan2(m.x - p.x, m.z - p.z), 0.6);
    }
    this.animator.play(name, options);
  }
  turnTo(heading) { this.controller.turnTo(heading); }

  // A prod (a click or a tap) at a point in character space. Each prod soon after the last one annoys
  // the bird more: it looks away, then glares, then shakes its head, then shakes itself, then turns and
  // startles. A prod at a run trips it.
  prod(point) {
    const a = this.animator;
    a.prod(point);
    if (this.trip()) return;
    this.prods = (a.time - (this.lastProd ?? -9) < PROD_MEMORY ? this.prods : 0) + 1;
    this.lastProd = a.time;
    const toward = this.heading + Math.atan2(point.x, point.z);
    if (this.prods === 1) { this.act('flinch'); a.lookAt(toward + Math.PI, 1.2); }
    else if (this.prods === 2) { this.act('glare'); a.lookAt(toward, 1.2); }
    else if (this.prods === 3) this.act('headShake');
    else if (this.prods === 4) this.act('shake');
    else { this.prods = 0; this.turnTo(toward); this.act('startle'); }
  }

  // A blow from a diving bird at a point in character space: it stumbles on the ground at any speed. In
  // the air, or while it already stumbles, it flinches as from a prod.
  strike(point) {
    if (this.action === 'stumble') return;
    if (!this.trip(0)) this.prod(point);
  }

  // The bird runs into something heavy (src/world/physics.js). At a full run it sometimes trips over it.
  knock() {
    this.knocks = (this.knocks ?? 0) + 1;
    // Never the first: the first bump shows the push.
    if (this.knocks > 1 && hash(this.knocks * 7919 + this.animator.seed) < KNOCK_TRIP.chance) this.trip(KNOCK_TRIP.speed);
  }

  // Stumbles if the bird runs on the ground at speed or more. Gives true if it does.
  trip(speed = TRIP_SPEED) {
    if (Math.abs(this.controller.speed) < speed || !this.controller.grounded || this.action === 'stumble') return false;
    this.act('stumble');
    return true;
  }

  update(dt) {
    this.events.length = 0;
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    const c = this.controller, a = this.animator;
    for (let i = 0; i < n; i++) {
      // Root motion and input lock from the action. After its cancel time, input ends a locking action.
      const wants = c.input.move.lengthSq() > 0.01 || c.input.jump;
      if (a.playing?.def.lock && !a.locked && wants) a.stop();
      c.root = a.root;
      c.locked = a.locked;
      c.pivot = a.pivot;
      c.step(dt / n);
      this.collide?.(c, dt / n);
      a.step(dt / n, c);
      this.events.push(...a.events);
    }
    return a.pose;
  }
}
