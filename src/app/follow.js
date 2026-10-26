// Free play camera: a loose follow of a point a little ahead of the bird. It moves the camera and its
// orbit centre together, so a drag still orbits and the zoom stays.
//
//   const follow = new Follow(camera, controls, 0.9);
//   follow.update(dt, character);   // every frame
import { Vector3 } from 'three';
import { Spring } from '../ibis/motion/spring.js';

// The orbit centre follows the point on critically damped springs (no overshoot), so the camera trails
// the bird as it starts to move, then overtakes it and shows where it goes. The look-ahead builds and
// turns slowly, so a quick turn or a stop doesn't swing the view. Up: the view follows part of a jump,
// and leads a little on the way up. Seconds and Hz; distances in units.
export const CAMERA = {
  lead: 1.2, maxLead: 4,   // look ahead: seconds of movement, and the most
  leadFreq: [0.4, 0.7],    // how fast the look-ahead builds and turns, and shrinks at a stop (quicker,
                           // so the view doesn't drift on far past the bird)
  follow: 0.5,             // horizontal follow: low is loose
  catchUp: 0.25,           // the follow gets this much stiffer for each unit the bird is past catchFrom
  catchFrom: 3,            // (so it can't leave the view)
  slack: 0.35,             // a soft dead zone round the point: small shuffles don't move the camera
  rise: 0.6,               // part of the height above the floor (a jump) the view follows. The floor: all
  riseLead: 0.15,          // seconds of vertical speed to look ahead, up to riseMax up
  riseMax: 0.8,
  riseFreq: 0.8,           // vertical follow: quicker than horizontal, so a jump stays in view
};

export class Follow {
  // It starts from where the orbit centre is now. height: of the orbit centre above the floor.
  constructor(camera, controls, height) {
    Object.assign(this, { camera, controls, height });
    const { x, y, z } = controls.target;
    this.lead = [new Spring(0, CAMERA.leadFreq[0]), new Spring(0, CAMERA.leadFreq[0])];
    this.x = new Spring(x, CAMERA.follow);
    this.z = new Spring(z, CAMERA.follow);
    this.y = new Spring(y, CAMERA.riseFreq);
    this.shift = new Vector3();
  }

  update(dt, character) {
    const c = character.controller, p = c.position;
    // Look ahead along the velocity on the ground.
    const k = Math.min(CAMERA.lead, CAMERA.maxLead / Math.max(Math.abs(c.speed), 1e-3));
    const tx = Math.sin(c.heading) * c.speed * k, tz = Math.cos(c.heading) * c.speed * k;
    const [lx, lz] = this.lead;
    lx.freq = lz.freq = CAMERA.leadFreq[Math.hypot(tx, tz) < Math.hypot(lx.value, lz.value) ? 1 : 0];
    const ax = lx.update(dt, tx), az = lz.update(dt, tz);
    // The point, with a soft dead zone round it: near the centre the goal stays put.
    let gx = p.x + ax, gz = p.z + az;
    const dx = gx - this.x.value, dz = gz - this.z.value, d = Math.hypot(dx, dz);
    const keep = d > 1e-6 ? Math.max(0, 1 - CAMERA.slack / d) : 0;
    gx = this.x.value + dx * keep;
    gz = this.z.value + dz * keep;
    // Stiffer when the bird is far from the centre, so it stays in view.
    const away = Math.hypot(p.x - this.x.value, p.z - this.z.value);
    this.x.freq = this.z.freq = CAMERA.follow * (1 + CAMERA.catchUp * Math.max(0, away - CAMERA.catchFrom));
    const air = Math.max(p.y - c.floor, 0), up = Math.min(Math.max(c.vy * CAMERA.riseLead, 0), CAMERA.riseMax);
    const gy = this.height + c.floor + CAMERA.rise * air + (c.grounded ? 0 : up);
    this.shift.set(this.x.update(dt, gx), this.y.update(dt, gy), this.z.update(dt, gz)).sub(this.controls.target);
    this.controls.target.add(this.shift);
    this.camera.position.add(this.shift);
    this.controls.update();
  }
}
