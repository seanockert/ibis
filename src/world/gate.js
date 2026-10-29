// A swing gate in the fence (fence.js): a white frame with a diagonal brace and chain wire, on a hinge at
// one fence post. It swings freely both ways, and a soft spring takes it back to shut. The bird pushes it
// open as it pushes a prop (physics.js). The hinge creaks as it opens. Rust round the hinges.
//
//   const gate = new Gate(physics, asset, { at: [x, z], heading, width, hinge: -1, base });
//   Gate.footprint(def)   // for placement (place.js)
//   gate.update();        // every frame, after physics.step(dt)
//   gate.events           // this update: { type: 'creak', at, strength } as it opens
//
// at: the middle of the gap in the fence. heading: the run's direction (0: along +x). width: the gap,
// post centre to post centre, as the gate's width in the fence data. hinge: the end with the hinge, -1
// or 1 along the run. The fence posts at the ends of the gap are the gate posts.
import { CylinderGeometry, Group, Mesh, PlaneGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLOURS as FENCE_COLOURS, FENCE, wireMaterial } from './fence.js';
import { yaw } from './physics.js';
import { Rest, toonParts } from './props.js';
import { srgb } from './util.js';

// Sizes in units (the bird is 2 tall). top: of the leaf, a little below the fence rail. lift: the gap
// under it. rail: width and depth of the frame. clear: the gap from the hinge post face to the hinge
// axis, from the axis to the leaf, and from the leaf to the latch post: the leaf must not touch the
// posts as it turns. swing: radians each way. spring: Hz and damping of the pull back to shut. creak:
// as it opens, one creak each step radians, while it turns faster than spin (radians a second); full at
// loud. shut: it must come back within this of shut before the creaks start again from shut.
export const GATE = {
  top: 2.75, lift: 0.12, rail: [0.14, 0.09], clear: [0.08, 0.02, 0.08],
  mass: 3, friction: 0.4, damping: 0.6,
  swing: Math.PI / 2, spring: [0.6, 0.45],
  creak: { step: 0.45, spin: 0.4, loud: 2.5, shut: 0.1 },
};
const METAL = [srgb(0.62, 0.64, 0.70), srgb(0.40, 0.42, 0.54), srgb(0.20, 0.21, 0.28)];
// Rust: a dark band round each knuckle on the stile and the rail ends near it, and a lighter streak run
// down from it. No outline: a stain on the paint, not a part. Rusty knuckles.
const RUST = { band: [srgb(0.62, 0.36, 0.20), srgb(0.52, 0.38, 0.38)], streak: [srgb(0.80, 0.60, 0.44), srgb(0.66, 0.56, 0.60)], knuckle: [srgb(0.55, 0.33, 0.20), srgb(0.36, 0.26, 0.30), srgb(0.22, 0.12, 0.08)] };
const STAIN = 0.006;   // a stain stands this far proud of the paint

export class Gate {
  static footprint({ width }) { return { half: [width / 2, 0.15], height: GATE.top }; }

  constructor(physics, asset, { at: [x, z], heading = 0, width, hinge = -1, base = 0 }) {
    const { top, lift, rail: [rw, rd], clear } = GATE;
    const post = FENCE.post[0];
    // Along the run (local x): the hinge axis, then the leaf from near to far.
    const axis = hinge * (width / 2 - post / 2 - clear[0]);
    const far = -hinge * (width / 2 - post / 2 - clear[2]);
    const near = axis - hinge * clear[1];
    const w = Math.abs(far - near), h = top - lift;
    const cs = Math.cos(heading), sn = Math.sin(heading);
    const world = (lx, y, lz = 0) => [x + lx * cs + lz * sn, y, z - lx * sn + lz * cs];
    this.physics = physics;
    this.heading = heading;
    this.half = [w / 2, h / 2, rd / 2];
    const centre = world((near + far) / 2, base + lift + h / 2);
    this.id = physics.addBox([w, h, rd], {
      position: centre, quaternion: yaw(heading), mass: GATE.mass, friction: GATE.friction, damping: GATE.damping,
    });
    // The hinge post as a static body to hang the leaf on (inside the fence post: the bird never touches it).
    const p = world(hinge * width / 2, base), r = post / 2 - 0.02;
    const anchor = physics.addTerrain([-1, 1].flatMap(a => [-1, 1].flatMap(b => [0, FENCE.post[1]].flatMap(y => [p[0] + a * r, base + y, p[2] + b * r]))));
    this.hinge = physics.addHinge(anchor, this.id, world(axis, base + lift + h / 2), [0, 1, 0], [cs, 0, -sn], [-GATE.swing, GATE.swing], GATE.spring);
    physics.hingeTo(this.hinge, 0);
    this.rest = new Rest(physics, [this.id]);
    this.object = gateMesh(asset, w, h, hinge);
    this.events = [];
    this.creaked = 0;   // the turn of the last creak, from shut
    this.update();
  }

  update() {
    this.events = [];
    if (this.rest.still()) return;
    const body = this.physics.body(this.id);
    this.object.position.fromArray(body.position);
    this.object.quaternion.fromArray(body.quaternion);
    // The turn from shut, and its speed. Opening: a creak each GATE.creak.step past the last one.
    const C = GATE.creak, [, qy, , qw] = body.quaternion, turn = Math.abs(wrap(2 * Math.atan2(qy, qw) - this.heading));
    const spin = Math.abs(body.motionProperties.angularVelocity[1]);
    if (turn < C.shut) this.creaked = 0;
    else if (turn > this.creaked + C.step && spin > C.spin) {
      this.creaked = turn;
      this.events.push({ type: 'creak', at: new Vector3().fromArray(body.position), strength: Math.min(spin / C.loud, 1) });
    } else if (turn < this.creaked - C.step) this.creaked = turn;   // going back: creak again on the next opening
  }

  // The leaf, for the grass tufts (tufts.js) and the fade (seeInside()).
  solids() { return [{ body: this.physics.body(this.id), half: this.half }]; }
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// The leaf in the body's frame (its middle at 0, w along x, h along y): a frame of four rails, a brace
// from the bottom at the hinge to the top at the latch, wire in the frame, hinge knuckles and a latch.
function gateMesh(asset, w, h, hinge) {
  const [rw, rd] = GATE.rail, round = 0.04;
  const box = (sx, sy, sz) => new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(round, sx / 2, sy / 2, sz / 2));
  const white = FENCE_COLOURS.post;
  const inner = [w - 2 * rw, h - 2 * rw];
  const brace = Math.hypot(...inner), tilt = Math.atan2(inner[1], inner[0]);
  const parts = [
    [box(w, rw, rd), white, [0, h / 2 - rw / 2, 0]],
    [box(w, rw, rd), white, [0, -h / 2 + rw / 2, 0]],
    [box(rw, h - 2 * rw + 0.02, rd), white, [-w / 2 + rw / 2, 0, 0]],
    [box(rw, h - 2 * rw + 0.02, rd), white, [w / 2 - rw / 2, 0, 0]],
    [box(brace, rw * 0.8, rd * 0.8).rotateZ(-hinge * tilt), white, [0, 0, 0]],
  ];
  // Two rusty knuckles on the hinge side, a latch on the other. Round each: a rust band on the stile and
  // the rail end, and a streak down the stile's faces.
  const end = hinge * w / 2, stile = end - hinge * rw / 2;
  for (const [i, y] of [h / 2 - 0.35, -h / 2 + 0.35].entries()) {
    parts.push([new CylinderGeometry(0.05, 0.05, 0.22, 8), RUST.knuckle, [end + hinge * 0.02, y, 0]]);
    parts.push([box(rw + 2 * STAIN, 0.3, rd + 2 * STAIN), RUST.band, [stile, y, 0]]);
    // A drip: wide at the top, narrow below. The low one has little room under it.
    const run = i ? 0.16 : 0.42, x = stile + hinge * rw * 0.1, top = y - 0.15;
    parts.push([box(rw * 0.55, run * 0.55, rd + 2 * STAIN), RUST.streak, [x, top - run * 0.275, 0]]);
    parts.push([box(rw * 0.28, run * 0.5, rd + 2 * STAIN), RUST.streak, [x + hinge * rw * 0.05, top - run * 0.75, 0]]);
  }
  for (const y of [h / 2 - rw / 2, -h / 2 + rw / 2]) parts.push([box(0.22, rw + 2 * STAIN, rd + 2 * STAIN), RUST.band, [end - hinge * 0.11, y, 0]]);
  parts.push([box(0.2, 0.08, 0.16), METAL, [-end - hinge * 0.04, h / 2 - 0.6, 0]]);
  const group = new Group().add(...toonParts(parts, asset.uniforms));
  // Wire: one quad in the frame, uv in units so the diamonds match the fence.
  const wire = new PlaneGeometry(...inner);
  const uv = wire.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * inner[0], uv.getY(i) * inner[1]);
  const mesh = new Mesh(wire, wireMaterial(asset.sun));
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
