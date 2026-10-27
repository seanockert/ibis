// A flying noisy miner: the bird mesh (Ibis.js) moved by a Flight (flight.js) in place of a Character.
//
//   const miner = new Flier(birds.miner, { seed, height, radius, angle, dir });
//   scene.add(miner.object);
//   miner.flight.centre.set(x, 0, z);   // then flight.target and flight.dive(), see flight.js
//   miner.update(dt);                   // every frame
import { Vector3 } from 'three';
import { Ibis } from '../ibis/Ibis.js';
import { MINER_SCALE } from './bird.js';
import { FLIGHT, Flight } from './flight.js';

export class Flier extends Ibis {
  // flight: the options of Flight (height, radius, angle, dir).
  constructor(asset, { seed = 0, scale = MINER_SCALE, ...flight } = {}) {
    super(asset, { seed, scale });
    this.flight = new Flight({ seed, ...flight });
    this.mark = null;   // '?' or '!' over the head (alertMarks() in effects.js), or null
    this.update(0);
  }

  get events() { return this.flight.events; }

  // Steps the flight and poses the mesh. The object follows the flight's position and heading.
  update(dt) {
    if (!this.flight) return;   // the Ibis constructor calls this before the flight exists
    this.setPose(this.flight.update(Math.max(dt, 1e-4)));
    if (this.inPlace) return;
    this.object.position.copy(this.flight.position);
    this.object.rotation.set(0, this.flight.heading, 0);
  }

  // The middle of the body, world space.
  centre(out = new Vector3()) { return out.copy(this.flight.position).setY(this.flight.position.y + FLIGHT.centre); }
}
