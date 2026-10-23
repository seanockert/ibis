// Props for the play area, each a physics body (physics.js) with a toon mesh in the ibis's style: a lit
// and a shade colour split by the sun, and an inverted hull outline, wider on the shadow side.
//
//   const ball = new Ball(physics, asset, [x, z]);
//   scene.add(ball.object);
//   ball.update();   // every frame, after physics.step(dt)
//   ball.events      // this update: { type: 'slam', kind, points: [{ at, strength }], centre } when a prop lands hard
import { BackSide, BufferGeometry, CircleGeometry, Float32BufferAttribute, Color, CylinderGeometry, Group, Matrix4, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { lightUniforms, TOON, TOON_VERTEX } from '../ibis/materials.js';

const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');
// lit, shade, line. The shades lean cool, as in paletteSrgb() in model.glsl.
const COLOURS = {
  footy: [srgb(0.84, 0.25, 0.22), srgb(0.58, 0.16, 0.24), srgb(0.30, 0.07, 0.12)],
  lace: [srgb(0.97, 0.95, 0.90), srgb(0.78, 0.76, 0.84)],
  bin: [srgb(0.30, 0.52, 0.36), srgb(0.21, 0.40, 0.37), srgb(0.07, 0.15, 0.16)],
  lid: [srgb(0.82, 0.27, 0.22), srgb(0.56, 0.17, 0.24), srgb(0.28, 0.07, 0.11)],
  wheel: [srgb(0.25, 0.27, 0.36), srgb(0.15, 0.16, 0.24), srgb(0.07, 0.07, 0.12)],
  hub: [srgb(0.62, 0.64, 0.70), srgb(0.40, 0.42, 0.54)],
  sticker: [srgb(0.30, 0.55, 0.88), srgb(0.20, 0.36, 0.63)],
  inside: [srgb(0.24, 0.42, 0.31), srgb(0.13, 0.25, 0.26)],   // inside the bin: darker than the outside, so the depth reads
  card: [srgb(0.83, 0.62, 0.40), srgb(0.55, 0.42, 0.43), srgb(0.27, 0.15, 0.12)],
  label: [srgb(0.96, 0.94, 0.88), srgb(0.68, 0.68, 0.80)],
  cardInside: [srgb(0.72, 0.52, 0.33), srgb(0.44, 0.32, 0.33)],   // inside a box: a little darker than the outside
};

// AFL football: an ellipsoid about half the length of the bird, light and bouncy. A hull of points on
// the ellipsoid, so it rests on its side, stands up on its points and bounces off at odd angles.
export const FOOTY = { radii: [0.31, 0.31, 0.5], mass: 0.5, friction: 0.6, restitution: 0.55, damping: 0.15 };

export class Ball {
  constructor(physics, asset, [x, z], heading = 0) {
    const [a, b, c] = FOOTY.radii;
    this.physics = physics;
    this.id = physics.addHull(ellipsoidPoints(FOOTY.radii), {
      position: [x, b, z], quaternion: [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)], light: true,
      mass: FOOTY.mass, friction: FOOTY.friction, restitution: FOOTY.restitution, damping: FOOTY.damping,
    });
    this.object = new Group();
    this.object.add(...toon(ellipsoid(1, 40, 24, FOOTY.radii), COLOURS.footy, asset.uniforms));
    // Laces: a thin strip of the surface along the top, a little proud of it.
    const lace = ellipsoid(1.015, 12, 2, FOOTY.radii, [-Math.PI / 2 - 0.08, 0.16], [1.0, Math.PI - 2.0]);
    this.object.add(...toon(lace, COLOURS.lace, asset.uniforms));
    this.update();
  }

  events = [];

  update() { place(this.object, this.physics.body(this.id)); }
}

// Wheelie bin: an upright box on two back wheels, about one and a half times the bird's height, with
// a lid hinged at the back. The centre of mass is low, so a push rocks it and it settles back. A run
// tips it over. Gravity alone keeps a lid shut in most falls, so a soft spring on the hinge opens it:
// with the tilt, so it falls open as the bin goes over, and with the spin, so it flaps when the bin
// rocks. When it lands on its side it throws up dust where its edges hit the ground fastest: the top
// end, which swings furthest.
export const BIN = {
  size: [1.5, 3.0, 1.7], mass: 4, friction: 1.0, com: -0.3,
  wall: 0.08, floor: 0.1,   // hollow: things can go in when the lid is open
  lid: { height: 0.22, overhang: 0.08, mass: 0.35, open: 2.4 },   // open: how far the hinge goes, radians
  // Wheels beside the walls: back: axle in from the back face. gap: from the wall. The tub's solid is
  // the box alone.
  wheel: { radius: 0.24, width: 0.14, gap: 0.02, back: 0.12 },
  // at: place on the side, parts of its half height and half depth. skew: radians about the side's normal.
  sticker: { size: 0.42, at: [0.3, 0.15], skew: 0.14 },
  // Lid open angle for each radian of bin tilt, and each radian per second of spin. The spring on the
  // hinge is weak, so where the lid comes to rest is up to gravity: a bin on its back, lid on the ground.
  flap: { tilt: 0.6, spin: 0.5, spring: [1.5, 0.3] },
  // Slam: the bin spun faster than spin (radians per second) as it fell, then lost most of it.
  // fast: dust only where the edge hit at least this part of the fastest speed. strong: a speed
  // (units per second) for a full puff.
  // low: edges this close to the lowest corner count as on the ground (the open lid can hold the top
  // end up a little).
  slam: { spin: 1.5, keep: 0.5, tilt: 1.0, fast: 0.6, strong: 6, low: 0.45 },
};

export class Bin {
  constructor(physics, asset, [x, z], heading = 0) {
    const [w, h, d] = BIN.size, L = BIN.lid;
    const tub = [w, h - L.height, d], lid = [w + L.overhang, L.height, d + 1.5 * L.overhang];
    const lidZ = L.overhang / 2;   // the lid hangs over the front more than the back
    const cs = Math.cos(heading), sn = Math.sin(heading);
    const world = ([lx, ly, lz]) => [x + lx * cs + lz * sn, ly, z - lx * sn + lz * cs];
    const quaternion = [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)];
    const group = physics.newGroup();
    this.physics = physics;
    this.half = tub.map(v => v / 2);
    this.events = [];
    this.slam = new Slam('bin', this.half, BIN.slam);
    this.id = physics.addHollowBox(tub, {
      position: world([0, tub[1] / 2, 0]), quaternion, mass: BIN.mass, friction: BIN.friction, com: BIN.com, group, wall: BIN.wall, floor: BIN.floor,
    });
    this.lidId = physics.addBox(lid, {
      position: world([0, tub[1] + L.height / 2, lidZ]), quaternion, mass: L.mass, friction: BIN.friction, group,
    });
    // Hinge along the back edge of the lid, at its underside.
    this.hinge = physics.addHinge(this.id, this.lidId, world([0, tub[1], lidZ - lid[2] / 2]), [cs, 0, -sn], [sn, 0, cs], [-L.open, 0], BIN.flap.spring);

    this.tub = new Group();
    this.lid = new Group();
    this.object = new Group().add(this.tub, this.lid);
    const part = (parent, geometry, colours, x, y, z) => {
      for (const mesh of toon(geometry, colours, asset.uniforms)) { mesh.position.set(x, y, z); parent.add(mesh); }
    };
    // Hollow: the outside and the rim, and a darker inside under the lid.
    const [outside, inside] = openBox(tub, BIN.wall, BIN.floor);
    part(this.tub, outside, COLOURS.bin, 0, 0, 0);
    part(this.tub, inside, COLOURS.inside, 0, 0, 0);
    part(this.tub, new RoundedBoxGeometry(w * 0.7, 0.1, 0.12, 2, 0.04), COLOURS.bin, 0, tub[1] / 2 - 0.12, -d / 2 - 0.06);
    // Wheels beside the side walls at the back bottom corners, on an axle through the back, with a hub.
    const W = BIN.wheel, wheelY = -tub[1] / 2 + W.radius, wheelZ = -d / 2 + W.back;
    const wheel = new CylinderGeometry(W.radius, W.radius, W.width, 24).rotateZ(Math.PI / 2);
    const hub = new CylinderGeometry(W.radius * 0.45, W.radius * 0.45, 0.02, 16).rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) {
      const x = s * (w / 2 + W.gap + W.width / 2);
      part(this.tub, wheel, COLOURS.wheel, x, wheelY, wheelZ);
      part(this.tub, hub, COLOURS.hub, x + s * (W.width / 2 + 0.005), wheelY, wheelZ);
    }
    part(this.tub, new CylinderGeometry(0.04, 0.04, w + 2 * W.gap, 8).rotateZ(Math.PI / 2), COLOURS.wheel, 0, wheelY, wheelZ);
    // A square blue sticker on the -x side, a little skewed.
    const S = BIN.sticker;
    part(this.tub, new PlaneGeometry(S.size, S.size).rotateZ(S.skew).rotateY(-Math.PI / 2), COLOURS.sticker, -w / 2 - 0.004, S.at[0] * tub[1] / 2, S.at[1] * d / 2);
    part(this.lid, new RoundedBoxGeometry(...lid, 3, 0.06), COLOURS.lid, 0, 0, 0);
    this.update();
  }

  update() {
    const tub = this.physics.body(this.id);
    place(this.tub, tub);
    place(this.lid, this.physics.body(this.lidId));
    // Tilt from the quaternion: the angle between the tub's up and the world's up.
    const tilt = tiltOf(tub), spin = Math.hypot(...tub.motionProperties.angularVelocity);
    this.physics.hingeTo(this.hinge, -Math.min(BIN.flap.tilt * tilt + BIN.flap.spin * spin, BIN.lid.open));
    this.events = this.slam.update(tub);
  }
}

// Cardboard boxes: 60 to 70% of the bird's height, light, so a walk slides one and a run knocks it over.
// Heavy to the physics, as the bin: it blocks the bird, the forehead pushes it, and the bird can stand
// on it. Two top flaps meet in the middle, each hinged on a long top edge with a weak spring, as the bin
// lid: they fall open as the box tips and flap as it rocks, and gravity holds one open past upright. A
// label on one side. A box that falls over hard puffs dust and thuds (Slam).
export const CARTON = {
  mass: 1.2, friction: 0.5,
  wall: 0.04,   // hollow: card walls and floor, so things can go in when the flaps are open
  flap: { thick: 0.03, gap: 0.01, mass: 0.08, open: 2.6, tilt: 1.2, spin: 0.6, spring: [4, 0.5] },   // open: radians, at most PI (a hinge limit)
  label: [0.4, 0.28],
  slam: { spin: 2.0, keep: 0.5, tilt: 1.0, fast: 0.6, strong: 5, low: 0.3 },
};

export class Box {
  constructor(physics, asset, [x, z], size, heading = 0) {
    const [w, h, d] = size, F = CARTON.flap, t = 0.006;
    const tub = [w, h - F.thick, d], flap = [w, F.thick, d / 2 - F.gap];
    const cs = Math.cos(heading), sn = Math.sin(heading);
    const world = ([lx, ly, lz]) => [x + lx * cs + lz * sn, ly, z - lx * sn + lz * cs];
    const quaternion = [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)];
    const group = physics.newGroup();
    this.physics = physics;
    this.slam = new Slam('box', tub.map(v => v / 2), CARTON.slam);
    this.events = [];
    this.id = physics.addHollowBox(tub, { position: world([0, tub[1] / 2, 0]), quaternion, mass: CARTON.mass, friction: CARTON.friction, group, wall: CARTON.wall });
    // A flap on each long side, hinged on the top edge, from the edge to the middle. The axis turns
    // with the side, so both open at less than 0.
    this.flaps = [-1, 1].map(side => {
      const id = physics.addBox(flap, { position: world([0, tub[1] + F.thick / 2, side * (d / 4 + F.gap / 2)]), quaternion, mass: F.mass, friction: CARTON.friction, group });
      const hinge = physics.addHinge(this.id, id, world([0, tub[1], side * d / 2]), [-side * cs, 0, side * sn], [sn, 0, cs], [-F.open, 0], F.spring);
      const object = new Group();
      for (const mesh of toon(new RoundedBoxGeometry(...flap, 1, 0.01), COLOURS.card, asset.uniforms)) object.add(mesh);
      return { id, hinge, object };
    });

    this.tub = new Group();
    this.object = new Group().add(this.tub, ...this.flaps.map(f => f.object));
    const part = (geometry, colours, px, py, pz) => {
      for (const mesh of toon(geometry, colours, asset.uniforms)) { mesh.position.set(px, py, pz); this.tub.add(mesh); }
    };
    // Hollow, as the bin: the outside and the rim, and a darker inside under the flaps.
    const [outside, inside] = openBox(tub, CARTON.wall, CARTON.wall);
    part(outside, COLOURS.card, 0, 0, 0);
    part(inside, COLOURS.cardInside, 0, 0, 0);
    // A label a little proud of the card, so it doesn't flicker.
    part(new PlaneGeometry(...CARTON.label), COLOURS.label, w * 0.18, -tub[1] * 0.12, d / 2 + t);
    this.update();
  }

  update() {
    const tub = this.physics.body(this.id), F = CARTON.flap;
    place(this.tub, tub);
    const tilt = tiltOf(tub), spin = Math.hypot(...tub.motionProperties.angularVelocity);
    for (const f of this.flaps) {
      place(f.object, this.physics.body(f.id));
      this.physics.hingeTo(f.hinge, -Math.min(F.tilt * tilt + F.spin * spin, F.open));
    }
    this.events = this.slam.update(tub);
  }
}

// Cereal boxes: small, flat and tall (about 40% of the bird's height), and light: a light prop, as the
// ball, so the feet and the head knock them about. A bright print: a title band and a round logo, front
// and back. A foot or the body that comes down on one from above squashes it flat for good (squash()):
// a sheet CEREAL.crush.thick thick on the ground, front up, and a thin heavy body that the bird stands
// on.
export const CEREAL = {
  mass: 0.3, friction: 0.5,
  slam: { spin: 3.0, keep: 0.5, tilt: 1.0, fast: 0.6, strong: 4, low: 0.2 },
  // thick: crushed size, units. bulge: the other sides grow this much. reach: a foot this near the top
  // counts as on it. toes: a point this far ahead of the ankle counts too. width: the toes spread this
  // far round each point. body: the bird's solid (BIRD.solid in physics.js) over the box from above
  // counts too, as a bird that lands with the box between its feet: radius, and its bottom above the feet.
  crush: { thick: 0.07, bulge: 1.12, reach: 0.04, toes: 0.25, width: 0.06, body: { radius: 0.4, bottom: 0.3 } },
  prints: {
    sunny: { body: [srgb(0.98, 0.78, 0.26), srgb(0.72, 0.50, 0.40), srgb(0.32, 0.17, 0.10)], band: COLOURS.label, logo: COLOURS.lid, dot: COLOURS.label },
    berry: { body: [srgb(0.36, 0.58, 0.88), srgb(0.24, 0.35, 0.64), srgb(0.10, 0.13, 0.28)], band: COLOURS.label, logo: [srgb(0.98, 0.78, 0.26), srgb(0.72, 0.50, 0.40)], dot: COLOURS.lid },
  },
};

export class Cereal {
  constructor(physics, asset, [x, z], size, heading = 0, print = 'sunny') {
    const [w, h, d] = size, P = CEREAL.prints[print], t = 0.004;
    this.physics = physics;
    this.size = size;
    this.squashed = false;
    this.slam = new Slam('cereal', size.map(v => v / 2), CEREAL.slam);
    this.events = [];
    this.id = physics.addBox(size, {
      position: [x, h / 2, z], quaternion: [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)],
      mass: CEREAL.mass, friction: CEREAL.friction, light: true,
    });
    this.object = new Group();
    this.print = new Group();   // the mesh: squash() scales it
    this.object.add(this.print);
    const part = (geometry, colours, px, py, pz) => {
      for (const mesh of toon(geometry, colours, asset.uniforms)) { mesh.position.set(px, py, pz); this.print.add(mesh); }
    };
    part(new RoundedBoxGeometry(w, h, d, 2, 0.015), P.body, 0, 0, 0);
    for (const side of [1, -1]) {
      const face = g => (side < 0 ? g.rotateY(Math.PI) : g);
      const z = side * (d / 2 + t);
      part(face(new PlaneGeometry(w * 0.86, h * 0.16)), P.band, 0, h * 0.33, z);
      part(face(new CircleGeometry(w * 0.3, 32)), P.logo, 0, -h * 0.08, z);
      part(face(new CircleGeometry(w * 0.12, 24)), P.dot, w * 0.06, -h * 0.05, z + side * t);
    }
    this.update();
  }

  // ibises: a foot on the top squashes the box.
  update(ibises = []) {
    const body = this.physics.body(this.id);
    place(this.object, body);
    this.events = this.squashed ? [] : this.slam.update(body);
    if (!this.squashed && ibises.some(ibis => this.under(ibis, body))) this.squash(body);
  }

  // The side of the box that faces up: its axis (0 x, 1 y, 2 z), its world direction, out of the top.
  up(body) {
    const m = new Matrix4().makeRotationFromQuaternion(new Quaternion().fromArray(body.quaternion));
    const axes = [0, 1, 2].map(k => new Vector3().setFromMatrixColumn(m, k));
    const k = axes.reduce((best, a, i) => (Math.abs(a.y) > Math.abs(axes[best].y) ? i : best), 0);
    return { k, dir: axes[k].multiplyScalar(Math.sign(axes[k].y)), axes };
  }

  // Is a sole of the bird (the ankle or the toes) on the top of the box, inside its outline? Or does
  // the bird's body come down on it from above?
  under(ibis, body) {
    const R = ibis.rig, C = CEREAL.crush;
    if (!R) return false;
    const { k, dir, axes } = this.up(body), centre = new Vector3().fromArray(body.position), half = this.size.map(v => v / 2);
    const top = centre.y + half[k] * dir.y + C.reach;
    const on = p => {
      const height = p.dot(dir);
      return height >= 0 && height <= half[k] + C.reach && [0, 1, 2].every(i => i === k || Math.abs(p.dot(axes[i])) < half[i] + C.width);
    };
    for (const foot of [R.footL, R.footR]) for (const ahead of [0, C.toes]) {
      if (on(foot.clone().setY(foot.y - 0.05).add(new Vector3(0, 0, ahead)).applyMatrix4(ibis.object.matrixWorld).sub(centre))) return true;
    }
    const p = ibis.character.position, bottom = p.y + C.body.bottom;
    return bottom > centre.y && bottom < top && Math.hypot(p.x - centre.x, p.z - centre.z) < C.body.radius;
  }

  // Flat for good, as a crushed carton: a sheet on the ground with the front up, the big sides bulged
  // out. The box gets a thin heavy body in its place, and the mesh scales to it.
  squash(body) {
    const C = CEREAL.crush, [w, h, d] = this.size, q = new Quaternion().fromArray(body.quaternion);
    const across = new Vector3(1, 0, 0).applyQuaternion(q), yaw = Math.atan2(-across.z, across.x);
    const centre = new Vector3().fromArray(body.position);
    let bottom = Infinity;
    for (let i = 0; i < 8; i++) {
      const corner = new Vector3(i & 1 ? w : -w, i & 2 ? h : -h, i & 4 ? d : -d).multiplyScalar(0.5).applyQuaternion(q);
      bottom = Math.min(bottom, centre.y + corner.y);
    }
    centre.y = bottom + C.thick / 2;
    // Local z (the front) up: turn to the heading, then tip back.
    const flat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
    const size = [w * C.bulge, h * C.bulge, C.thick];
    this.physics.remove(this.id);
    this.id = this.physics.addBox(size, { position: centre.toArray(), quaternion: flat.toArray(), mass: CEREAL.mass, friction: CEREAL.friction });
    this.print.scale.set(C.bulge, C.bulge, C.thick / d);
    this.squashed = true;
    place(this.object, this.physics.body(this.id));
    // Puffs from the four corners of the sheet.
    const points = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => (
      { at: new Vector3(a * size[0] / 2, b * size[1] / 2, 0).applyQuaternion(flat).add(centre), strength: 0.3 }));
    this.events.push({ type: 'squash', kind: 'cereal', points, centre });
  }
}

// Angle between a body's up and the world's up.
export function tiltOf(body) {
  const [qx, , qz] = body.quaternion;
  return Math.acos(Math.min(1, Math.max(-1, 1 - 2 * (qx * qx + qz * qz))));
}

// A slam: the body spun faster than S.spin as it fell, then lost most of it (S.keep) while tipped past
// S.tilt. It keeps the fastest spin of a fall with its velocities (peak): a check of two frames in a row
// missed hits that fell in one long frame. half: half size of the box. update() gives [] or one event.
export class Slam {
  constructor(kind, half, S) {
    Object.assign(this, { kind, half, S });
    this.peak = { spin: 0, v: [0, 0, 0], w: [0, 0, 0] };
  }

  update(body) {
    const spin = Math.hypot(...body.motionProperties.angularVelocity), peak = this.peak;
    if (spin > peak.spin) Object.assign(peak, { spin, v: [...body.motionProperties.linearVelocity], w: [...body.motionProperties.angularVelocity] });
    else if (spin < peak.spin * this.S.keep) {
      const hit = peak.spin > this.S.spin && tiltOf(body) > this.S.tilt;
      peak.spin = spin;
      if (hit) return [this.event(body)];
    }
    return [];
  }

  // Dust points along the edges of the box that lie on the ground, where they hit fast. The speed of a
  // point is v + w x r, with the velocities at the fastest spin of the fall.
  event(tub) {
    const q = new Quaternion().fromArray(tub.quaternion), centre = new Vector3().fromArray(tub.position);
    // Corner i has signs from its bits. An edge joins two corners that differ in one bit.
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new Vector3(...this.half.map((h, k) => (i >> k & 1 ? h : -h)))
      .applyQuaternion(q).add(centre));
    const S = this.S, bottom = Math.min(...corners.map(p => p.y)), points = [], low = bottom + S.low;
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
      const j = i | bit;
      if (j === i || corners[i].y > low || corners[j].y > low) continue;
      for (let t = 0; t <= 1; t += 0.125) points.push(corners[i].clone().lerp(corners[j], t));
    }
    const com = new Vector3().fromArray(tub.centerOfMassPosition), v = new Vector3().fromArray(this.peak.v), w = new Vector3().fromArray(this.peak.w);
    const speeds = points.map(p => new Vector3().crossVectors(w, p.clone().sub(com)).add(v).length());
    const top = Math.max(...speeds);
    const hits = points
      .map((p, i) => ({ at: p.setY(bottom + 0.05), strength: Math.min(speeds[i] / S.strong, 1), fast: speeds[i] >= top * S.fast }))
      .filter(h => h.fast);
    return { type: 'slam', kind: this.kind, points: hits, centre };
  }
}

function place(object, body) {
  object.position.fromArray(body.position);
  object.quaternion.fromArray(body.quaternion);
}

// Points on an ellipsoid, for its convex hull: rings from pole to pole along z.
function ellipsoidPoints([a, b, c], rings = 10, around = 14) {
  const points = [0, 0, c, 0, 0, -c];
  for (let i = 1; i < rings; i++) {
    const t = Math.PI * i / rings;
    for (let j = 0; j < around; j++) {
      const p = 2 * Math.PI * j / around;
      points.push(a * Math.sin(t) * Math.cos(p), b * Math.sin(t) * Math.sin(p), c * Math.cos(t));
    }
  }
  return points;
}

// A sphere stretched to an ellipsoid with its long axis on z, with true ellipsoid normals. phi and
// theta: [start, length] of the part to keep, about and from the z axis.
function ellipsoid(scale, w, h, [a, b, c], phi = [0, Math.PI * 2], theta = [0, Math.PI]) {
  const g = new SphereGeometry(1, w, h, phi[0], phi[1], theta[0], theta[1]).rotateX(Math.PI / 2);
  const pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x * a * scale, y * b * scale, z * c * scale);
    nor.setXYZ(i, ...new Vector3(x / a, y / b, z / c).normalize().toArray());
  }
  return g;
}

// An open box, centred as a box of size: the outside (four sides and the bottom) with the rim on top,
// and the inside (four walls and the floor), wall and floor thick. Flat faces.
function openBox([w, h, d], wall, floor) {
  const make = () => ({ position: [], normal: [] });
  const out = make(), inn = make();
  // A quad from o along u and v, facing n.
  const face = (g, o, u, v, n) => {
    const c = [o, o.clone().add(u), o.clone().add(u).add(v), o.clone().add(v)];
    const order = new Vector3().crossVectors(u, v).dot(n) > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) { g.position.push(...c[i].toArray()); g.normal.push(...n.toArray()); }
  };
  const V = (x, y, z) => new Vector3(x, y, z);
  const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
  const [hw, hh, hd] = [w / 2, h / 2, d / 2], [iw, id] = [hw - wall, hd - wall], fy = -hh + floor;
  // Outside.
  face(out, V(-hw, -hh, hd), X.clone().multiplyScalar(w), Y.clone().multiplyScalar(h), Z);
  face(out, V(-hw, -hh, -hd), X.clone().multiplyScalar(w), Y.clone().multiplyScalar(h), Z.clone().negate());
  face(out, V(hw, -hh, -hd), Z.clone().multiplyScalar(d), Y.clone().multiplyScalar(h), X);
  face(out, V(-hw, -hh, -hd), Z.clone().multiplyScalar(d), Y.clone().multiplyScalar(h), X.clone().negate());
  face(out, V(-hw, -hh, -hd), X.clone().multiplyScalar(w), Z.clone().multiplyScalar(d), Y.clone().negate());
  // Rim: four strips on the top, between the outside and the inside.
  face(out, V(-hw, hh, id), X.clone().multiplyScalar(w), Z.clone().multiplyScalar(wall), Y);
  face(out, V(-hw, hh, -hd), X.clone().multiplyScalar(w), Z.clone().multiplyScalar(wall), Y);
  face(out, V(iw, hh, -id), X.clone().multiplyScalar(wall), Z.clone().multiplyScalar(2 * id), Y);
  face(out, V(-hw, hh, -id), X.clone().multiplyScalar(wall), Z.clone().multiplyScalar(2 * id), Y);
  // Inside: the walls face in, the floor faces up.
  const ih = hh - fy;
  face(inn, V(-iw, fy, id), X.clone().multiplyScalar(2 * iw), Y.clone().multiplyScalar(ih), Z.clone().negate());
  face(inn, V(-iw, fy, -id), X.clone().multiplyScalar(2 * iw), Y.clone().multiplyScalar(ih), Z);
  face(inn, V(iw, fy, -id), Z.clone().multiplyScalar(2 * id), Y.clone().multiplyScalar(ih), X.clone().negate());
  face(inn, V(-iw, fy, -id), Z.clone().multiplyScalar(2 * id), Y.clone().multiplyScalar(ih), X);
  face(inn, V(-iw, fy, -id), X.clone().multiplyScalar(2 * iw), Z.clone().multiplyScalar(2 * id), Y);
  return [out, inn].map(g => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(g.position, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(g.normal, 3));
    return geometry;
  });
}

// The toon mesh, and with a line colour, its outline.
export function toon(geometry, [lit, shade, line], shared) {
  const mesh = new Mesh(geometry, toonMaterial(lit, shade, shared));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (!line) return [mesh];
  geometry.setAttribute('_outline', smoothNormals(geometry));
  return [mesh, new Mesh(geometry, outlineMaterial(line, shared))];
}

// Same values as SHARED in materials.js.
const BAND = /* glsl */`
const float CONTOUR_LIT = 0.01;
const float CONTOUR_SHADE = 0.023;
const float LINE_MIN_PX = 1.0;
`;

// The model matrix, with the instance matrix on an InstancedMesh.
export const MODEL = /* glsl */`
mat4 model() {
#ifdef USE_INSTANCING
  return modelMatrix * instanceMatrix;
#else
  return modelMatrix;
#endif
}
`;

// tones: the lit and shade colours come from the vertex attributes aLit and aShade, so parts of
// several colours draw in one call. Works on an InstancedMesh.
export function toonMaterial(lit, shade, shared, { tones = false } = {}) {
  return new ShaderMaterial({
    lights: true,
    defines: tones ? { TONES: '' } : {},
    uniforms: { ...lightUniforms(), uSun: shared.uSun, uLit: { value: lit }, uShade: { value: shade } },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      ${MODEL}
      varying vec3 vNormal;
      #ifdef TONES
      attribute vec3 aLit, aShade;
      varying vec3 vLit, vShade;
      #endif
      void main() {
        mat4 m = model();
        vec4 world = m * vec4(position, 1.0);
        vNormal = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vNormal);
        #ifdef TONES
        vLit = aLit;
        vShade = aShade;
        #endif
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      uniform vec3 uSun, uLit, uShade;
      varying vec3 vNormal;
      #ifdef TONES
      varying vec3 vLit, vShade;
      #endif
      void main() {
        float band = toonBand(normalize(vNormal), uSun);
        #ifdef TONES
        gl_FragColor = vec4(mix(vShade, vLit, band), 1.0);
        #else
        gl_FragColor = vec4(mix(uShade, uLit, band), 1.0);
        #endif
        #include <colorspace_fragment>
      }`,
  });
}

// Back faces pushed out in screen space along a smooth normal, as hullMaterial() in materials.js.
export function outlineMaterial(line, shared) {
  return new ShaderMaterial({
    side: BackSide,
    uniforms: { uSun: shared.uSun, uViewHeight: shared.uViewHeight, uLine: { value: line } },
    vertexShader: /* glsl */`
      ${BAND}
      ${MODEL}
      uniform vec3 uSun;
      uniform float uViewHeight;
      attribute vec3 _outline;
      void main() {
        mat4 m = model();
        vec3 worldNormal = normalize(mat3(m) * _outline);
        vec4 clip = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
        float units = mix(CONTOUR_SHADE, CONTOUR_LIT, smoothstep(-0.3, 0.6, dot(worldNormal, uSun)));
        float px = max(units * uViewHeight * projectionMatrix[1][1] / (2.0 * clip.w), LINE_MIN_PX);
        vec2 dir = normalize(normalize(mat3(viewMatrix) * worldNormal).xy + 1e-6);
        vec2 ndcPerPixel = 2.0 / (uViewHeight * vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0));
        clip.xy += dir * px * ndcPerPixel * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLine;
      void main() {
        gl_FragColor = vec4(uLine, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Normals averaged over vertices at the same place, so the outline has no gaps at hard edges.
export function smoothNormals(geometry) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal;
  const sums = new Map(), keys = [];
  for (let i = 0; i < pos.count; i++) {
    const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => Math.round(v * 1e4)).join();
    keys.push(key);
    const n = sums.get(key) ?? new Vector3();
    sums.set(key, n.add(new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i))));
  }
  const out = nor.clone();
  keys.forEach((key, i) => out.setXYZ(i, ...sums.get(key).clone().normalize().toArray()));
  return out;
}
