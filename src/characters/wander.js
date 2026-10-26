// Wander: a simple brain for a character that no player drives. It walks to a point near its home,
// waits, and picks another. It writes the input that a player gives (character.input), so it drives any
// species with a Controller. Random values come from hash() with the seed.
//
//   const brain = new Wander(seed, [x, z], bounds);
//   brain.update(character, dt);   // every frame, before the character's update
import { clamp, hash } from '../ibis/motion/spring.js';

// range: the most a goal is from home, units. wait: the pause at a goal, shortest and longest, seconds.
// run: the chance to run to a goal. reach: near enough to a goal. stuck: seconds with no progress (a prop
// in the way) before it gives up on a goal.
export const WANDER = { range: 5, wait: [1.5, 5], run: 0.15, reach: 0.3, stuck: 2 };

export class Wander {
  // home: [x, z]. bounds: the world box { x, z } that goals stay in, or null.
  constructor(seed, home, bounds = null) {
    Object.assign(this, { seed, home, bounds });
    this.draws = 0;
    this.goal = null;   // { x, z, fast }, or null while it waits
    this.wait = this.random(...WANDER.wait);
  }

  random(min = 0, max = 1) { return min + (max - min) * hash(this.seed * 7919 + this.draws++); }

  update(c, dt) {
    c.input.move.set(0, 0);
    c.input.jump = false;
    if (!this.goal) {
      this.wait -= dt;
      if (this.wait <= 0) this.pick();
      return;
    }
    const dx = this.goal.x - c.position.x, dz = this.goal.z - c.position.z, d = Math.hypot(dx, dz);
    if (d < this.closest - 0.1) { this.closest = d; this.since = 0; } else this.since += dt;
    if (d < WANDER.reach || this.since > WANDER.stuck) {
      this.goal = null;
      this.wait = this.random(...WANDER.wait);
      return;
    }
    c.input.move.set(dx / d, dz / d);
    c.input.fast = this.goal.fast;
  }

  pick() {
    const a = this.random(0, 2 * Math.PI), r = WANDER.range * Math.sqrt(this.random());
    let x = this.home[0] + r * Math.sin(a), z = this.home[1] + r * Math.cos(a);
    if (this.bounds) {
      x = clamp(x, ...this.bounds.x);
      z = clamp(z, ...this.bounds.z);
    }
    this.goal = { x, z, fast: this.random() < WANDER.run };
    this.closest = Infinity;
    this.since = 0;
  }
}
