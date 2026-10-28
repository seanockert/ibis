// Props for the play area, each a physics body (physics.js) with a toon mesh in the ibis's style: a lit
// and a shade colour split by the sun, and an inverted hull outline, wider on the shadow side.
//
//   const ball = new Ball(physics, asset, { at: [x, z], heading, base });   // base: height of its bottom
//   Ball.footprint(def)   // { half: [x, z], height, centre? }: its size for placement (place.js)
//   scene.add(ball.object);
//   ball.update();   // every frame, after physics.step(dt)
//   ball.events      // this update: { type: 'slam', kind, points: [{ at, strength }], centre } when a prop lands hard
//
// Each rigid body's mesh is two draws, whatever its parts (toonParts()). A prop whose bodies sleep does
// no work (Rest).
import { BackSide, BufferGeometry, CircleGeometry, Float32BufferAttribute, Color, CylinderGeometry, Group, Matrix4, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry, Vector3, Vector4 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lightUniforms, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { tiltAngle, yaw } from './physics.js';
import { f, srgb } from './util.js';
import { WIND_SWAY, windDepthMaterial, windTime } from './wind.js';

// lit, shade, line. The shades lean cool, as in paletteSrgb() in model.glsl.
const COLOURS = {
  footy: [srgb(0.84, 0.25, 0.22), srgb(0.58, 0.16, 0.24), srgb(0.30, 0.07, 0.12)],
  lace: [srgb(0.97, 0.95, 0.90), srgb(0.78, 0.76, 0.84)],
  bin: [srgb(0.30, 0.52, 0.36), srgb(0.21, 0.40, 0.37), srgb(0.07, 0.15, 0.16)],
  lid: [srgb(0.82, 0.27, 0.22), srgb(0.56, 0.17, 0.24), srgb(0.28, 0.07, 0.11)],
  lidRed: [srgb(0.82, 0.27, 0.22), srgb(0.56, 0.17, 0.24), srgb(0.28, 0.07, 0.11)],
  lidYellow: [srgb(0.95, 0.78, 0.20), srgb(0.72, 0.52, 0.12), srgb(0.38, 0.25, 0.06)],
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
  static footprint() { return { half: [FOOTY.radii[0], FOOTY.radii[2]], height: 2 * FOOTY.radii[1] }; }

  constructor(physics, asset, { at: [x, z], heading = 0, base = 0 }) {
    const [a, b, c] = FOOTY.radii;
    this.physics = physics;
    this.id = physics.addHull(ellipsoidPoints(FOOTY.radii), {
      position: [x, base + b, z], quaternion: yaw(heading), light: true,
      mass: FOOTY.mass, friction: FOOTY.friction, restitution: FOOTY.restitution, damping: FOOTY.damping,
    });
    this.rest = new Rest(physics, [this.id]);
    // Laces: a thin strip of the surface along the top, a little proud of it.
    const lace = ellipsoid(1.015, 12, 2, FOOTY.radii, [-Math.PI / 2 - 0.08, 0.16], [1.0, Math.PI - 2.0]);
    this.object = new Group().add(...toonParts([[ellipsoid(1, 28, 16, FOOTY.radii), COLOURS.footy], [lace, COLOURS.lace]], asset.uniforms));
    this.update();
  }

  events = [];

  update() {
    if (!this.rest.still()) place(this.object, this.physics.body(this.id));
  }

  // The solids, for the grass tufts (tufts.js): the body, the half size and round (an ellipsoid).
  solids() { return [{ body: this.physics.body(this.id), half: FOOTY.radii, round: true }]; }
}

// A hollow prop (the bin, a box) with hinged flaps on top. Gravity alone keeps a flap shut in most
// falls, so a soft spring on each hinge opens it: with the tilt, so it falls open as the tub goes over,
// and with the spin, so it flaps when the tub rocks. A slam when it falls over hard.
class Tub {
  constructor(physics) {
    this.physics = physics;
    this.events = [];
  }

  // After the bodies: the tub's mesh, and the flaps (their meshes go beside it, not in it).
  build(flaps, meshes) {
    this.flaps = flaps;
    this.tub = new Group().add(...meshes);
    this.object = new Group().add(this.tub, ...flaps.map(f => f.object));
    this.rest = new Rest(this.physics, [this.id, ...flaps.map(f => f.id)]);
    this.update();
  }

  update() {
    this.events = [];
    if (this.rest.still()) return;
    const tub = this.physics.body(this.id);
    place(this.tub, tub);
    const tilt = tiltAngle(tub.quaternion), spin = length(tub.motionProperties.angularVelocity);
    for (const f of this.flaps) f.update(tilt, spin);
    this.events = this.slam.update(tub, spin);
  }

  solids() { return [{ body: this.physics.body(this.id), half: this.half }, ...this.flaps.map(f => f.solid())]; }

  // Where a small bird can land on top, world, or null: the middle of the top, while the tub stands
  // upright and the lid or the flaps are shut. Rays down halfway to the front and the back find them at
  // the height of the top (not in the middle: the two flaps of a box meet there with a gap). cap: the
  // thickness of the lid or the flaps.
  perch(out = new Vector3()) {
    const body = this.physics.body(this.id);
    if (tiltAngle(body.quaternion) > PERCH.tilt) return null;
    const q = new Quaternion().fromArray(body.quaternion), at = new Vector3().fromArray(body.position), top = this.half[1] + this.cap;
    for (const side of [-0.5, 0.5]) {
      const p = new Vector3(0, top, side * this.half[2]).applyQuaternion(q).add(at);
      if (Math.abs(this.physics.groundAt(p.x, p.z, p.y + 0.5, PERCH.probe).y - p.y) > PERCH.shut) return null;
    }
    return out.set(0, top, 0).applyQuaternion(q).add(at);
  }
}

// Perch on a tub: tilt, the most tilt (radians) to land on it. shut: the top must be this near the
// height of a shut lid.
const PERCH = { tilt: 0.15, shut: 0.1, probe: { y: 0, n: new Vector3() } };

// A lid or a flap on a hinge: it opens F.tilt for each radian of the tub's tilt, and F.spin for each
// radian per second of its spin, up to F.open. size: of the body.
class Flap {
  constructor(physics, id, hinge, size, F, meshes) {
    Object.assign(this, { physics, id, hinge, F });
    this.half = size.map(v => v / 2);
    this.object = new Group().add(...meshes);
  }

  update(tilt, spin) {
    place(this.object, this.physics.body(this.id));
    this.physics.hingeTo(this.hinge, -Math.min(this.F.tilt * tilt + this.F.spin * spin, this.F.open));
  }

  solid() { return { body: this.physics.body(this.id), half: this.half }; }
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

// Lid colours: red general waste, yellow recycling.
const LIDS = { red: COLOURS.lidRed, yellow: COLOURS.lidYellow };
const binScale = small => 1.2 * (small ? 0.70 : 1);

export class Bin extends Tub {
  // The tub, the wheels out at the sides and the lid out at the front.
  static footprint({ small = false }) {
    const s = binScale(small), [w, h, d] = BIN.size.map(v => v * s), W = BIN.wheel;
    return { half: [w / 2 + (W.gap + W.width) * s, d / 2 + 1.25 * BIN.lid.overhang * s], height: h };
  }

  // small: 70% scale. lid: a key of LIDS. base: the height of its bottom.
  constructor(physics, asset, { at: [x, z], heading = 0, base = 0, small = false, lid: colour = 'red' }) {
    super(physics);
    const s = binScale(small);
    const [w, h, d] = BIN.size.map(v => v * s), L = BIN.lid;
    const tub = [w, h - L.height * s, d];
    const lid = [w + L.overhang * s, L.height * s, d + 1.5 * L.overhang * s];
    const scaled = v => v * s;
    const lidZ = L.overhang * s / 2;
    const world = toWorld(x, z, heading), quaternion = yaw(heading);
    const [cs, sn] = [Math.cos(heading), Math.sin(heading)];
    const group = physics.newGroup();

    this.half = tub.map(v => v / 2);
    this.cap = lid[1];
    this.slam = new Slam('bin', this.half, BIN.slam);
    this.id = physics.addHollowBox(tub, {
      position: world([0, base + tub[1] / 2, 0]),
      quaternion, mass: BIN.mass, friction: BIN.friction,
      com: BIN.com, group, wall: BIN.wall, floor: BIN.floor,
    });

    const lidId = physics.addBox(lid, {
      position: world([0, base + tub[1] + lid[1] / 2, lidZ]),
      quaternion, mass: L.mass, friction: BIN.friction, group,
    });

    const hinge = physics.addHinge(
      this.id, lidId,
      world([0, base + tub[1], lidZ - lid[2] / 2]),
      [cs, 0, -sn], [sn, 0, cs], [-L.open, 0], BIN.flap.spring,
    );

    this.lid = new Flap(physics, lidId, hinge, lid,
      { ...BIN.flap, open: L.open },
      toonParts([[
        new RoundedBoxGeometry(...lid, 3, scaled(0.06)),
        LIDS[colour],
      ]], asset.uniforms));

    const [outside, inside] = openBox(tub, BIN.wall, BIN.floor);
    const parts = [
      [outside, COLOURS.bin],
      [inside, COLOURS.inside],
      [new RoundedBoxGeometry(w * 0.7, scaled(0.1), scaled(0.12), 2, scaled(0.04)),
        COLOURS.bin, [0, tub[1] / 2 - scaled(0.12), -d / 2 - scaled(0.06)]],
    ];

    const W = BIN.wheel;
    const wheelY = -tub[1] / 2 + W.radius * s;
    const wheelZ = -d / 2 + W.back * s;

    for (const side of [-1, 1]) {
      const x = side * (w / 2 + (W.gap + W.width / 2) * s);
      parts.push([
        new CylinderGeometry(W.radius * s, W.radius * s, W.width * s, 16).rotateZ(Math.PI / 2),
        COLOURS.wheel, [x, wheelY, wheelZ],
      ]);
      parts.push([
        new CylinderGeometry(W.radius * 0.45 * s, W.radius * 0.45 * s, 0.02 * s, 16).rotateZ(Math.PI / 2),
        COLOURS.hub, [x + side * (W.width / 2 + 0.005) * s, wheelY, wheelZ],
      ]);
    }

    parts.push([
      new CylinderGeometry(0.04 * s, 0.04 * s, w + 2 * W.gap * s, 8).rotateZ(Math.PI / 2),
      COLOURS.wheel, [0, wheelY, wheelZ],
    ]);

    const S = BIN.sticker;
    parts.push([
      new PlaneGeometry(S.size * s, S.size * s).rotateZ(S.skew).rotateY(-Math.PI / 2),
      COLOURS.sticker,
      [-w / 2 - 0.004 * s, S.at[0] * tub[1] / 2, S.at[1] * d / 2],
    ]);

    this.build([this.lid], toonParts(parts, asset.uniforms));
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

export class Box extends Tub {
  static footprint({ size: [w, h, d] }) { return { half: [w / 2, d / 2], height: h }; }

  // size: [x, y, z]. base: the height of its bottom.
  constructor(physics, asset, { at: [x, z], size, heading = 0, base = 0 }) {
    super(physics);
    const [w, h, d] = size, F = CARTON.flap, t = 0.006;
    const tub = [w, h - F.thick, d], flap = [w, F.thick, d / 2 - F.gap];
    const world = toWorld(x, z, heading), quaternion = yaw(heading), [cs, sn] = [Math.cos(heading), Math.sin(heading)];
    const group = physics.newGroup();
    this.half = tub.map(v => v / 2);
    this.cap = F.thick;
    this.slam = new Slam('box', this.half, CARTON.slam);
    this.id = physics.addHollowBox(tub, { position: world([0, base + tub[1] / 2, 0]), quaternion, mass: CARTON.mass, friction: CARTON.friction, group, wall: CARTON.wall });
    // A flap on each long side, hinged on the top edge, from the edge to the middle. The axis turns
    // with the side, so both open at less than 0.
    const flaps = [-1, 1].map(side => {
      const id = physics.addBox(flap, { position: world([0, base + tub[1] + F.thick / 2, side * (d / 4 + F.gap / 2)]), quaternion, mass: F.mass, friction: CARTON.friction, group });
      const hinge = physics.addHinge(this.id, id, world([0, base + tub[1], side * d / 2]), [-side * cs, 0, side * sn], [sn, 0, cs], [-F.open, 0], F.spring);
      return new Flap(physics, id, hinge, flap, F, toonParts([[new RoundedBoxGeometry(...flap, 1, 0.01), COLOURS.card]], asset.uniforms));
    });
    // Hollow, as the bin: the outside and the rim, and a darker inside under the flaps. A label a little
    // proud of the card, so it doesn't flicker.
    const [outside, inside] = openBox(tub, CARTON.wall, CARTON.wall);
    this.build(flaps, toonParts([[outside, COLOURS.card], [inside, COLOURS.cardInside],
      [new PlaneGeometry(...CARTON.label), COLOURS.label, [w * 0.18, -tub[1] * 0.12, d / 2 + t]]], asset.uniforms));
  }
}

// Cereal boxes: small, flat and tall (about 40% of the bird's height), and light: a light prop, as the
// ball, so the feet and the head knock them about. A bright print: a title band and a round logo, front
// and back. A foot or the body that comes down on one from above squashes it flat for good (squash()):
// a sheet CEREAL.crush.thick thick on the ground, front up, and a thin heavy body that the bird stands
// on.
export const CEREAL = {
  mass: 0.3, friction: 0.5,
  bite: 0.1,   // a peck holds the box by its side edge, this far in the bill (grab in physics.js)
  slam: { spin: 3.0, keep: 0.5, tilt: 1.0, fast: 0.6, strong: 4, low: 0.2 },
  // thick: crushed size, units. bulge: the other sides grow this much. reach: a foot this near the top
  // counts as on it. toes: a point this far ahead of the ankle counts too. width: the toes spread this
  // far round each point. body: the bird's solid (BIRD.solid in physics.js) over the box from above
  // counts too, as a bird that lands with the box between its feet: radius, and its bottom above the feet.
  crush: { thick: 0.07, bulge: 1.12, reach: 0.04, toes: 0.25, width: 0.06, body: { radius: 0.4, bottom: 0.3 } },
  near: 2.5,   // a bird's root farther than this (in x and z) can't have a foot on the box
  prints: {
    sunny: { body: [srgb(0.98, 0.78, 0.26), srgb(0.72, 0.50, 0.40), srgb(0.32, 0.17, 0.10)], band: COLOURS.label, logo: COLOURS.lid, dot: COLOURS.label },
    berry: { body: [srgb(0.36, 0.58, 0.88), srgb(0.24, 0.35, 0.64), srgb(0.10, 0.13, 0.28)], band: COLOURS.label, logo: [srgb(0.98, 0.78, 0.26), srgb(0.72, 0.50, 0.40)], dot: COLOURS.lid },
  },
};

export class Cereal {
  static footprint({ size: [w, h, d] }) { return { half: [w / 2, d / 2], height: h }; }

  // size: [x, y, z]. print: a key of CEREAL.prints. base: the height of its bottom.
  constructor(physics, asset, { at: [x, z], size, heading = 0, print = 'sunny', base = 0 }) {
    const [w, h, d] = size, P = CEREAL.prints[print], t = 0.004;
    this.physics = physics;
    this.size = size;
    this.half = size.map(v => v / 2);   // of the body: the sheet after squash()
    this.squashed = false;
    this.slam = new Slam('cereal', this.half, CEREAL.slam);
    this.events = [];
    this.id = physics.addBox(size, {
      position: [x, base + h / 2, z], quaternion: yaw(heading),
      mass: CEREAL.mass, friction: CEREAL.friction, light: true, grab: { hold: 'flat', edge: w / 2 - CEREAL.bite },
    });
    this.rest = new Rest(physics, [this.id]);
    const parts = [[new RoundedBoxGeometry(w, h, d, 2, 0.015), P.body]];
    for (const side of [1, -1]) {
      const face = g => (side < 0 ? g.rotateY(Math.PI) : g);
      const z = side * (d / 2 + t);
      parts.push([face(new PlaneGeometry(w * 0.86, h * 0.16)), P.band, [0, h * 0.33, z]]);
      parts.push([face(new CircleGeometry(w * 0.3, 20)), P.logo, [0, -h * 0.08, z]]);
      parts.push([face(new CircleGeometry(w * 0.12, 24)), P.dot, [w * 0.06, -h * 0.05, z + side * t]]);
    }
    this.print = new Group().add(...toonParts(parts, asset.uniforms));   // the mesh: squash() scales it
    this.object = new Group().add(this.print);
    this.update();
  }

  // ibises: a foot on the top squashes the box. A box at rest still checks, as a foot can come down
  // on it before anything wakes it.
  update(ibises = []) {
    this.events = [];
    const body = this.physics.body(this.id);
    if (!this.rest.still()) {
      place(this.object, body);
      if (this.physics.held(this.id)) { this.slam.peak.spin = 0; return; }   // in a bill
      if (!this.squashed) this.events = this.slam.update(body);
    }
    if (!this.squashed && ibises.some(ibis => this.under(ibis, body))) this.squash(body);
  }

  solids() { return [{ body: this.physics.body(this.id), half: this.half }]; }

  // The outline of the box, for the highlight (highlight.js), or null.
  hull(id) {
    if (id !== this.id) return null;
    const line = this.print.children[1];
    line.updateWorldMatrix(true, false);
    return { geometry: line.geometry, matrix: line.matrixWorld };
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
    const R = ibis.rig, C = CEREAL.crush, [cx, , cz] = body.position, p = ibis.character.position;
    if (!R || Math.hypot(p.x - cx, p.z - cz) > CEREAL.near) return false;
    const { k, dir, axes } = this.up(body), centre = new Vector3().fromArray(body.position), half = this.half;
    const top = centre.y + half[k] * dir.y + C.reach;
    const on = p => {
      const height = p.dot(dir);
      return height >= 0 && height <= half[k] + C.reach && [0, 1, 2].every(i => i === k || Math.abs(p.dot(axes[i])) < half[i] + C.width);
    };
    for (const foot of [R.footL, R.footR]) for (const ahead of [0, C.toes]) {
      if (on(foot.clone().setY(foot.y - 0.05).add(new Vector3(0, 0, ahead)).applyMatrix4(ibis.object.matrixWorld).sub(centre))) return true;
    }
    const bottom = p.y + C.body.bottom;
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
    this.rest = new Rest(this.physics, [this.id]);
    this.print.scale.set(C.bulge, C.bulge, C.thick / d);
    this.half = size.map(v => v / 2);
    this.slam.half = this.half;
    this.squashed = true;
    place(this.object, this.physics.body(this.id));
    // Puffs from the four corners of the sheet.
    const points = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => (
      { at: new Vector3(a * size[0] / 2, b * size[1] / 2, 0).applyQuaternion(flat).add(centre), strength: 0.3 }));
    this.events.push({ type: 'squash', kind: 'cereal', points, centre });
  }
}

const length = ([x, y, z]) => Math.hypot(x, y, z);
// Place to world: [x, y, z] in a prop's frame at (x, 0, z), turned by heading.
function toWorld(x, z, heading) {
  const cs = Math.cos(heading), sn = Math.sin(heading);
  return ([lx, ly, lz]) => [x + lx * cs + lz * sn, ly, z - lx * sn + lz * cs];
}

// A prop at rest: still() is true when every body slept at the last update too and none is in a bill
// (a held body moves, but sleeps). Nothing moved, so there is nothing to place or check. The first
// update after the bodies sleep still runs, so a slam sees the end of a fall.
export class Rest {
  constructor(physics, ids) {
    Object.assign(this, { physics, ids, asleep: false });
  }

  still() {
    const asleep = this.ids.every(id => this.physics.body(id).sleeping && !this.physics.held(id));
    const still = asleep && this.asleep;
    this.asleep = asleep;
    return still;
  }
}

// A slam: the body spun faster than S.spin as it fell, then lost most of it (S.keep) while tipped past
// S.tilt. It keeps the fastest spin of a fall with its velocities (peak): a check of two frames in a row
// missed hits that fell in one long frame. half: half size of the box. update() gives [] or one event.
export class Slam {
  constructor(kind, half, S) {
    Object.assign(this, { kind, half, S });
    this.peak = { spin: 0, v: [0, 0, 0], w: [0, 0, 0] };
  }

  update(body, spin = length(body.motionProperties.angularVelocity)) {
    const peak = this.peak;
    if (spin > peak.spin) Object.assign(peak, { spin, v: [...body.motionProperties.linearVelocity], w: [...body.motionProperties.angularVelocity] });
    else if (spin < peak.spin * this.S.keep) {
      const hit = peak.spin > this.S.spin && tiltAngle(body.quaternion) > this.S.tilt;
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

// A rigid prop's parts as two draws: one toon mesh, with the lit and shade colours on each vertex, and
// one outline round the parts that have a line colour, with it on each vertex. All props share the two
// materials. parts: [geometry, [lit, shade, line?], at = [0, 0, 0]]: the geometry moves to at. wind:
// the parts sway (wind.js): world space geometry with aSway, and their own materials. ids: the parts
// have aSeeId, and this seeIds() uniform fades them; their own materials.
export function toonParts(parts, shared, { wind = false, ids = null } = {}) {
  const { body, line } = toonMaterials(shared, wind, ids);
  const sway = [...(wind ? ['aSway'] : []), ...(ids ? ['aSeeId'] : [])];
  const toned = parts.map(([geometry, colours, at = [0, 0, 0]]) => {
    if (colours[2]) geometry.setAttribute('_outline', smoothNormals(geometry));   // before the vertices split
    const g = (geometry.index ? geometry.toNonIndexed() : geometry).translate(...at);
    return { g: tone(g, colours), line: !!colours[2] };
  });
  const merge = (list, names) => mergeGeometries(list.map(({ g }) => {
    const out = new BufferGeometry();
    for (const name of names) out.setAttribute(name, g.getAttribute(name));
    return out;
  }));
  const mesh = new Mesh(merge(toned, ['position', 'normal', 'aLit', 'aShade', ...sway]), body);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (wind) mesh.customDepthMaterial = windDepthMaterial();
  const lined = toned.filter(t => t.line);
  return lined.length ? [mesh, new Mesh(merge(lined, ['position', '_outline', 'aLine', ...sway]), line)] : [mesh];
}

// One toon and one outline material for each set of shared uniforms, with the colours on the vertices.
// Each has a faded twin (userData.faded, and back with userData.solid) for seeInside().
const materials = new WeakMap();
function toonMaterials(shared, wind = false, ids = null) {
  if (!materials.has(shared)) materials.set(shared, new Map());
  const caches = materials.get(shared);
  if (!caches.has(ids)) caches.set(ids, {});
  const cache = caches.get(ids), key = wind;
  if (!cache[key]) {
    const none = new Color();
    const pair = make => {
      const solid = make(false), faded = make(true);
      solid.userData.faded = faded;
      faded.userData.solid = solid;
      return solid;
    };
    cache[key] = {
      body: pair(faded => toonMaterial(none, none, shared, { tones: true, faded, wind, ids })),
      line: pair(faded => outlineMaterial(none, shared, { tones: true, faded, wind, ids })),
    };
  }
  return cache[key];
}

// Fades the whole prop while the camera is in one of its solids or near it (a box, SEE.margin larger),
// as in a bin: its far walls are too far from the camera for the fade of SEE_THROUGH. eye: camera position.
export function seeInside(prop, eye) {
  const inside = prop.solids?.().some(({ body, half }) => {
    local.copy(eye).sub(at.fromArray(body.position)).applyQuaternion(turn.fromArray(body.quaternion).invert());
    return Math.abs(local.x) < half[0] + SEE.margin && Math.abs(local.y) < half[1] + SEE.margin && Math.abs(local.z) < half[2] + SEE.margin;
  }) ?? false;
  if (inside === !!prop.seeInside) return;
  prop.seeInside = inside;
  prop.object.traverse(o => {
    const next = o.material?.userData[inside ? 'faded' : 'solid'];
    if (next) o.material = next;
  });
}

const local = new Vector3(), at = new Vector3(), turn = new Quaternion();   // scratch

// Lit, shade and line colours on every vertex (aLit, aShade, aLine; black with no line), for one draw of
// many colours.
export function tone(geometry, [lit, shade, line = new Color()]) {
  const count = geometry.attributes.position.count;
  for (const [name, c] of [['aLit', lit], ['aShade', shade], ['aLine', line]]) {
    geometry.setAttribute(name, new Float32BufferAttribute(Array.from({ length: count }, () => [c.r, c.g, c.b]).flat(), 3));
  }
  return geometry;
}

// Same values as SHARED in materials.js.
const BAND = /* glsl */`
const float CONTOUR_LIT = 0.01;
const float CONTOUR_SHADE = 0.023;
const float LINE_MIN_PX = 1.0;
`;

// See-through: the props and the fence fade only where the camera is in them, so a camera in a bin or
// in the fence does not show cut open faces. Nothing fades between the camera and the player. A
// screen-door dither (4 by 4 Bayer), so the parts stay opaque and need no sort. uSee: 1 on (free play),
// 0 off. near: no fade farther than this from the camera, full fade nearer than near - soft (the camera
// near plane is 0.1). A material with FADED fades all over (seeInside()). min: the opacity of the full
// fade. margin: a whole object fades when the camera is this near it (seeInside(), seeIds()); not less
// than near, so no part of an object fades on its own. Units.
export const SEE = { near: 0.6, soft: 0.4, min: 0.3, margin: 0.6 };
export const seeOn = { value: 0 };

// One mesh of many objects (the plants, the fence posts): a material with SEE_ID gets the object of each
// vertex or instance (aSeeId), and fades all of the objects in its uniform uSeeId (up to 4; -1: none).
//
//   const see = seeIds();                       // one for each mesh, its ids from 0
//   see.update(count, i => cameraIsNear(i));    // every frame
export function seeIds() {
  const uniform = { value: new Vector4(-1, -1, -1, -1) };
  uniform.update = (count, near) => {
    let k = 0;
    for (let i = 0; i < count && k < 4; i++) if (near(i)) uniform.value.setComponent(k++, i);
    while (k < 4) uniform.value.setComponent(k++, -1);
  };
  return uniform;
}
export const SEE_VERTEX = /* glsl */`
#ifdef SEE_ID
attribute float aSeeId;
varying float vSeeId;
#define seeVertex() vSeeId = aSeeId
#else
#define seeVertex()
#endif
`;
export const SEE_THROUGH = /* glsl */`
uniform float uSee;
#ifdef SEE_ID
uniform vec4 uSeeId;
varying float vSeeId;
#endif
// Opacity at a world point: 1 away from the camera, SEE.min at the camera.
float seeThrough(vec3 p) {
#ifdef FADED
  return ${f(SEE.min)};
#endif
  if (uSee == 0.0) return 1.0;
#ifdef SEE_ID
  if (any(lessThan(abs(uSeeId - vSeeId), vec4(0.5)))) return ${f(SEE.min)};
#endif
  float near = 1.0 - smoothstep(${f(SEE.near - SEE.soft)}, ${f(SEE.near)}, distance(p, cameraPosition));
  return mix(1.0, ${f(SEE.min)}, near);
}
// True where a pixel of this opacity is not drawn.
bool seeHidden(float opacity) {
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return opacity < 1.0 && opacity * 16.0 <= BAYER[q.y * 4 + q.x];
}
`;

// The vertex position, POS: with WIND, moved by the wind (wind.js).
const WIND_VERTEX = /* glsl */`
#ifdef WIND
${WIND_SWAY}
#define POS sway(position)
#else
#define POS position
#endif
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
// several colours draw in one call. Works on an InstancedMesh. wind: the vertices sway (wind.js).
// ids: the vertices have aSeeId, and this seeIds() uniform fades them.
export function toonMaterial(lit, shade, shared, { tones = false, faded = false, wind = false, ids = null } = {}) {
  return new ShaderMaterial({
    lights: true,
    defines: { ...(tones ? { TONES: '' } : {}), ...(faded ? { FADED: '' } : {}), ...(wind ? { WIND: '' } : {}), ...(ids ? { SEE_ID: '' } : {}) },
    uniforms: { ...lightUniforms(), uSun: shared.uSun, uLit: { value: lit }, uShade: { value: shade }, uSee: seeOn, uWindTime: windTime, ...(ids ? { uSeeId: ids } : {}) },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      ${MODEL}
      ${WIND_VERTEX}
      ${SEE_VERTEX}
      varying vec3 vNormal, vWorld;
      #ifdef TONES
      attribute vec3 aLit, aShade;
      varying vec3 vLit, vShade;
      #endif
      void main() {
        mat4 m = model();
        vec4 world = m * vec4(POS, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vNormal);
        seeVertex();
        #ifdef TONES
        vLit = aLit;
        vShade = aShade;
        #endif
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      ${SEE_THROUGH}
      uniform vec3 uSun, uLit, uShade;
      varying vec3 vNormal, vWorld;
      #ifdef TONES
      varying vec3 vLit, vShade;
      #endif
      void main() {
        if (seeHidden(seeThrough(vWorld))) discard;
        vec3 n = normalize(vNormal);
        #ifdef TONES
        gl_FragColor = vec4(toonLit(vShade, vLit, toonBand(n, uSun), n), 1.0);
        #else
        gl_FragColor = vec4(toonLit(uShade, uLit, toonBand(n, uSun), n), 1.0);
        #endif
        #include <colorspace_fragment>
      }`,
  });
}

// Back faces pushed out in screen space along a smooth normal, as hullMaterial() in materials.js.
// tones: the line colour comes from the vertex attribute aLine. screen: this part of the view height
// wider than the contour line, at any distance. front: the line takes the depth
// of the front of a sphere round the object (uniform uFront: world centre, radius), not of its back
// faces, so the ground under the object does not cover it. wind: the vertices sway (wind.js). back:
// the line takes the depth of a point this many units farther from the camera, so it shows only
// against what is far behind it (no lines inside a leaf crown). ids: as toonMaterial().
export function outlineMaterial(line, shared, { tones = false, screen = 0, front = false, faded = false, wind = false, back = 0, ids = null } = {}) {
  return new ShaderMaterial({
    side: BackSide,
    defines: { ...(tones ? { TONES: '' } : {}), ...(screen ? { SCREEN: f(screen) } : {}), ...(front ? { FRONT: '' } : {}), ...(faded ? { FADED: '' } : {}), ...(wind ? { WIND: '' } : {}), ...(back ? { BACK: f(back) } : {}), ...(ids ? { SEE_ID: '' } : {}) },
    uniforms: { uSun: shared.uSun, uViewHeight: shared.uViewHeight, uLine: { value: line }, uFront: { value: new Vector4() }, uSee: seeOn, uWindTime: windTime, ...(ids ? { uSeeId: ids } : {}) },
    vertexShader: /* glsl */`
      ${BAND}
      ${MODEL}
      ${WIND_VERTEX}
      ${SEE_VERTEX}
      uniform vec3 uSun;
      uniform float uViewHeight;
      uniform vec4 uFront;
      attribute vec3 _outline;
      varying vec3 vWorld;
      #ifdef TONES
      attribute vec3 aLine;
      varying vec3 vLine;
      #endif
      void main() {
        #ifdef TONES
        vLine = aLine;
        #endif
        seeVertex();
        mat4 m = model();
        vec3 pos = POS;
        vWorld = (m * vec4(pos, 1.0)).xyz;
        vec3 worldNormal = normalize(mat3(m) * _outline);
        vec4 clip = projectionMatrix * viewMatrix * m * vec4(pos, 1.0);
        float units = mix(CONTOUR_SHADE, CONTOUR_LIT, smoothstep(-0.3, 0.6, dot(worldNormal, uSun)));
        float px = max(units * uViewHeight * projectionMatrix[1][1] / (2.0 * clip.w), LINE_MIN_PX);
        #ifdef SCREEN
        px += SCREEN * uViewHeight;
        #endif
        vec2 dir = normalize(normalize(mat3(viewMatrix) * worldNormal).xy + 1e-6);
        vec2 ndcPerPixel = 2.0 / (uViewHeight * vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0));
        clip.xy += dir * px * ndcPerPixel * clip.w;
        #ifdef FRONT
        vec4 near = projectionMatrix * viewMatrix * vec4(uFront.xyz + normalize(cameraPosition - uFront.xyz) * uFront.w, 1.0);
        clip.z = near.z / near.w * clip.w;
        #endif
        #ifdef BACK
        vec4 far = viewMatrix * m * vec4(pos, 1.0);
        far = projectionMatrix * vec4(far.xyz * (1.0 + BACK / length(far.xyz)), 1.0);
        clip.z = far.z / far.w * clip.w;
        #endif
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      ${SEE_THROUGH}
      uniform vec3 uLine;
      varying vec3 vWorld;
      #ifdef TONES
      varying vec3 vLine;
      #define uLine vLine
      #endif
      void main() {
        // No line where the part fades: it would show through the gaps of the dither.
        if (seeThrough(vWorld) < 1.0) discard;
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
