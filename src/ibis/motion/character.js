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

const STEP = 1 / 120;      // longest sub step, seconds
const PROD_MEMORY = 3;     // seconds: a prod within this time of the last one adds to the annoyance

export class Character {
  constructor({ seed = 0 } = {}) {
    this.controller = new Controller();
    this.animator = new Animator(seed);
    this.events = [];   // this update: controller and animator events, for sound and effects
  }

  get input() { return this.controller.input; }
  get position() { return this.controller.position; }
  get heading() { return this.controller.heading; }
  get pose() { return this.animator.pose; }
  get action() { return this.animator.action; }

  act(name, options) { this.animator.play(name, options); }
  stop() { this.animator.stop(); }
  lookAt(heading, seconds = 1.5) { this.animator.lookAt(heading, seconds); }
  turnTo(heading) { this.controller.turnTo(heading); }

  // A prod (a click or a tap) at a point in character space. Each prod soon after the last one annoys
  // the bird more: it looks away, then glares, then shakes itself, then turns and threatens.
  prod(point) {
    const a = this.animator;
    a.prod(point);
    this.prods = (a.time - (this.lastProd ?? -9) < PROD_MEMORY ? this.prods : 0) + 1;
    this.lastProd = a.time;
    const toward = this.heading + Math.atan2(point.x, point.z);
    if (this.prods === 1) { this.act('flinch'); a.lookAt(toward + Math.PI, 1.2); }
    else if (this.prods === 2) { this.act('glare'); a.lookAt(toward, 1.2); }
    else if (this.prods === 3) this.act('shake');
    else { this.prods = 0; this.turnTo(toward); this.act('threat'); }
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
      a.step(dt / n, c);
      this.events.push(...a.events);
    }
    return a.pose;
  }
}
