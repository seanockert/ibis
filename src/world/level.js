// A level: the scenery, ground, physics, props and characters of one play space, made from level data
// (src/levels/load.js). It steps them each frame and sends their events to the effects and the sounds.
//
//   const level = new Level(buildLevel(SUBURB), { asset, birds, scene });
//   level.player.input.move.set(0, 1);   // the player's input, then:
//   level.update(dt, camera);       // every frame
//   level.updateView(camera, dt);   // after the camera moves: the parts that follow it, then render
//
// Without env there is no scenery and the ground is flat at 0 (the fixed views, which match sdf.html).
// Without props there is no physics.
import { Vector3 } from 'three';
import { SENTRY, Sentry } from '../characters/sentry.js';
import { FLIERS, SPECIES } from '../characters/species.js';
import { Wander } from '../characters/wander.js';
import { IbisEffects } from '../ibis/effects.js';
import { clamp, hash } from '../ibis/motion/spring.js';
import { Ambience } from './ambience.js';
import { Flies } from './flies.js';
import { Fling } from './fling.js';
import { Highlight } from './highlight.js';
import { PROPS } from './kinds.js';
import { seeInside } from './props.js';
import { Physics } from './physics.js';
import { stack } from './place.js';
import { Hiding } from './disguise.js';
import { GazeFans } from './fans.js';
import { splashMud } from './mud.js';
import { Terrain } from './terrain.js';

const FLAT = { profile: null, height: () => 0 };
const WEATHER_RATE = 0.5;   // mud and wet change per second toward their targets
const PROP_FENCE = 0.5;     // the walls that stop light props are this far outside the bounds
const BRAINS = { wander: (seed, at, bounds) => new Wander(seed, at, bounds) };
const NOTICE_LOOK = 1.5;    // seconds the player looks at a miner that goes on alert
// A snap that hurts a miner: the hit-stop (seconds, and the time rate in it), and the size and hold
// (seconds) of its hit lines. The camera shakes too (Follow.shake(), in main.js).
const HURT = { freeze: 0.12, rate: 0.05, lines: 2.2, hold: 0.6 };
// Solid scenery and props draw before the ground (renderOrder -1), so the depth test skips the ground
// pixels under them: the ground has the most costly shader (about 0.7 ms less in free play). They all
// write depth, so the order changes no pixel. Not the footprints: they write no depth and
// must draw after the ground.
const BEFORE_GROUND = -2;
const NO_DUST = new Set(['glass']);   // slams with no dust: the stubbies
function beforeGround(object) {
  object.traverse(o => { if (o.isMesh && o.renderOrder === 0 && ![o.material].flat().some(m => m.transparent)) o.renderOrder = BEFORE_GROUND; });
}

// out { y, n } from a height function.
function groundOf(height, x, z, out) {
  const e = 0.25, y = height(x, z);
  out.y = y;
  out.n.set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize();
  return out;
}
// Floor and feet of a controller with no physics.
const probe = { y: 0, n: new Vector3() };
function floorOf(c) {
  c.groundAt(c.position.x, c.position.z, probe);
  c.floor = probe.y;
  for (const foot of c.feet) { foot.y = probe.y; foot.n.copy(probe.n); }
}

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
    this.parts = env ? def.scenery({ asset, physics: this.physics, ground: this.ground, bounds: this.bounds }) : [];
    for (const part of this.parts) beforeGround(part.object);
    for (const part of this.parts) scene.add(part.object);
    this.ambience = null;   // background sounds (ambience.js), with env and sound
    this.fx = new IbisEffects(asset);
    if (env) {
      this.fx.surface = def.surface;
      this.fx.height = this.ground.height;
      if (sound) sound.under = def.under ?? null;
      if (sound && def.ambience) this.ambience = new Ambience(sound, def.ambience);
    }
    scene.add(this.fx.object);
    this.props = [];
    this.highlight = null;   // a white outline round the prop that a peck of the player would pick up now
    this.flies = null;       // flies round the props with flies in the level data (flies.js)
    this.hiding = null;      // the disguises' rules (disguise.js), when the level has disguises
    this.fans = null;        // the miners' gaze on the ground (fans.js), when a miner has a gaze
    this.fling = null;       // the player's throws (fling.js), with physics
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
    // Seeds: an item's seed, or its place in the list.
    this.def.characters.forEach((c, i) => this.add(SPECIES[c.species](this.birds, c.seed ?? i), { seed: i, ...c }));
    // Where the fliers can land: the scenery parts that have perches (the fence), and the props.
    this.perches = this.parts.flatMap(p => p.perches?.() ?? []);
    if (this.physics) {
      const defs = this.def.props, bases = stack(defs, d => PROPS[d.kind].footprint(d), this.ground.height);
      const hosts = [];   // props with flies round them
      for (const [i, d] of defs.entries()) {
        const prop = this.addProp(new PROPS[d.kind](this.physics, this.asset, { ...d, base: bases[i], height: this.ground.height }));
        // flies: n or [min, max]
        const flies = Array.isArray(d.flies) ? d.flies[0] + Math.floor(hash((d.seed ?? i) * 17 + 1) * (d.flies[1] - d.flies[0] + 1)) : d.flies;
        if (flies) hosts.push({ prop, count: flies });
      }
      this.perches.push(...this.props.filter(p => p.perch));
      // Disguises: the bird hides in them (disguise.js).
      const disguises = this.props.filter(p => p.disguise);
      if (disguises.length) this.hiding = new Hiding(this, disguises);
      if (hosts.length) {
        this.flies = new Flies(hosts, this.ground.height);
        this.scene.add(this.flies.object);
      }
    }
    // Each flier sits on a perch near its home.
    const first = this.def.characters.length, fliers = this.def.fliers ?? [];
    if (fliers.length) this.sentry = new Sentry(first);
    fliers.forEach(({ species, home, seed = first + i, gaze = null, ...flight }, i) => this.sentry.add(this.addFlier(FLIERS[species](this.birds, seed, flight)), home, this.perches, gaze));
    // The player's throws: hold the peck with a prop in the bill.
    if (this.physics && this.player) this.fling = new Fling(this);
    // The gaze fans on the ground of the miners that have one.
    if (this.sentry?.guards.some(G => G.gaze)) {
      this.fans = new GazeFans(this.sentry, this.ground.height);
      this.scene.add(this.fans.object);
    }
  }

  // Adds a character. at: [x, z], or none to keep where it is. player: the one the input drives. brain:
  // a key of BRAINS, for a character that no player drives.
  add(ibis, { at, heading = 0, player = false, brain = null, seed = this.ibises.length } = {}) {
    const c = ibis.character;
    if (at) {
      c.controller.position.set(at[0], this.ground.height(...at), at[1]);
      c.controller.heading = c.controller.wantHeading = heading;
    }
    c.controller.bounds = this.bounds;
    if (!this.physics) c.controller.groundAt = (x, z, out) => groundOf(this.ground.floor ?? this.ground.height, x, z, out);
    ibis.mud = this.weather.mud;
    ibis.wet = this.weather.wet;
    this.targets.set(ibis, { ...this.weather });
    if (player) this.player = ibis;
    if (brain) this.brains.set(ibis, BRAINS[brain](seed, at ?? [c.position.x, c.position.z], this.bounds));
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
    beforeGround(prop.object);
    this.props.push(prop);
    this.scene.add(prop.object);
    return prop;
  }

  // The mud and wet targets of a character: mud, the sprinkler and a shake set them.
  target(ibis) { return this.targets.get(ibis); }

  // Wireframes of the colliders. It loads the debug renderer only when called.
  async showColliders() {
    this.collidersView = await this.physics.debugView();
    this.scene.add(this.collidersView.object);
  }

  // One frame: brains, characters, physics, props, effects and sounds. The player's input (or a
  // move script) must be set before.
  update(dt, camera) {
    const { fx, sound } = this;
    // Hit-stop: the world almost stops for a moment as a snap hurts a miner.
    if (this.freeze > 0) { this.freeze -= dt; dt *= HURT.rate; }
    for (const ibis of this.ibises) {
      this.brains.get(ibis)?.update(ibis.character, dt);
      const target = this.targets.get(ibis), step = WEATHER_RATE * dt;
      for (const key of ['mud', 'wet']) ibis[key] = Math.min(Math.max(target[key], ibis[key] - step), ibis[key] + step);
      if (!this.physics) floorOf(ibis.character.controller);
      this.hiding?.steer(ibis);
      ibis.update(dt);
      // A step in mud (land.js): mud on the bird, blobs, a splash sound and a ring.
      if (this.ground !== FLAT && this.def.under) {
        const p = ibis.object.position, c = ibis.character;
        for (const e of c.events) {
          if ((e.type !== 'step' && e.type !== 'land') || this.def.under(p.x, p.z) !== 'mud') continue;
          const land = e.type === 'land';
          const strength = land ? clamp(0.45 + e.impact / 8, 0.45, 1) : 0.35 + 0.65 * clamp((Math.abs(c.controller.speed) - 0.5) / 2.5, 0, 1);
          const at = new Vector3(p.x, this.ground.height(p.x, p.z), p.z);
          ibis.mud = splashMud(ibis.mud, { land, strength });
          target.mud = Math.max(target.mud, ibis.mud);
          for (const part of this.parts) part.splash?.(at.x, at.z, strength);
          fx.splash(at, strength, land);
          sound?.splash({ type: 'splash', ibis, at, strength, land }, camera);
        }
      }
      // A body shake throws off half the water and half the mud, as drops that fly off.
      if (ibis.character.events.some(e => e.type === 'shakeOff')) {
        fx.shakeOff(ibis);
        target.wet = ibis.wet = Math.max(ibis.wet - 0.5, 0);
        target.mud = ibis.mud = Math.max(ibis.mud - 0.5, 0);
      }
    }
    this.fans?.update();
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
      // A disguise in reach (outlined) wins: the peck goes in, not a snap. A bird in one can't snap.
      const prey = this.player.character.inside || this.hiding?.target(this.player) ? null : this.sentry.prey();
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
    if (this.physics) {
      this.fling?.beforeStep();
      this.physics.step(dt);
      for (const prop of this.props) {
        prop.update(this.ibises, dt, camera);
        for (const e of prop.events) {
          if (e.type === 'slam') { if (!NO_DUST.has(e.kind)) fx.burst(e.points, e.centre); sound?.slam(e, camera); }
          if (e.type === 'squash') { fx.burst(e.points, e.centre); sound?.squash(e, camera); }
          if (e.type === 'creak') sound?.creak(e, camera);
          // Sprinkler drops on a bird: wetter, and the mud washes off.
          if (e.type === 'soak') {
            const target = this.targets.get(e.ibis);
            target.wet = Math.min(target.wet + e.wet, 1);
            target.mud = Math.max(target.mud - e.wash, 0);
          }
          // A crash is a noise that the miners hear.
          if (e.type === 'slam' || e.type === 'squash') this.sentry?.hear(e.centre, SENTRY.loud.slam * Math.max(...e.points.map(p => p.strength), 0.5));
        }
        if (prop.spray) sound?.spray(prop.spray, camera, prop);
      }
      this.hiding?.update();
      this.fling?.update(dt);
      // The outline: the disguise a peck goes into, or else the prop it takes.
      const into = this.player && this.hiding?.target(this.player);
      this.highlight.update(this.props, into || (this.player ? this.physics.target(this.player) : null));
      this.collidersView?.update();
    }
    if (this.flies) {
      this.flies.update(dt, this.ibises, camera);
      sound?.buzz(this.flies.buzz, camera);
    }
    fx.update(dt, this.ibises, camera);
    for (const flier of this.fliers) fx.hitLines(flier, dt, camera);
    fx.alertMarks(this.fliers, dt, camera);
    sound?.update(this.ibises, camera);
    this.ambience?.update(camera);
  }

  // The parts that follow the camera (the ground, the sky) or react to it (the tufts). The tufts hide
  // under the props.
  updateView(camera, dt) {
    const solids = this.props.flatMap(prop => prop.solids?.() ?? []);
    for (const prop of this.props) seeInside(prop, camera.position);
    for (const part of this.parts) part.update?.(camera, dt, this.ibises, solids);
    for (const part of this.parts) if (part.rustle) this.sound?.rustle(part.rustle, camera);
  }

  renderShadows(renderer) {
    for (const part of this.parts) part.renderShadows?.(renderer, this.scene);
  }
}
