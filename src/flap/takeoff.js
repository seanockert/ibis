// Greedy Guts, the take-off: a fat ibis runs at a fence and flaps to get over it. Pure rules, no three.js,
// so a script can tune them.
//
//   const t = new Takeoff(fat);   // fat: chips eaten, 0 up
//   t.press();                    // the flap button
//   t.step(dt);                   // x, y, vx, vy, state; t.events this step
//
// The flap is the skill. After a flap the wings come back up (recover). A flap with the wings up (in the
// window) is full strength. A flap before they are up is a weak flail, and the wings start again. A flap
// after the window is good, but the bird has sunk meanwhile. Full flaps in a row get stronger. Fat: a
// narrower window (most of all), more gravity, a slower recovery and a slower run-up. Tuned with bots:
// perfect timing clears about 10 chips, a 30 ms error 7, a 50 ms error 5, an 80 ms error 2.
export const TAKEOFF = {
  start: -8,            // x of the start; the fence is at 0
  fence: 2.6,           // height of the top rail. The bird is 2 tall
  gravity: [15, 0.04],  // units per second squared, and the part more for each chip
  lift: 5.4,            // up speed of a full flap
  keep: 0.25,           // part of the up speed that a flap keeps
  stroke: 0.1,          // seconds of the down stroke
  recover: [0.24, 0.015],      // seconds for the wings to come up, and more for each chip
  window: [0.17, 0.018, 0.06], // seconds the wings stay up for a full flap: at 0 fat, less for each chip, the least
  flail: 0.2,           // strength of a flap too early
  late: 0.65,           // strength of a flap after the window
  chain: [0.07, 0.35],  // a full flap after a full flap is this much stronger, up to the most
  run: [3.2, 0.2, 1.6], // run speed: at 0 fat, less for each chip, the least
  push: 0.12,           // forward speed of a full flap in the air
  // The lowest point of the drawn bird above its root in the air: the tucked feet, then the belly from
  // sagFrom chips, sag lower for each chip (measured on the mesh and the belly bulge of flap/main.js).
  feet: 0.19, sag: 0.04, sagFrom: 4,
  scrape: 0.3,          // a bird up to this much under the rail drags its belly over it
  wide: 0.75,           // the bill tip ahead of the root, flying: where the bird meets the fence
  bounce: 0.8,          // a crash knocks the bird back this far off the fence: the bill stays clear of it
};

export class Takeoff {
  constructor(fat = 0) {
    this.fat = fat;
    this.x = TAKEOFF.start;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.state = 'wait';   // wait, run, air, crash, over (cleared and landed)
    this.since = Infinity; // seconds since the last flap
    this.time = 0;
    this.flaps = [];       // { at, kind }: perfect, early, late, hop
    this.events = [];
    this.scraped = false;
    this.chain = 0;        // full flaps in a row
  }

  get gravity() { return TAKEOFF.gravity[0] * (1 + TAKEOFF.gravity[1] * this.fat); }
  get recover() { return TAKEOFF.stroke + TAKEOFF.recover[0] + TAKEOFF.recover[1] * this.fat; }
  get window() { return Math.max(TAKEOFF.window[0] - TAKEOFF.window[1] * this.fat, TAKEOFF.window[2]); }
  get runSpeed() { return Math.max(TAKEOFF.run[0] - TAKEOFF.run[1] * this.fat, TAKEOFF.run[2]); }
  get bottom() { return this.y + TAKEOFF.feet - TAKEOFF.sag * Math.max(this.fat - TAKEOFF.sagFrom, 0); }

  // 0 just after a flap, 1 when the wings are up (ready), more than 1 past the window. For the wings and the
  // ring.
  get beat() { return this.since / this.recover; }
  get ready() { return this.since >= this.recover && this.since <= this.recover + this.window; }

  press() {
    if (this.state === 'wait') { this.state = 'run'; this.events.push({ type: 'go' }); return; }
    if (this.state !== 'run' && this.state !== 'air') return;
    let kind, q;
    if (this.state === 'run') { kind = 'hop'; q = 1; }
    else if (this.since < this.recover) { kind = 'early'; q = TAKEOFF.flail; }
    else if (this.since <= this.recover + this.window) { kind = 'perfect'; q = 1; }
    else { kind = 'late'; q = TAKEOFF.late; }
    this.chain = kind === 'perfect' ? this.chain + 1 : kind === 'hop' ? this.chain : 0;
    if (kind === 'perfect') q *= 1 + Math.min(TAKEOFF.chain[0] * (this.chain - 1), TAKEOFF.chain[1]);
    this.vy = Math.max(this.vy, 0) * TAKEOFF.keep + TAKEOFF.lift * q;
    if (kind === 'perfect') this.vx += TAKEOFF.push;
    this.since = 0;
    this.state = 'air';
    this.flaps.push({ at: this.time, kind });
    this.events.push({ type: 'flap', kind });
  }

  step(dt) {
    this.events = [];
    this.time += dt;
    this.since += dt;
    if (this.state === 'wait' || this.state === 'crash' || this.state === 'over') return;
    if (this.state === 'run') this.vx += (this.runSpeed - this.vx) * Math.min(dt * 6, 1);
    const before = this.x;
    this.x += this.vx * dt;
    if (this.state === 'air') {
      this.vy -= this.gravity * dt;
      this.y += this.vy * dt;
    }
    // The fence: the front of the bird meets it.
    const front = this.x + TAKEOFF.wide, back = this.x - TAKEOFF.wide;
    if (before + TAKEOFF.wide < 0 && front >= 0) {
      const under = TAKEOFF.fence - this.bottom;
      if (under > TAKEOFF.scrape) { this.state = 'crash'; this.x = -TAKEOFF.wide - TAKEOFF.bounce; this.events.push({ type: 'crash', under }); return; }
      if (under > 0) { this.scraped = true; this.vx *= 0.6; this.y += under; this.vy = Math.max(this.vy, 0); this.events.push({ type: 'scrape' }); }
    }
    if (this.state === 'air' && this.y <= 0 && this.vy <= 0) {
      this.y = 0;
      this.vy = 0;
      const over = back > 0;
      this.state = over ? 'over' : 'run';
      this.events.push({ type: 'land', over });
    }
  }
}
