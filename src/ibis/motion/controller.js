// Character controller: turns player input into motion on the ground, and runs the jump.
// It owns where the ibis is. The animator reads its state and makes the pose to match. On the ground,
// the root height follows the feet (support, from the animator), so steps and slopes don't pop.
// World units, the ibis is about 2 tall. Heading 0 faces +z; heading a faces (sin a, cos a).
import { Vector2, Vector3 } from 'three';
import { approach, clamp, damp, mix, wrapAngle } from './spring.js';

export const MOVE = {
  slow: 1.25, fast: 3.0,    // top speeds, units per second
  accel: 10, decel: 14,     // units per second squared
  airControl: 0.4,          // part of accel and turn rate in the air
  turnRate: [6.5, 8],       // radians per second: on the spot (each step carries part of the turn), walking
  turnGain: 14,             // turn speed per radian of heading error: the turn eases out as it ends
  turnAccel: 70,            // radians per second squared: the turn eases in, so the head leads
  turnSlow: [0.6, 2.2],     // heading error (radians) where the bird starts to slow, and stops to turn on the spot
  rootAccel: 30,            // how fast the speed follows root motion
};

export const JUMP = {
  crouch: 0.06,             // wind-up before take-off. Short, so the jump feels instant
  speed: 4.4,               // take-off speed
  gravity: 15,              // on the way up
  fallGravity: 24,          // on the way down: a snappier arc
  cut: 0.45,                // part of the up speed kept when the button is let go early: a tap gives a hop
  buffer: 0.12,             // a press this long before landing still jumps
  flutter: 1.4,             // seconds of flutter per jump, while the button is held
  flutterRise: 1.0,         // up speed the flutter climbs to: a full flutter gets on top of a fallen bin
  flutterAccel: 9,
};

// Uneven ground. Higher than stepUp is a wall (the solid in physics.js stops the bird); a drop farther
// than stepDown is a fall.
export const GROUND = {
  stepUp: 0.25,             // the bird steps up onto a top this much higher, with no jump
  stepDown: 0.3,
  toes: 0.2,                // the ground under a foot is the higher of the ankle and this far ahead: toes on a step edge
  follow: 0.05,             // half-life (s) of the root height toward the feet
};

// Flat ground at y = 0: the default when no physics gives the ground.
function flatGround(x, z, out) {
  out.y = 0;
  out.n.set(0, 1, 0);
  return out;
}

export class Controller {
  constructor() {
    // move: wanted direction on the ground (x, z), length 0 to 1. fast: run. jump: button held.
    this.input = { move: new Vector2(), fast: false, jump: false };
    this.position = new Vector3();   // y is the height above the ground
    this.floor = 0;                  // highest ground under the feet and toes: the bird lands on it
    // Ground under each posed foot (ankle or toe tip, the higher): world height and normal (physics.js).
    this.feet = [{ y: 0, n: new Vector3(0, 1, 0) }, { y: 0, n: new Vector3(0, 1, 0) }];
    this.groundAt = flatGround;      // (x, z, out) => out { y, n }: the ground under a world point
    this.support = null;             // height the feet carry the root at, from the animator, or null
    this.heading = 0;
    this.wantHeading = 0;            // heading of the input, or the heading when there is no input
    this.speed = 0;                  // along the heading. Less than 0 is backward (root motion only)
    this.accel = 0;                  // change of speed per second
    this.turn = 0;                   // change of heading per second
    this.vy = 0;
    this.state = 'ground';           // ground, crouch (jump wind-up) or air
    this.fluttering = false;
    this.bounds = null;              // { x: [min, max], z: [min, max] }: world box the bird can't leave
    this.root = null;                // speed from an action (root motion), or null: input moves the bird
    this.locked = false;             // true: an action owns the bird and the input does nothing
    this.faceTarget = null;          // heading to turn to on the spot, or null
    this.pivot = null;               // world { x, z } of the foot that carries the weight, from the animator
    this.shove = 0;                  // 0 to 1: a heavy thing just ahead of the head (src/world/physics.js)
    this.carry = null;               // jaw opening round what the bill holds (src/world/physics.js), or null
    this.events = [];                // this step: { type: crouch | jump | land, ... }
    this.held = false;
    this.buffer = 0;
    this.stateTime = 0;
    this.flutterLeft = 0;
    this.cutDone = false;
  }

  get grounded() { return this.state !== 'air'; }

  // Turns on the spot to a heading. Walking input cancels it.
  turnTo(heading) { this.faceTarget = heading; }

  step(dt) {
    this.events.length = 0;
    this.stateTime += dt;
    this.steer(dt);
    this.jump(dt);
  }

  // Heading turns toward the input with an eased turn speed. The bird walks only where it faces, and
  // slows in a sharp turn, so a reverse turns on the spot. On the spot, the body turns about the foot
  // that carries the weight (pivot), so that foot stays where it is.
  steer(dt) {
    const { move, fast } = this.input;
    const amount = this.locked || this.root !== null ? 0 : Math.min(move.length(), 1);
    if (amount > 0.01) { this.wantHeading = Math.atan2(move.x, move.y); this.faceTarget = null; }
    else if (this.faceTarget !== null && this.root === null) this.wantHeading = this.faceTarget;
    else this.wantHeading = this.heading;
    if (this.faceTarget !== null && Math.abs(wrapAngle(this.faceTarget - this.heading)) < 0.02) this.faceTarget = null;
    const control = this.grounded ? 1 : MOVE.airControl;
    const error = wrapAngle(this.wantHeading - this.heading);
    const turnRate = mix(MOVE.turnRate[0], MOVE.turnRate[1], clamp(Math.abs(this.speed) / MOVE.slow, 0, 1)) * control;
    this.turn = approach(this.turn, clamp(error * MOVE.turnGain, -turnRate, turnRate), MOVE.turnAccel * control * dt);
    let step = this.turn * dt;
    if (Math.abs(step) > Math.abs(error)) { step = error; this.turn = step / dt; }
    this.heading = wrapAngle(this.heading + step);
    const pivotW = this.grounded && this.pivot ? 1 - clamp(Math.abs(this.speed) / 0.4, 0, 1) : 0;
    if (pivotW > 0) {
      const a = step * pivotW, cs = Math.cos(a), sn = Math.sin(a);
      const dx = this.position.x - this.pivot.x, dz = this.position.z - this.pivot.z;
      this.position.x = this.pivot.x + dx * cs + dz * sn;
      this.position.z = this.pivot.z - dx * sn + dz * cs;
    }

    const [slowAt, stopAt] = MOVE.turnSlow;
    let top = amount * (fast ? MOVE.fast : MOVE.slow) * clamp((stopAt - Math.abs(error)) / (stopAt - slowAt), 0, 1);
    let rate = (Math.abs(top) > Math.abs(this.speed) ? MOVE.accel : MOVE.decel) * control;
    if (this.root !== null) { top = this.root; rate = MOVE.rootAccel; }
    const before = this.speed;
    this.speed = approach(this.speed, top, rate * dt);
    this.accel = (this.speed - before) / dt;
    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.z += Math.cos(this.heading) * this.speed * dt;
    if (this.bounds) {
      this.position.x = clamp(this.position.x, ...this.bounds.x);
      this.position.z = clamp(this.position.z, ...this.bounds.z);
    }
  }

  // Jump: a short crouch, take-off, a variable height (let go early for a hop), then a flutter while the
  // button is held, as in Yoshi's flutter jump.
  jump(dt) {
    const jump = this.input.jump && !this.locked;
    const pressed = jump && !this.held;
    this.held = jump;
    this.buffer = pressed ? JUMP.buffer : Math.max(this.buffer - dt, 0);

    if (this.state === 'ground' && this.buffer > 0) {
      this.buffer = 0;
      this.enter('crouch');
    }
    if (this.state === 'crouch' && this.stateTime >= JUMP.crouch) {
      this.vy = JUMP.speed;
      this.flutterLeft = JUMP.flutter;
      this.cutDone = false;
      this.enter('air');
    }
    if (this.state !== 'air') {
      // The root eases to the height the feet carry it at: a step up or down takes a few frames.
      if (this.position.y <= this.floor + GROUND.stepDown) {
        this.position.y += ((this.support ?? this.floor) - this.position.y) * damp(GROUND.follow, dt);
        return;
      }
      // Walked off the edge of something: fall, with no flutter.
      this.vy = 0;
      this.flutterLeft = 0;
      this.cutDone = true;
      this.enter('air', {}, 'fall');
    }

    if (!this.held && !this.cutDone && this.vy > 0) { this.vy *= JUMP.cut; this.cutDone = true; }
    this.fluttering = this.held && this.flutterLeft > 0 && this.vy < JUMP.flutterRise + 0.1;
    if (this.fluttering) {
      this.flutterLeft -= dt;
      this.vy = approach(this.vy, JUMP.flutterRise, JUMP.flutterAccel * dt);
    } else {
      this.vy -= (this.vy > 0 ? JUMP.gravity : JUMP.fallGravity) * dt;
    }
    this.position.y += this.vy * dt;
    if (this.position.y <= this.floor) {
      const impact = -this.vy;
      this.position.y = this.floor;
      this.vy = 0;
      this.fluttering = false;
      this.enter('ground', { impact });
    }
  }

  enter(state, info = {}, type = state === 'ground' ? 'land' : state === 'crouch' ? 'crouch' : 'jump') {
    this.state = state;
    this.stateTime = 0;
    this.events.push({ type, ...info });
  }
}
