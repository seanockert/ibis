// A level: the scenery, ground, physics, props and characters of one play space, made from level data
// (src/levels/). It steps them each frame and sends their events to the effects and the sounds.
//
//   const level = new Level(STREET, { asset, birds, scene });
//   level.player.input.move.set(0, 1);   // the player's input, then:
//   level.update(dt, camera);       // every frame
//   level.updateView(camera, dt);   // after the camera moves: the parts that follow it, then render
//
// Without env there is no scenery and the ground is flat at 0 (the fixed views, which match sdf.html).
// Without props there is no physics.
import { SENTRY, Sentry } from '../characters/sentry.js';
import { FLIERS, SPECIES } from '../characters/species.js';
import { Wander } from '../characters/wander.js';
import { IbisEffects } from '../ibis/effects.js';
import { Highlight } from './highlight.js';
import { PROPS } from './kinds.js';
import { seeInside } from './props.js';
import { Physics } from './physics.js';
import { stack } from './place.js';
import { Puddle, splashMud } from './puddle.js';
import { Terrain } from './terrain.js';

const FLAT = { profile: null, height: () => 0 };
const WEATHER_RATE = 0.5;   // mud and wet change per second toward their targets
const PROP_FENCE = 0.5;     // the walls that stop light props are this far outside the bounds
const BRAINS = { wander: (seed, at, bounds) => new Wander(seed, at, bounds) };
const NOTICE_LOOK = 1.5;    // seconds the player looks at a miner that goes on alert
// A snap that hurts a miner: the hit-stop (seconds, and the time rate in it), and the size and hold
// (seconds) of its hit lines. The camera shakes too (Follow.shake(), in main.js).
const HURT = { freeze: 0.12, rate: 0.05, lines: 2.2, hold: 0.6 };

export class Level {
  // asset: the ibis asset (loadIbis()), for the shared uniforms. birds: the bird assets by species.
  // env: the scenery and the ground of the level. props: physics and props. terrain: the test course
  // (terrain.js). sound: an IbisSound, or null. weather: { mud, wet } (0 to 1) of every character at
  // the start.
  constructor(def, { asset, birds = { ibis: asset }, scene, env = true, props = true, terrain = false, sound = null, weather = { mud: 0, wet: 0 } }) {
    Object.assign(this, { def, asset, birds, scene, sound, weather });
    this.ground = env ? def.ground : FLAT;
    this.bounds = def.bounds;
    this.ibises = [];
    this.fliers = [];            // birds in the air (src/miner/flier.js)
    this.freeze = 0;             // seconds left of a hit-stop (HURT)
    this.sentry = null;          // their brain: guard a perch, call, dive at the player's head
    this.perches = [];           // what they can land on (Sentry)
    this.player = null;
    this.brains = new Map();     // ibis to brain
    this.targets = new Map();    // ibis to { mud, wet }: where its mud and wet go
    this.physics = props ? new Physics({ ground: this.ground.profile }) : null;
    this.parts = env ? def.scenery(asset, this.physics) : [];
    this.puddle = env && def.puddle ? new Puddle(asset.sun) : null;
    for (const part of [...this.parts, this.puddle]) if (part) scene.add(part.object);
    this.fx = new IbisEffects(asset);
    if (env) {
      this.fx.surface = def.surface;
      this.fx.height = this.ground.height;
    }
    scene.add(this.fx.object);
    this.props = [];
    this.highlight = null;   // a white outline round the prop that a peck of the player would pick up now
    if (!this.physics) return;
    const [x0, x1] = this.bounds.x, [z0, z1] = this.bounds.z;
    this.physics.addFence({ x: [x0 - PROP_FENCE, x1 + PROP_FENCE], z: [z0 - PROP_FENCE, z1 + PROP_FENCE] });
    this.highlight = new Highlight(asset.uniforms);
    scene.add(this.highlight.object);
    if (terrain) scene.add(new Terrain(this.physics, asset).object);
  }

  // Makes the characters and the props (with physics only) of the level data. The characters go first,
  // so their solids go into the physics before the props.
  populate() {
    this.def.characters.forEach((c, seed) => this.add(SPECIES[c.species](this.birds, seed), c));
    // Where the fliers can land: the scenery parts that have perches (the fence), and the props.
    this.perches = this.parts.flatMap(p => p.perches?.() ?? []);
    if (this.physics) {
      const defs = this.def.props, bases = stack(defs, d => PROPS[d.kind].footprint(d), this.ground.height);
      for (const [i, d] of defs.entries()) this.addProp(new PROPS[d.kind](this.physics, this.asset, { ...d, base: bases[i] }));
      this.perches.push(...this.props.filter(p => p.perch));
    }
    // Each flier sits on a perch near its home.
    const first = this.def.characters.length, fliers = this.def.fliers ?? [];
    if (fliers.length) this.sentry = new Sentry(first);
    fliers.forEach(({ species, home, ...flight }, i) => this.sentry.add(this.addFlier(FLIERS[species](this.birds, first + i, flight)), home, this.perches));
  }

  // Adds a character. at: [x, z], or none to keep where it is. player: the one the input drives. brain:
  // a key of BRAINS, for a character that no player drives.
  add(ibis, { at, heading = 0, player = false, brain = null } = {}) {
    const c = ibis.character;
    if (at) {
      c.controller.position.set(at[0], this.ground.height(...at), at[1]);
      c.controller.heading = c.controller.wantHeading = heading;
    }
    c.controller.bounds = this.bounds;
    ibis.mud = this.weather.mud;
    ibis.wet = this.weather.wet;
    this.targets.set(ibis, { ...this.weather });
    if (player) this.player = ibis;
    if (brain) this.brains.set(ibis, BRAINS[brain](this.ibises.length, at ?? [c.position.x, c.position.z], this.bounds));
    if (ibis.bird.solid) this.physics?.addBird(ibis);
    this.ibises.push(ibis);
    this.scene.add(ibis.object);
    return ibis;
  }

  // Adds a bird in the air. With physics, it gets a sphere that knocks light props.
  addFlier(flier) {
    this.physics?.addFlier(flier);
    this.fliers.push(flier);
    this.scene.add(flier.object);
    return flier;
  }

  addProp(prop) {
    this.props.push(prop);
    this.scene.add(prop.object);
    return prop;
  }

  // The mud and wet targets of a character: the Wet button and the puddle set them.
  target(ibis) { return this.targets.get(ibis); }

  // Wet on: every character gets wet over two seconds, which also washes the mud off. Off: dry again.
  setWet(on) {
    for (const t of this.targets.values()) {
      t.wet = on ? 1 : 0;
      if (on) t.mud = 0;
    }
  }

  // Wireframes of the colliders. It loads the debug renderer only when called.
  async showColliders() {
    this.collidersView = await this.physics.debugView();
    this.scene.add(this.collidersView.object);
  }

  // One frame: brains, characters, puddle, physics, props, effects and sounds. The player's input (or a
  // move script) must be set before.
  update(dt, camera) {
    const { fx, sound } = this;
    // Hit-stop: the world almost stops for a moment as a snap hurts a miner.
    if (this.freeze > 0) { this.freeze -= dt; dt *= HURT.rate; }
    for (const ibis of this.ibises) {
      this.brains.get(ibis)?.update(ibis.character, dt);
      const target = this.targets.get(ibis), step = WEATHER_RATE * dt;
      for (const key of ['mud', 'wet']) ibis[key] = Math.min(Math.max(target[key], ibis[key] - step), ibis[key] + step);
      ibis.update(dt);
      // A body shake throws off half the water and half the mud, as drops that fly off.
      if (ibis.character.events.some(e => e.type === 'shakeOff')) {
        fx.shakeOff(ibis);
        target.wet = ibis.wet = Math.max(ibis.wet - 0.5, 0);
        target.mud = ibis.mud = Math.max(ibis.mud - 0.5, 0);
      }
    }
    // The fliers guard their perches, call, and dive at the player. A dive that hits the player's head
    // makes it drop what it holds and stumble.
    // A squawk or a hiss of the player is a noise that the miners hear.
    if (this.sentry && this.player?.character.events.some(e => e.type === 'call' || e.type === 'hiss')) this.sentry.hear(this.player.object.position, SENTRY.loud.call);
    // The player's peck at a miner (a snap) bites: a miner near the head is hurt and flies off.
    if (this.sentry && this.player?.character.events.some(e => e.type === 'bite')) this.sentry.bite();
    this.sentry?.update(this.player, dt, this.perches);
    for (const e of this.sentry?.events ?? []) {
      // The player turns its head to a miner that goes on alert.
      if (e.type === 'alert') {
        const p = this.player.object.position, m = e.flier.object.position;
        this.player.character.animator.lookAt(Math.atan2(m.x - p.x, m.z - p.z), NOTICE_LOOK);
      }
      if (e.type === 'hurt') {
        fx.hit(e.flier, HURT.lines, HURT.hold);
        fx.impact(e.flier.centre());
        this.freeze = HURT.freeze;
      }
    }
    // The next peck snaps at this miner, which shows a white outline.
    if (this.player && this.sentry) {
      const prey = this.sentry.prey();
      this.player.character.snapAt = prey?.centre() ?? null;
      for (const flier of this.fliers) flier.glow = flier === prey ? 1 : 0;
    }
    for (const flier of this.fliers) {
      flier.update(dt);
      for (const e of flier.events) {
        if (e.type === 'hit' && this.player) {
          this.physics?.release(this.player);
          this.player.strike(e.at);
          fx.hit(this.player);
        }
        if (e.type === 'call') sound?.minerCall(e, camera);
      }
    }
    // Puddle splashes: mud on the bird at once (the target too, so it stays), mud blobs and a splash sound.
    this.puddle?.update(dt, this.ibises);
    for (const e of this.puddle?.events ?? []) {
      e.ibis.mud = splashMud(e.ibis.mud, e);
      const target = this.targets.get(e.ibis);
      target.mud = Math.max(target.mud, e.ibis.mud);
      fx.splash(e.at, e.strength, e.land);
      sound?.splash(e, camera);
    }
    if (this.physics) {
      this.physics.step(dt);
      for (const prop of this.props) {
        prop.update(this.ibises);
        for (const e of prop.events) {
          if (e.type === 'slam') { if (e.kind !== 'glass') fx.burst(e.points, e.centre); sound?.slam(e, camera); }
          if (e.type === 'squash') { fx.burst(e.points, e.centre); sound?.squash(e, camera); }
          // A crash is a noise that the miners hear.
          if (e.type === 'slam' || e.type === 'squash') this.sentry?.hear(e.centre, SENTRY.loud.slam * Math.max(...e.points.map(p => p.strength), 0.5));
        }
      }
      this.highlight.update(this.props, this.player ? this.physics.target(this.player) : null);
      this.collidersView?.update();
    }
    fx.update(dt, this.ibises, camera);
    for (const flier of this.fliers) fx.hitLines(flier, dt, camera);
    fx.alertMarks(this.fliers, dt, camera);
    sound?.update(this.ibises, camera);
  }

  // The parts that follow the camera (the ground, the sky) or react to it (the tufts). The tufts hide
  // under the props.
  updateView(camera, dt) {
    const solids = this.props.flatMap(prop => prop.solids?.() ?? []);
    for (const prop of this.props) seeInside(prop, camera.position);
    for (const part of this.parts) part.update?.(camera, dt, this.ibises, solids);
  }
}
