// Props for the play area, each a physics body (physics.js) with a toon mesh in the ibis's style: a lit
// and a shade colour split by the sun, and an inverted hull outline, wider on the shadow side.
//
//   const ball = new Ball(physics, asset, [x, z]);
//   scene.add(ball.object);
//   ball.update();   // every frame, after physics.step(dt)
//   ball.events      // this update: { type: 'slam', points: [{ at, strength }], centre } when a prop lands hard
import { BackSide, Color, CylinderGeometry, Group, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
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
  inside: [srgb(0.13, 0.22, 0.20), srgb(0.10, 0.16, 0.18)],   // the inner wall of the bin, in shadow
  deep: [srgb(0.05, 0.07, 0.09), srgb(0.05, 0.07, 0.09)],     // the bottom of the bin, out of the light
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
  lid: { height: 0.22, overhang: 0.08, mass: 0.35, open: 2.4 },   // open: how far the hinge goes, radians
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
    this.peak = { spin: 0, v: [0, 0, 0], w: [0, 0, 0] };   // fastest spin of this fall, with its velocities
    this.id = physics.addBox(tub, {
      position: world([0, tub[1] / 2, 0]), quaternion, mass: BIN.mass, friction: BIN.friction, com: BIN.com, group,
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
    part(this.tub, new RoundedBoxGeometry(...tub, 3, 0.07), COLOURS.bin, 0, 0, 0);
    // The opening under the lid: a dark rim (the inner wall) round a darker square (the depth). Flat on
    // the top of the tub; the closed lid covers it.
    const opening = (inset, colours, up) => part(this.tub, new PlaneGeometry(w - 2 * inset, d - 2 * inset).rotateX(-Math.PI / 2), colours, 0, tub[1] / 2 + up, 0);
    opening(0.09, COLOURS.inside, 0.003);
    opening(0.2, COLOURS.deep, 0.006);
    part(this.tub, new RoundedBoxGeometry(w * 0.7, 0.1, 0.12, 2, 0.04), COLOURS.bin, 0, tub[1] / 2 - 0.12, -d / 2 - 0.06);
    const wheel = new CylinderGeometry(0.24, 0.24, 0.14, 20).rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) part(this.tub, wheel, COLOURS.wheel, s * (w / 2 - 0.12), -tub[1] / 2 + 0.24, -d / 2);
    part(this.lid, new RoundedBoxGeometry(...lid, 3, 0.06), COLOURS.lid, 0, 0, 0);
    this.update();
  }

  update() {
    const tub = this.physics.body(this.id);
    place(this.tub, tub);
    place(this.lid, this.physics.body(this.lidId));
    // Tilt from the quaternion: the angle between the tub's up and the world's up.
    const [qx, , qz] = tub.quaternion, tilt = Math.acos(Math.min(1, Math.max(-1, 1 - 2 * (qx * qx + qz * qz))));
    const spin = Math.hypot(...tub.motionProperties.angularVelocity);
    this.physics.hingeTo(this.hinge, -Math.min(BIN.flap.tilt * tilt + BIN.flap.spin * spin, BIN.lid.open));
    this.events = [];
    const S = BIN.slam;
    const peak = this.peak;
    if (spin > peak.spin) Object.assign(peak, { spin, v: [...tub.motionProperties.linearVelocity], w: [...tub.motionProperties.angularVelocity] });
    else if (spin < peak.spin * S.keep) {
      if (peak.spin > S.spin && tilt > S.tilt) this.slam(tub);
      peak.spin = spin;
    }
  }

  // Dust points along the edges of the tub that lie on the ground, where they hit fast. The speed of a
  // point is v + w x r, with the velocities at the fastest spin of the fall.
  slam(tub) {
    const q = new Quaternion().fromArray(tub.quaternion), centre = new Vector3().fromArray(tub.position);
    // Corner i has signs from its bits. An edge joins two corners that differ in one bit.
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new Vector3(...this.half.map((h, k) => (i >> k & 1 ? h : -h)))
      .applyQuaternion(q).add(centre));
    const points = [], low = Math.min(...corners.map(p => p.y)) + BIN.slam.low;
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
      const j = i | bit;
      if (j === i || corners[i].y > low || corners[j].y > low) continue;
      for (let t = 0; t <= 1; t += 0.125) points.push(corners[i].clone().lerp(corners[j], t));
    }
    const com = new Vector3().fromArray(tub.centerOfMassPosition), v = new Vector3().fromArray(this.peak.v), w = new Vector3().fromArray(this.peak.w);
    const speeds = points.map(p => new Vector3().crossVectors(w, p.clone().sub(com)).add(v).length());
    const top = Math.max(...speeds), S = BIN.slam;
    const hits = points
      .map((p, i) => ({ at: p.setY(0.05), strength: Math.min(speeds[i] / S.strong, 1), fast: speeds[i] >= top * S.fast }))
      .filter(h => h.fast);
    this.events.push({ type: 'slam', points: hits, centre });
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

// The toon mesh, and with a line colour, its outline.
function toon(geometry, [lit, shade, line], shared) {
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

function toonMaterial(lit, shade, shared) {
  return new ShaderMaterial({
    lights: true,
    uniforms: { ...lightUniforms(), uSun: shared.uSun, uLit: { value: lit }, uShade: { value: shade } },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        toonShadowCoord(modelMatrix * vec4(position, 1.0), vNormal);
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      uniform vec3 uSun, uLit, uShade;
      varying vec3 vNormal;
      void main() {
        float band = toonBand(normalize(vNormal), uSun);
        gl_FragColor = vec4(mix(uShade, uLit, band), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Back faces pushed out in screen space along a smooth normal, as hullMaterial() in materials.js.
function outlineMaterial(line, shared) {
  return new ShaderMaterial({
    side: BackSide,
    uniforms: { uSun: shared.uSun, uViewHeight: shared.uViewHeight, uLine: { value: line } },
    vertexShader: /* glsl */`
      ${BAND}
      uniform vec3 uSun;
      uniform float uViewHeight;
      attribute vec3 _outline;
      void main() {
        vec3 worldNormal = normalize(mat3(modelMatrix) * _outline);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
function smoothNormals(geometry) {
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
