// A swing gate in a fence gap: a hinged leaf with a spring back to shut. See docs/props.md.
//
//   const gate = new Gate(physics, asset, { at: [x, z], heading, width, hinge: -1, base });
//   gate.update();   // after physics.step(dt)
//   gate.events      // { type: 'creak', at, strength } as it opens
//
// at: the gap middle. width: post centre to post centre. hinge: -1 or 1, the hinge end along the run.
import { CylinderGeometry, Group, Mesh, PlaneGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLOURS as FENCE_COLOURS, FENCE, wireMaterial } from './fence.js';
import { yaw } from './physics.js';
import { Rest, toonParts } from './props.js';
import { srgb } from './util.js';

// clear: post face to axis, axis to leaf, leaf to latch post, so the leaf misses the posts as it turns.
// spring: Hz, damping. creak: one each step radians of opening, faster than spin; full at loud.
export const GATE = {
  top: 2.75, lift: 0.12, rail: [0.14, 0.09], clear: [0.08, 0.02, 0.08],
  mass: 3, friction: 0.4, damping: 0.6,
  swing: Math.PI / 2, spring: [0.6, 0.45],
  creak: { step: 0.45, spin: 0.4, loud: 2.5, shut: 0.1 },
};
const METAL = [srgb(0.62, 0.64, 0.70), srgb(0.40, 0.42, 0.54), srgb(0.20, 0.21, 0.28)];
// Rust stains: no outline, so they read as paint, not parts.
const RUST = { band: [srgb(0.62, 0.36, 0.20), srgb(0.52, 0.38, 0.38)], streak: [srgb(0.80, 0.60, 0.44), srgb(0.66, 0.56, 0.60)], knuckle: [srgb(0.55, 0.33, 0.20), srgb(0.36, 0.26, 0.30), srgb(0.22, 0.12, 0.08)] };
const STAIN = 0.006;   // proud of the paint

export class Gate {
  static footprint({ width }) { return { half: [width / 2, 0.15], height: GATE.top }; }

  constructor(physics, asset, { at: [x, z], heading = 0, width, hinge = -1, base = 0 }) {
    const { top, lift, rail: [rw, rd], clear } = GATE;
    const post = FENCE.post[0];
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
    // Static anchor inside the hinge post.
    const p = world(hinge * width / 2, base), r = post / 2 - 0.02;
    const anchor = physics.addTerrain([-1, 1].flatMap(a => [-1, 1].flatMap(b => [0, FENCE.post[1]].flatMap(y => [p[0] + a * r, base + y, p[2] + b * r]))));
    this.hinge = physics.addHinge(anchor, this.id, world(axis, base + lift + h / 2), [0, 1, 0], [cs, 0, -sn], [-GATE.swing, GATE.swing], GATE.spring);
    physics.hingeTo(this.hinge, 0);
    this.rest = new Rest(physics, [this.id]);
    this.object = gateMesh(asset, w, h, hinge);
    this.events = [];
    this.creaked = 0;   // turn at the last creak
    this.update();
  }

  update() {
    this.events = [];
    if (this.rest.still()) return;
    const body = this.physics.body(this.id);
    this.object.position.fromArray(body.position);
    this.object.quaternion.fromArray(body.quaternion);
    const C = GATE.creak, [, qy, , qw] = body.quaternion, turn = Math.abs(wrap(2 * Math.atan2(qy, qw) - this.heading));
    const spin = Math.abs(body.motionProperties.angularVelocity[1]);
    if (turn < C.shut) this.creaked = 0;
    else if (turn > this.creaked + C.step && spin > C.spin) {
      this.creaked = turn;
      this.events.push({ type: 'creak', at: new Vector3().fromArray(body.position), strength: Math.min(spin / C.loud, 1) });
    } else if (turn < this.creaked - C.step) this.creaked = turn;
  }

  solids() { return [{ body: this.physics.body(this.id), half: this.half }]; }
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// The leaf in body space, w along x.
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
  const end = hinge * w / 2, stile = end - hinge * rw / 2;
  for (const [i, y] of [h / 2 - 0.35, -h / 2 + 0.35].entries()) {
    parts.push([new CylinderGeometry(0.05, 0.05, 0.22, 8), RUST.knuckle, [end + hinge * 0.02, y, 0]]);
    parts.push([box(rw + 2 * STAIN, 0.3, rd + 2 * STAIN), RUST.band, [stile, y, 0]]);
    // Drip: wide, then narrow.
    const run = i ? 0.16 : 0.42, x = stile + hinge * rw * 0.1, top = y - 0.15;
    parts.push([box(rw * 0.55, run * 0.55, rd + 2 * STAIN), RUST.streak, [x, top - run * 0.275, 0]]);
    parts.push([box(rw * 0.28, run * 0.5, rd + 2 * STAIN), RUST.streak, [x + hinge * rw * 0.05, top - run * 0.75, 0]]);
  }
  for (const y of [h / 2 - rw / 2, -h / 2 + rw / 2]) parts.push([box(0.22, rw + 2 * STAIN, rd + 2 * STAIN), RUST.band, [end - hinge * 0.11, y, 0]]);
  parts.push([box(0.2, 0.08, 0.16), METAL, [-end - hinge * 0.04, h / 2 - 0.6, 0]]);
  const group = new Group().add(...toonParts(parts, asset.uniforms));
  // uv in units, so the diamonds match the fence.
  const wire = new PlaneGeometry(...inner);
  const uv = wire.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * inner[0], uv.getY(i) * inner[1]);
  const mesh = new Mesh(wire, wireMaterial(asset.sun));
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
