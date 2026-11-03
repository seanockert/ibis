// Fling: the bird throws what its bill holds. Hold the peck to aim (Character.aim(): a wind-up), let go
// to throw (the 'fling' action). The longer the hold, up to FLING.charge seconds, the faster and farther.
// The throw goes along the heading, FLING.pitch up. While the bird aims, an arc of dots shows where the
// prop goes and a ring where it lands. When the arc passes a miner, the dots go red and the miner glows:
// the throw will hit it.
// A thrown prop that passes a miner (perched or in the air) knocks it, as a snap does (Sentry.knock()):
// a tumble, a hit-stop, hit lines. Each throw hits once.
//
//   const fling = new Fling(level);   // with physics and a player
//   fling.beforeStep(dt);            // before the physics step: throws on a 'fling' event
//   fling.update(dt);                // after it: the arc, and the hits
//   fling.events                     // this update: 'hit' { flier, from (distance on the ground), air }
import { Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { GRAVITY } from './physics.js';

// speed: at the shortest and the longest hold (units per second). charge: seconds to full. pitch: the
// throw's angle up (radians). spin: radians per second, end over end. hit: a prop's middle this near a
// miner's middle hits it. life: seconds a thrown prop can hit. dots, step: the arc's dots and the time
// between them (seconds). aim: an arc point this near a miner is on target. lift: the arc starts this
// much over the hold point (the whip lifts the prop). The throw starts where the arc started at the last
// frame of the aim, and the arc has the prop's drag, so a red arc is a hit on a miner that keeps still.
export const FLING = {
  speed: [5, 20], charge: 0.9, pitch: 0.75, spin: 14, hit: 0.85, life: 3,
  dots: 34, step: 0.035, aim: 0.55, lift: 0.15,
  colour: 0xfff4d6, onTarget: 0xff4a2a,
};
const HURT = { lines: 2.2, hold: 0.6, freeze: 0.12 };   // as a snap (level.js)

export class Fling {
  constructor(level) {
    this.level = level;
    this.events = [];
    this.thrown = [];   // { id, t, from }
    this.object = new Group();
    this.dots = new InstancedMesh(new SphereGeometry(0.06, 8, 6), new MeshBasicMaterial({ color: FLING.colour, transparent: true, opacity: 0.9, depthWrite: false }), FLING.dots);
    this.dots.frustumCulled = false;
    this.ring = new Mesh(new TorusGeometry(0.35, 0.04, 6, 24).rotateX(Math.PI / 2), new MeshBasicMaterial({ color: FLING.colour, transparent: true, opacity: 0.9, depthWrite: false }));
    this.object.add(this.dots, this.ring);
    this.object.visible = false;
    level.scene.add(this.object);
    this.m = new Matrix4();
    this.target = null;
  }

  // The throw velocity of the player now, for an aim of seconds.
  velocity(seconds, out = new Vector3()) {
    const c = this.level.player.character, k = Math.min(seconds / FLING.charge, 1);
    const speed = FLING.speed[0] + (FLING.speed[1] - FLING.speed[0]) * k;
    const h = c.heading, flat = Math.cos(FLING.pitch) * speed;
    return out.set(Math.sin(h) * flat, Math.sin(FLING.pitch) * speed, Math.cos(h) * flat);
  }

  beforeStep() {
    const { level } = this, p = level.player, c = p.character;
    if (!c.events.some(e => e.type === 'fling')) return;
    const v = this.velocity(c.flung), h = c.heading, s = FLING.spin;
    const id = level.physics.fling(p, v.toArray(), [Math.cos(h) * s, 0, -Math.sin(h) * s], this.from?.toArray());
    if (id !== null) this.thrown.push({ id, t: 0, from: p.object.position.clone() });
    this.from = null;
    c.events.push({ type: 'whoosh' });   // for the sound
  }

  update(dt) {
    this.events = [];
    const { level } = this, p = level.player, c = p.character;
    this.arc(c);
    // Hits: each thrown prop against each miner.
    for (const th of this.thrown) {
      th.t += dt;
      const body = level.physics.body(th.id);
      if (!body) { th.t = Infinity; continue; }
      const at = new Vector3().fromArray(body.position);
      for (const flier of level.fliers) {
        if (at.distanceTo(flier.centre()) > FLING.hit) continue;
        const air = !flier.flight.perched;
        if (!level.sentry?.knock(flier, at)) continue;
        level.fx.hit(flier, HURT.lines, HURT.hold);
        level.fx.impact(flier.centre());
        level.freeze = HURT.freeze;
        this.events.push({ type: 'hit', flier, air, from: Math.hypot(at.x - th.from.x, at.z - th.from.z) });
        th.t = Infinity;   // one hit for each throw
        break;
      }
    }
    this.thrown = this.thrown.filter(th => th.t < FLING.life);
  }

  // The arc while the bird aims: dots at even times along the flight, a ring where it meets the
  // ground, and red with the miner outlined when it passes one.
  arc(c) {
    const { level } = this;
    if (this.target) { this.target.glow = 0; this.target = null; }
    const start = c.aiming !== null && level.physics.heldAt(level.player);
    this.object.visible = !!start;
    if (!start) return;
    const p = new Vector3(start[0], start[1] + FLING.lift, start[2]), v = this.velocity(c.aiming);
    this.from = p.clone();
    const height = level.ground.height, drag = level.physics.heldDamping(level.player);
    let n = 0, landed = null;
    for (let i = 0; i < FLING.dots * 3 && !landed; i++) {
      for (const flier of level.fliers) if (!this.target && !flier.flight.tumble && p.distanceTo(flier.centre()) < FLING.aim) this.target = flier;
      if (i % 3 === 0 && n < FLING.dots) this.dots.setMatrixAt(n++, this.m.makeTranslation(p.x, p.y, p.z));
      const dt = FLING.step / 3;
      v.y -= GRAVITY * dt;
      v.multiplyScalar(Math.max(0, 1 - drag * dt));
      p.addScaledVector(v, dt);
      if (p.y < height(p.x, p.z)) landed = p.clone().setY(height(p.x, p.z) + 0.03);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.ring.visible = !!landed;
    if (landed) this.ring.position.copy(landed);
    const colour = new Color(this.target ? FLING.onTarget : FLING.colour);
    this.dots.material.color.copy(colour);
    this.ring.material.color.copy(colour);
    if (this.target) this.target.glow = 1;
  }
}
