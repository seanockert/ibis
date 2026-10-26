// A level: the scenery, ground, physics, props and characters of one play space, made from level data
// (src/levels/). It steps them each frame and sends their events to the effects and the sounds.
//
//   const level = new Level(STREET, { asset, scene });
//   level.player.input.move.set(0, 1);   // the player's input, then:
//   level.update(dt, camera);       // every frame
//   level.updateView(camera, dt);   // after the camera moves: the parts that follow it, then render
//
// Without env there is no scenery and the ground is flat at 0 (the fixed views, which match sdf.html).
// Without props there is no physics.
import { SPECIES } from '../characters/species.js';
import { Wander } from '../characters/wander.js';
import { IbisEffects } from '../ibis/effects.js';
import { Highlight } from './highlight.js';
import { PROPS } from './kinds.js';
import { Physics } from './physics.js';
import { stack } from './place.js';
import { Puddle, splashMud } from './puddle.js';
import { Terrain } from './terrain.js';

const FLAT = { profile: null, height: () => 0 };
const WEATHER_RATE = 0.5;   // mud and wet change per second toward their targets
const PROP_FENCE = 0.5;     // the walls that stop light props are this far outside the bounds
const BRAINS = { wander: (seed, at, bounds) => new Wander(seed, at, bounds) };

export class Level {
  // env: the scenery and the ground of the level. props: physics and props. terrain: the test course
  // (terrain.js). sound: an IbisSound, or null. weather: { mud, wet } (0 to 1) of every character at
  // the start.
  constructor(def, { asset, scene, env = true, props = true, terrain = false, sound = null, weather = { mud: 0, wet: 0 } }) {
    Object.assign(this, { def, asset, scene, sound, weather });
    this.ground = env ? def.ground : FLAT;
    this.bounds = def.bounds;
    this.ibises = [];
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
    this.def.characters.forEach((c, seed) => this.add(SPECIES[c.species](this.asset, seed), c));
    if (!this.physics) return;
    const defs = this.def.props, bases = stack(defs, d => PROPS[d.kind].footprint(d), this.ground.height);
    for (const [i, d] of defs.entries()) this.addProp(new PROPS[d.kind](this.physics, this.asset, { ...d, base: bases[i] }));
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
    this.physics?.addBird(ibis);
    this.ibises.push(ibis);
    this.scene.add(ibis.object);
    return ibis;
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
        }
      }
      this.highlight.update(this.props, this.player ? this.physics.target(this.player) : null);
      this.collidersView?.update();
    }
    fx.update(dt, this.ibises, camera);
    sound?.update(this.ibises, camera);
  }

  // The parts that follow the camera (the ground, the sky) or react to it (the tufts). The tufts hide
  // under the props.
  updateView(camera, dt) {
    const solids = this.props.flatMap(prop => prop.solids?.() ?? []);
    for (const part of this.parts) part.update?.(camera, dt, this.ibises, solids);
  }
}
