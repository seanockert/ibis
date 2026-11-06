// Toss and gulp: the rules. Things fall from the sky. Catch one in the bill at the right time, and the
// ibis flicks it up again. After enough catches it swallows it: the head and the neck bulge round it as
// it goes down, and the belly gets rounder. A miss lands on the head (a bonk) or on the ground. Three
// misses and the bird faints.
//
//   const game = new Game({ ibis, asset, scene, fx, sound, hud });
//   game.press();              // the catch button
//   game.update(dt, move);     // every frame; move: -1 (left) to 1 (right)
//
// Timing is the skill: the press must come within RULES.perfect or RULES.good seconds of the item
// reaching the bill. The bill opens as it comes (a tell). A sloppy catch tosses it off to one side.
import { CircleGeometry, Mesh, MeshBasicMaterial, Quaternion, Matrix4, Vector3 } from 'three';
import { bezier, HEAD_SCALE } from '../ibis/rig.js';
import { Spring, clamp, hash, mix, smoothstep } from '../ibis/motion/spring.js';
import { ITEMS, itemMesh } from './items.js';

export const RULES = {
  lives: 3,
  gravity: 9,            // units per second squared, at the start
  faster: 0.04,          // gravity and the toss get this part faster for each swallow
  fastest: 0.8,          // up to this part faster
  air: 0.95,             // seconds from a toss to the catch, at the start
  minAir: 0.6,
  perfect: 0.06,         // seconds either side of the arrival: a perfect catch
  good: 0.13,            // a good catch
  armed: 0.4,            // a press this long or less before the arrival counts; earlier ones do nothing
  reach: 0.3,            // the item must be this near the bill across the ground (plus a part of its radius)
  hold: 0.1,             // seconds in the bill before the toss
  drift: { perfect: 0.2, good: [0.6, 1.2] },   // how far a toss lands from the bill, units
  walk: 2.4,             // units per second, both ways (the ibis walks backward to the left)
  arena: 4.2,            // half width of the play area
  spawn: { height: 7, near: 0.4, far: [1.2, 2.0], gap: 0.45 },   // far: at the start, and later
  first: 0.8,            // seconds from the start to the first item
  streak: 3,             // perfect catches in a row for each step of the multiplier
  maxMult: 8,
  catchPoints: { perfect: 5, good: 2 },
  milestone: 5,          // a happy dance every this many swallows
  faintDelay: 0.7,       // seconds from the last miss to the faint
  restart: 1.2,          // seconds after the faint before a press starts again
};

// The stance while it waits for a catch: the head up with the bill to the sky, the neck tall.
const READY = { headPitch: -0.75, stretch: 1.1, pitch: -0.05, look: 0.5 };
// The bill opens this much wider than the item as it comes (the tell), in the last open seconds.
const OPEN = { more: 0.3, open: 0.28 };
// Bill grip, head space before HEAD_SCALE: the middle of the gap for a jaw opening, and the direction out
// of the gap. Copied from GRAB.holds in src/world/physics.js (flat and round), which imports crashcat.
const GRIP = { flat: [0.37, [0, -0.46, 0.73]], round: [0.7, [0, -0.51, 0.66]], out: [0, -0.89, 0.45] };
// Spheres of the bird that a falling item bounces off, in head space (before HEAD_SCALE) or along the neck.
const SOLID = { head: 0.2, bill: [[0, -0.25, 0.42], 0.08], neck: 0.11, body: [[0, 0.25, 0], 0.42] };
// The belly: a capsule along the body, body space. Its radius grows from base with the fill.
const BELLY = { a: [0, 0.12, -0.12], b: [0, 0.12, 0.1], base: 0.3, grow: 0.34, max: 1 };
// The swallow's bulges, as parts of the item's lump radius: the pouch in the throat, the lump in the neck,
// and how far the lump sits to the front. top: the lump stays below this part of the neck (the head).
const THROAT = { pouch: 1.15, lump: 1.2, front: 0.6, top: 0.85 };
const GROUND = { bounce: 0.3, friction: 4, stay: 1.4, fade: 0.3 };

const v3 = (a = 0, b = 0, c = 0) => new Vector3(a, b, c);

export class Game {
  // only: an item name, so every item is that one (for the tools).
  constructor({ ibis, asset, scene, fx, sound, hud, seed = 1, bot = null, only = null }) {
    Object.assign(this, { ibis, asset, scene, fx, sound, hud, bot, only });
    this.c = ibis.character;
    this.c.controller.heading = this.c.controller.wantHeading = Math.PI / 2;   // faces +x, the right
    this.c.controller.bounds = { x: [-RULES.arena, RULES.arena], z: [0, 0] };
    this.c.animator.stance = (P, dt) => this.stance(P, dt);
    this.ready = new Spring(0, 9, 1);
    this.open = new Spring(0, 18, 1);
    this.belly = new Spring(0, 5, 0.8);
    this.best = loadBest();
    this.state = 'title';
    this.time = 0;
    this.seed = seed;
    this.items = [];          // in the air, in the bill, or going down
    this.loose = [];          // missed: bouncing and lying on the ground
    this.lump = null;         // { def, t } while a swallow goes down
    this.after = [];          // [{ at, run }]: things to do later, game time
    this.reset();
    this.state = 'title';
  }

  reset() {
    for (const it of [...this.items, ...this.loose]) this.remove(it);
    this.items = [];
    this.loose = [];
    this.lump = null;
    this.after = [];
    this.lives = RULES.lives;
    this.score = 0;
    this.streak = 0;
    this.eaten = 0;
    this.fill = 0;
    this.spawned = 0;
    this.overAt = 0;
    this.newBest = false;
  }

  get mult() { return Math.min(1 + Math.floor(this.streak / RULES.streak), RULES.maxMult); }
  get speed() { return 1 + Math.min(this.eaten * RULES.faster, RULES.fastest); }
  get gravity() { return RULES.gravity * this.speed; }

  rand() { return hash(++this.seed * 7919); }

  later(seconds, run) { this.after.push({ at: this.time + seconds, run }); }

  // ---- input ----

  press() {
    if (this.state === 'title') return this.start();
    if (this.state === 'over') { if (this.time - this.overAt > RULES.faintDelay + RULES.restart) this.start(); return; }
    const it = this.items.find(x => x.state === 'fall' && !x.missed);
    if (!it) return;
    const arrive = this.arrival(it);
    if (arrive > RULES.armed) return;   // still far: nothing yet
    const late = -arrive, gape = this.catchPoint(it.def);
    const near = Math.abs(it.pos.x - gape.x) <= RULES.reach + 0.3 * it.def.radius;
    if (Math.abs(late) <= RULES.good && near) this.catch(it, Math.abs(late) <= RULES.perfect, late);
    else this.whiff(it);
  }

  start() {
    if (this.state === 'over') this.c.animator.stop();
    this.reset();
    this.state = 'play';
    this.spawnAt = this.time + RULES.first;
    this.hud?.start();
    this.sound?.start();
  }

  // ---- the frame ----

  update(dt, move = 0) {
    this.time += dt;
    for (const a of this.after.filter(a => this.time >= a.at)) a.run();
    this.after = this.after.filter(a => this.time < a.at);
    if (this.bot && this.state !== 'over') move = this.botStep();
    const free = this.state !== 'over';
    this.c.drive = free && Math.abs(move) > 0.05 ? RULES.walk * clamp(move, -1, 1) : free ? 0 : null;

    this.ibis.update(dt);
    this.ibis.object.updateMatrixWorld();
    for (const e of this.c.events) {
      if (e.type === 'toss') this.toss();
      if (e.type === 'gulp') this.sound?.gulp(this.ibis.object.position, e.beat);
    }

    if (this.state === 'play' && !this.items.length && !this.lump && this.time >= this.spawnAt) this.spawn();
    for (const it of [...this.items]) this.step(it, dt);
    this.swallowing(dt);
    for (const it of [...this.loose]) this.rest(it, dt);
    this.bulges(dt);
    this.hud?.update(this);
  }

  // ---- items ----

  spawn() {
    const pool = Object.entries(ITEMS).filter(([, d]) => d.from <= this.eaten);
    let pick = this.rand() * pool.reduce((s, [, d]) => s + d.chance, 0), key = pool[0][0];
    for (const [k, d] of pool) { if ((pick -= d.chance) <= 0) { key = k; break; } }
    // The first item always comes to the bill.
    const def = ITEMS[this.only ?? (this.spawned === 0 ? 'chip' : key)], gape = this.catchPoint(def);
    const far = mix(RULES.spawn.far[0], RULES.spawn.far[1], Math.min(this.eaten / 10, 1));
    let x = gape.x + (this.spawned === 0 ? 0 : (this.rand() < 0.5 ? -1 : 1) * mix(RULES.spawn.near, far, this.rand()));
    if (Math.abs(x) > RULES.arena - 0.3) x = gape.x - (x - gape.x);
    x = clamp(x, -RULES.arena + 0.3, RULES.arena - 0.3);
    this.spawned++;
    this.items.push(this.make(def, v3(x, RULES.spawn.height, gape.z), v3(0, 0, 0)));
  }

  make(def, pos, vel) {
    const mesh = itemMesh(def, this.asset.uniforms);
    const shadow = new Mesh(SHADOW_GEOMETRY, SHADOW_MATERIAL);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = -0.5;
    this.scene.add(mesh, shadow);
    const axis = v3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize();
    return {
      def, mesh, shadow, pos, vel, state: 'fall', catches: def.catches, missed: false, counted: false, flutter: 0,
      quat: new Quaternion().setFromAxisAngle(axis, this.rand() * 6), spin: axis.multiplyScalar(def.spin),
      g: this.gravity, crossed: null, prevY: pos.y, held: 0, from: null, air: 0,
    };
  }

  remove(it) {
    this.scene.remove(it.mesh, it.shadow);
  }

  step(it, dt) {
    if (it.state === 'held') return this.holding(it, dt);
    if (it.state !== 'fall') return;
    const gape = this.catchPoint(it.def);
    it.prevY = it.pos.y;
    it.air += dt;
    it.vel.y -= it.g * dt;
    // The flutter's side speed has no mean over the flight, so the item still lands where it would.
    const side = it.flutter ? it.flutter * Math.sin(Math.PI * 4 * it.air / it.flight) : 0;
    it.pos.addScaledVector(it.vel, dt);
    it.pos.x += side * dt;
    spinBy(it.quat, it.spin, dt);
    // When it passes the bill's height, the catch window starts to close.
    if (it.crossed === null && it.prevY >= gape.y && it.pos.y < gape.y) it.crossed = this.time;
    if (!it.missed && it.crossed !== null && this.time - it.crossed > RULES.good) this.miss(it);
    this.collide(it);
    if (it.pos.y - it.def.radius * 0.5 <= 0) this.land(it);
    this.place(it);
  }

  // Seconds until the item's middle reaches the bill's height (less than 0: since it went past).
  arrival(it) {
    const gape = this.catchPoint(it.def);
    if (it.crossed !== null) return it.crossed - this.time;
    const h = it.pos.y - gape.y, v = it.vel.y, g = it.g;
    return (v + Math.sqrt(Math.max(v * v + 2 * g * h, 0))) / g;
  }

  catch(it, perfect, late) {
    it.state = 'held';
    it.held = 0;
    it.from = it.pos.clone();
    it.fromQuat = it.quat.clone();
    it.catches--;
    this.streak = perfect ? this.streak + 1 : 0;
    this.score += RULES.catchPoints[perfect ? 'perfect' : 'good'] * this.mult;
    it.sloppy = !perfect;
    it.late = late;
    it.gape = this.catchPoint(it.def);   // the bill in the stance: where the toss comes back to
    this.c.controller.carry = it.def.jaw;
    this.c.act('catch');
    this.hud?.pop(perfect ? 'Perfect!' : 'Good', this.catchPoint(it.def), perfect ? 'perfect' : 'good');
    this.sound?.caught(it.pos, perfect, this.mult);
  }

  whiff(it) {
    it.missed = true;   // can't be caught now: it falls on the bird or the ground
    this.streak = 0;
    this.c.act('whiff');
    this.hud?.pop(this.arrival(it) > 0 ? 'Too early!' : 'Too late!', this.catchPoint(it.def), 'bad');
  }

  // Too late: an item at the bill glances off it, forward, so it does not fall through the bill.
  miss(it) {
    it.missed = true;
    this.streak = 0;
    if (Math.abs(it.pos.x - this.catchPoint(it.def).x) > RULES.reach + 0.3 * it.def.radius) return;
    it.vel.set(1.8, 1.6, 0);
    it.spin.multiplyScalar(2);
    this.sound?.bonk(it.pos, 0.35);
  }

  // In the bill: the item goes from where it was caught to the grip, then the toss, or the swallow.
  holding(it, dt) {
    it.held += dt;
    const k = smoothstep(0, 0.06, it.held);
    const at = this.holdPoint(it.def), q = this.holdQuat();
    it.pos.copy(it.from).lerp(at, k);
    it.quat.copy(it.fromQuat).slerp(q, k);
    if (it.held >= RULES.hold && !it.tossing) {
      it.tossing = true;
      if (it.catches > 0) this.c.act('toss');
      else this.swallow(it);
    }
    this.place(it);
  }

  // The 'toss' event of the toss action: the item flies up to come down at the bill, after the air time.
  toss() {
    const it = this.items.find(x => x.state === 'held');
    if (!it || it.catches <= 0) return;
    const T = Math.max(RULES.air / this.speed, RULES.minAir) * it.def.air;
    const gape = it.gape;
    // A perfect catch tosses it near the bill; a sloppy one off to the side, so the bird must walk.
    const sign = this.rand() < 0.5 ? -1 : 1;
    let drift = it.sloppy ? sign * mix(...RULES.drift.good, this.rand()) : (this.rand() * 2 - 1) * RULES.drift.perfect;
    if (Math.abs(gape.x + drift) > RULES.arena - 0.4) drift = -drift;
    const p = this.holdPoint(it.def), g = this.gravity;
    it.state = 'fall';
    it.tossing = false;
    it.crossed = null;
    it.g = g;
    it.air = 0;
    it.flight = T;
    it.flutter = it.def.flutter;
    it.pos.copy(p);
    it.vel.set((gape.x + drift - p.x) / T, (gape.y - p.y + 0.5 * g * T * T) / T, 0);
    this.c.controller.carry = null;
  }

  swallow(it) {
    this.c.controller.carry = null;
    this.c.act('gulp');
    it.state = 'gulp';
    this.lump = { it, def: it.def, t: 0, start: this.holdPoint(it.def) };
  }

  // The swallow, in time with the gulp action: the item goes into the head (it bulges), then the lump goes
  // down the neck in three gulps, and into the belly.
  swallowing(dt) {
    const L = this.lump;
    if (!L) return;
    L.t += dt;
    const { it, def } = L;
    if (it.state === 'gulp') {
      // Slurped into the open bill: it slides to the corner of the gape and shrinks to nothing there,
      // inside the gap, as the throat swells.
      const k = smoothstep(0, 0.2, L.t);
      const into = this.ibis.object.localToWorld(this.headPoint([0, -0.2, 0.32]));
      it.pos.copy(L.start).lerp(into, k);
      it.mesh.scale.setScalar(1 - k);
      this.place(it);
      if (L.t >= 0.2) { it.state = 'gone'; this.remove(it); this.items = this.items.filter(x => x !== it); }
    }
    if (L.t >= 0.9 && !L.done) {
      L.done = true;
      this.fill = Math.min(this.fill + def.fill, BELLY.max);
      this.eaten++;
      const points = def.value * this.mult;
      this.score += points;
      if (this.score > this.best) { this.best = this.score; this.newBest = true; saveBest(this.best); }
      this.hud?.pop(`${def.name} +${points}`, this.ibis.object.localToWorld(this.ibis.rig.head.clone()), 'gulp');
      this.sound?.swallowed(this.ibis.object.position, this.mult);
      const party = this.eaten % RULES.milestone === 0;
      if (party || def.burp) this.later(0.4, () => { if (this.state === 'play') this.c.act(party ? 'happy' : 'burp'); });
      this.spawnAt = this.time + RULES.spawn.gap + (party || def.burp ? 0.9 : 0.4);
    }
    if (L.t >= 1.15) this.lump = null;
  }

  // A miss that falls into the bird bounces off it: the head and the bill (a bonk), the neck and the body.
  // An item that can still be caught (near the bill) goes through, so the catch can take it.
  collide(it) {
    if (it.vel.y > 0) return;
    const R = this.ibis.rig, o = this.ibis.object;
    if (!it.missed && Math.abs(it.pos.x - this.catchPoint(it.def).x) <= RULES.reach + 0.3 * it.def.radius) return;
    const spheres = [
      [this.headPoint([0, 0, 0]), SOLID.head * HEAD_SCALE, true],
      [this.headPoint(SOLID.bill[0]), SOLID.bill[1] * HEAD_SCALE, true],
      [bezier(R.neckBase, R.neckCtrl, R.neckTip, 0.5), SOLID.neck, false],
      [R.pelvis.clone().add(v3(...SOLID.body[0])), SOLID.body[1], false],
    ];
    for (const [local, r, head] of spheres) {
      const centre = o.localToWorld(local.clone());
      const d = it.pos.clone().sub(centre), reach = r + it.def.radius * 0.6;
      if (d.length() >= reach) continue;
      const n = d.lengthSq() > 1e-6 ? d.normalize() : v3(0, 1, 0);
      it.pos.copy(centre).addScaledVector(n, reach);
      const into = it.vel.dot(n);
      if (into < 0) it.vel.addScaledVector(n, -1.5 * into);
      it.vel.y = Math.max(it.vel.y, 2.5);
      it.vel.x += (it.pos.x >= o.position.x ? 1 : -1) * 1.2;
      it.spin.multiplyScalar(1.5);
      if (!it.counted) this.lose(it, head ? 'bonk' : 'boing', centre);
      return;
    }
  }

  land(it) {
    it.pos.y = it.def.radius * 0.5;
    if (!it.counted) this.lose(it, 'splat', it.pos.clone());
    this.items = this.items.filter(x => x !== it);
    it.state = 'loose';
    it.restAt = null;
    it.vel.y = Math.abs(it.vel.y) * GROUND.bounce;
    this.loose.push(it);
    this.fx?.cloud?.(it.pos.clone().setY(0.05), v3(0, 0, 0), { size: 0.12, speed: 0.4, up: 0.2 }, 4);
    this.sound?.splat(it.pos);
  }

  // A missed item on the ground: bounces, slides to a stop, then shrinks away.
  rest(it, dt) {
    it.vel.y -= RULES.gravity * dt;
    it.pos.addScaledVector(it.vel, dt);
    spinBy(it.quat, it.spin, dt);
    const floor = it.def.radius * 0.5;
    if (it.pos.y <= floor) {
      it.pos.y = floor;
      it.vel.y = Math.abs(it.vel.y) > 1 ? Math.abs(it.vel.y) * GROUND.bounce : 0;
      it.vel.x *= Math.exp(-GROUND.friction * dt);
      it.spin.multiplyScalar(Math.exp(-GROUND.friction * dt));
      it.restAt ??= this.time;
    }
    if (it.restAt !== null) {
      const k = smoothstep(GROUND.stay, GROUND.stay + GROUND.fade, this.time - it.restAt);
      it.mesh.scale.setScalar(1 - k);
      if (k >= 1) { this.remove(it); this.loose = this.loose.filter(x => x !== it); return; }
    }
    this.place(it);
  }

  // A life goes. how: bonk (on the head), boing (off the neck or the body), splat (on the ground).
  lose(it, how, at) {
    it.counted = true;
    it.missed = true;
    this.streak = 0;
    if (this.state !== 'play') return;
    this.lives--;
    this.hud?.pop(how === 'bonk' ? 'Bonk!' : how === 'boing' ? 'Boing!' : 'Splat!', at, 'bad');
    this.hud?.hurt();
    if (how === 'bonk') { this.c.act('bonk'); this.fx?.hit(this.ibis); this.sound?.bonk(at); }
    else if (how === 'boing') { this.c.act('bonk'); this.sound?.bonk(at, 0.7); }
    else if (this.lives > 0) this.c.act('headShake');
    if (this.lives > 0) { this.spawnAt = this.time + RULES.spawn.gap + 0.9; return; }
    this.state = 'over';
    this.overAt = this.time;
    this.later(RULES.faintDelay, () => { this.c.act('faint'); this.sound?.over(this.ibis.object.position); });
  }

  // ---- the bird ----

  // The game's stance, under the actions (Animator.stance): the head up to catch, the bill opening as an
  // item comes.
  stance(P, dt) {
    const falling = this.items.find(x => x.state === 'fall' && !x.missed);
    const held = this.items.some(x => x.state === 'held');
    const want = this.state === 'over' ? 0 : falling || held ? 1 : this.state === 'play' ? 0.6 : 0.25;
    const k = clamp(this.ready.update(dt, want), 0, 1);
    P.headPitch = mix(P.headPitch, READY.headPitch, k);
    P.headYaw = mix(P.headYaw, 0, k);
    P.stretch = mix(P.stretch, READY.stretch, k);
    P.pitch = mix(P.pitch, READY.pitch, k);
    P.look.y = mix(P.look.y, READY.look, k);
    // The tell: the bill opens wide just before the item gets there.
    const soon = falling ? 1 - smoothstep(0, OPEN.open, this.arrival(falling)) : 0;
    const open = clamp(this.open.update(dt, soon), 0, 1);
    if (falling) P.jaw = Math.max(P.jaw, (falling.def.jaw + OPEN.more) * open * k);
  }

  // The bulges: the item in the head and the lump in the neck (bulge 0), and the full belly (bulge 1).
  bulges(dt) {
    const ibis = this.ibis, R = ibis.rig, L = this.lump;
    if (L) {
      const [r, len] = L.def.lump, t = L.t;
      if (t < 0.3) {
        // A pouch in the throat, under the base of the bill: low, so the eyes keep their shape.
        const k = smoothstep(0.08, 0.22, t) * (1 - smoothstep(0.24, 0.3, t));
        ibis.bulge(0, this.headPoint([0, -0.36, 0.2]), this.headPoint([0, -0.36, -0.05]), r * THROAT.pouch, k);
      } else {
        // Down the neck in three gulps (the beats of the gulp action), then into the belly.
        const s = 1 - (smoothstep(0.32, 0.44, t) + smoothstep(0.54, 0.66, t) + smoothstep(0.76, 0.88, t)) / 3;
        const into = smoothstep(0.86, 1.05, t);
        const span = len / 2 / 0.7;   // the neck is about 0.7 long
        const a = bezier(R.neckBase, R.neckCtrl, R.neckTip, clamp(s + span, 0, THROAT.top));
        const b = bezier(R.neckBase, R.neckCtrl, R.neckTip, clamp(s - span, 0, THROAT.top));
        // Out at the front of the throat, as a swallow shows: the back of the neck stays as it is.
        const along = b.clone().sub(a), front = v3(0, 0, 1);
        if (along.lengthSq() > 1e-6) front.addScaledVector(along.normalize(), -front.dot(along)).normalize();
        a.addScaledVector(front, r * THROAT.front);
        b.addScaledVector(front, r * THROAT.front);
        const belly = this.bodyPoint(BELLY.a).lerp(this.bodyPoint(BELLY.b), 0.5);
        a.lerp(belly, into);
        b.lerp(belly, into);
        ibis.bulge(0, a, b, r * THROAT.lump, smoothstep(0.26, 0.32, t) * (1 - into));
      }
    } else ibis.bulge(0, v3(), v3(), 0, 0);
    const f = Math.max(this.belly.update(dt, this.fill), 0);
    ibis.bulge(1, this.bodyPoint(BELLY.a), this.bodyPoint(BELLY.b), BELLY.base + BELLY.grow * f, smoothstep(0, 0.1, f));
  }

  // A head space point (before HEAD_SCALE) in character space.
  headPoint(h) {
    const R = this.ibis.rig;
    return v3(...h).multiplyScalar(HEAD_SCALE).applyMatrix4(R.headRot).add(R.head);
  }

  bodyPoint(b) {
    const R = this.ibis.rig;
    return v3(...b).applyMatrix4(R.body).add(R.pelvis);
  }

  // The middle of the bill's gap for an item's jaw opening, head space.
  grip(def) {
    const [j0, a] = GRIP.flat, [j1, b] = GRIP.round, k = (def.jaw - j0) / (j1 - j0);
    return a.map((v, i) => mix(v, b[i], k));
  }

  // World point where the item's middle must be for a catch: the gap of the bill in the ready stance.
  catchPoint(def) {
    return this.ibis.object.localToWorld(this.headPoint(this.grip(def)));
  }

  // World point of the middle of a held item: the grip, and its edge out of the bill.
  holdPoint(def) {
    const g = this.grip(def), k = def.edge / HEAD_SCALE;
    return this.ibis.object.localToWorld(this.headPoint(g.map((v, i) => v + k * GRIP.out[i])));
  }

  // World turn of a held item: its x out of the bill, its y across the bill.
  holdQuat() {
    const out = v3(...GRIP.out).normalize(), across = v3(1, 0, 0);
    const local = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(out, across, v3().crossVectors(out, across)));
    return this.ibis.object.quaternion.clone().multiply(new Quaternion().setFromRotationMatrix(this.ibis.rig.headRot)).multiply(local);
  }

  place(it) {
    it.mesh.position.copy(it.pos);
    it.mesh.quaternion.copy(it.quat);
    // The shadow straight under it: bigger and darker as it comes down. A tell of where it falls.
    const h = Math.max(it.pos.y, 0);
    it.shadow.visible = it.state !== 'held' && it.state !== 'gulp';
    it.shadow.position.set(it.pos.x, 0.01, it.pos.z);
    it.shadow.scale.setScalar(it.def.radius * mix(1.2, 0.6, clamp(h / RULES.spawn.height, 0, 1)) * it.mesh.scale.x);
  }

  // ---- test bot ----

  // A bot for the tools (gulp.html?bot=1): it walks under the item and presses in time. bot.miss: the
  // numbers of the catches (from 1) where it does not press.
  botStep() {
    if (this.state === 'title') { this.start(); return 0; }
    const it = this.items.find(x => x.state === 'fall' && !x.missed);
    if (!it) return 0;
    const t = this.arrival(it), gape = this.catchPoint(it.def);
    // Where it will be at the bill's height, with the flutter's mean of 0.
    const x = it.pos.x + it.vel.x * Math.max(t, 0);
    this.botCatches ??= 0;
    const skip = this.bot.miss?.includes(this.botCatches + 1);
    if (t <= 0.01 && it.botAt !== it.catches) {
      it.botAt = it.catches;
      this.botCatches++;
      if (!skip) this.press();
    }
    return clamp((x - gape.x) * 4, -1, 1);
  }
}

// Turns q by the angular speed w (a vector, radians per second) for dt.
function spinBy(q, w, dt) {
  const a = w.length() * dt;
  if (a < 1e-6) return;
  q.premultiply(new Quaternion().setFromAxisAngle(w.clone().normalize(), a));
}

const SHADOW_GEOMETRY = new CircleGeometry(1, 24);
const SHADOW_MATERIAL = new MeshBasicMaterial({ color: 0x5a5470, transparent: true, opacity: 0.35, depthWrite: false });

const BEST_KEY = 'ibis-gulp-best';
function loadBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } }
function saveBest(n) { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* no storage */ } }
