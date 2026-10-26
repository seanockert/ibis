// Swoop: the brain of the flying miners. They circle over a character (the player), and one at a time
// they dive at its head. Now and then one lands on a perch (a bin, a box, the fence) and sits there a while.
// It takes off when the player comes near, when the perch moves or falls over, or when it has sat long
// enough. Random values come from hash() with the seed.
//
//   const swoop = new Swoop(seed);
//   swoop.update(fliers, player, dt, perches, camera);   // every frame, before the fliers' update
import { Frustum, Matrix4, Vector3 } from 'three';
import { hash } from '../ibis/motion/spring.js';

// first: seconds before the first dive. wait: the pause after a dive, shortest and longest, seconds.
// land: the pause between landings, seconds. sit: how long one sits, seconds. perched: the most that
// sit at one time (the others keep diving). scare: it leaves, or does not land, when the player is this
// near the perch (on the ground, world units). reach: it lands only on a perch this near the player, so
// it stays in view. moved: it leaves when the perch moves this far. rest: seconds after a take off
// before the same flier lands again.
export const SWOOP = { first: 3, wait: [2.5, 6], land: [3, 8], sit: [5, 12], perched: 2, scare: 2.5, reach: 12, moved: 0.3, rest: 6 };

export class Swoop {
  constructor(seed = 0) {
    this.seed = seed;
    this.draws = 0;
    this.wait = SWOOP.first;
    this.landWait = this.random(...SWOOP.land);
    this.next = 0;           // the flier that dives next
    this.head = new Vector3();
    this.perches = new Map();   // flier to { prop (the perch), point (where it is now), spot (where it landed), sit, sat }
    this.left = new Map();      // flier to the time it last left a perch
    this.time = 0;
  }

  random(min = 0, max = 1) { return min + (max - min) * hash(this.seed * 7919 + this.draws++); }

  // fliers: Flier (src/miner/flier.js). player: the Ibis they circle over and dive at, or null. perches:
  // what they can land on: each has perch() (a world point, or null when it can't take a bird now) and
  // optional face (a ground direction to land along). A bin and a box are their own perch. camera: with
  // it, a flier lands only on a perch in view.
  update(fliers, player, dt, perches = [], camera = null) {
    if (!player || fliers.length === 0) return;
    player.object.updateMatrixWorld();
    this.head.copy(player.rig.head).applyMatrix4(player.object.matrixWorld);
    for (const f of fliers) {
      f.flight.centre.set(player.object.position.x, 0, player.object.position.z);
      f.flight.target.copy(this.head);
    }
    this.perch(fliers, player, dt, perches, camera);
    const circling = fliers.filter(f => f.flight.circling);
    if (fliers.some(f => f.flight.diving) || circling.length === 0) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    // The next flier in turn that circles.
    for (let i = 0; i < fliers.length; i++) {
      const f = fliers[this.next++ % fliers.length];
      if (f.flight.circling) { f.flight.dive(); break; }
    }
    this.wait = this.random(...SWOOP.wait);
  }

  // Keeps the perches up to date, sends a flier off when it must go, and now and then lands one.
  perch(fliers, player, dt, perches, camera) {
    this.time += dt;
    const away = at => Math.hypot(at.x - player.object.position.x, at.z - player.object.position.z);
    const near = at => away(at) < SWOOP.scare;
    for (const [f, P] of this.perches) {
      if (!f.flight.perched) { this.perches.delete(f); this.left.set(f, this.time); continue; }
      const at = P.prop.perch();
      if (f.flight.landed) P.sat += dt;
      if (!at || at.distanceTo(P.spot) > SWOOP.moved || near(at) || P.sat > P.sit) f.flight.takeOff();
      else P.point.copy(at);
    }
    this.landWait -= dt;
    if (this.landWait > 0 || this.perches.size >= SWOOP.perched) return;
    this.landWait = this.random(...SWOOP.land);
    // Keep one circling to dive.
    const circling = fliers.filter(f => f.flight.circling);
    const rested = circling.filter(f => this.time - (this.left.get(f) ?? -Infinity) > SWOOP.rest);
    if (circling.length < 2 || rested.length === 0) return;
    const taken = new Set([...this.perches.values()].map(P => P.prop));
    const view = camera && new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const free = perches.filter(prop => !taken.has(prop)).map(prop => ({ prop, at: prop.perch() }))
      .filter(c => c.at && !near(c.at) && away(c.at) < SWOOP.reach && (!view || view.containsPoint(c.at)));
    if (free.length === 0) return;
    const { prop, at } = free[Math.floor(this.random() * free.length)];
    // The rested flier nearest to it.
    const f = rested.reduce((a, b) => (a.flight.position.distanceTo(at) < b.flight.position.distanceTo(at) ? a : b));
    const point = at.clone();
    f.flight.land(point, prop.face ?? null);
    this.perches.set(f, { prop, point, spot: at.clone(), sit: this.random(...SWOOP.sit), sat: 0 });
  }
}
