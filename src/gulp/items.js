// Toss and gulp: the things the ibis catches and swallows. Each has a toon mesh in the ibis's style
// (toonParts() in src/world/props.js) and the numbers the game needs.
//
// Item space is the hold of physics.js: x out of the bill (the middle of the item sits edge out along it),
// y across the bill, z across the gap of the bill (the thickness that the bill opens round).
//
// Fields:
//   radius    bounding sphere, units: hits on the bird and the ground
//   jaw       bill opening while the bill holds it
//   edge      the middle of the item sits this far out of the bill (a big item is held by its edge)
//   catches   catches before the ibis can swallow it
//   value     points for a swallow
//   lump      [radius, length]: the lump in the head and the neck as it goes down
//   fill      how much fuller the belly gets
//   air       part of the normal time in the air after a toss (heavy things fall sooner)
//   flutter   side wobble in the air, units per second (it ends where it would have)
//   spin      turn speed in the air, radians per second
//   burp      a burp after the swallow
//   from      swallows before it can come
//   chance    weight when the game picks the next item
import { CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hash } from '../ibis/motion/spring.js';
import { toonParts } from '../world/props.js';
import { srgb } from '../world/util.js';

// lit, shade, line. The shades lean cool, as in paletteSrgb() in model.glsl.
const C = {
  chip: [srgb(0.98, 0.80, 0.38), srgb(0.80, 0.56, 0.36), srgb(0.45, 0.27, 0.10)],
  pastry: [srgb(0.95, 0.72, 0.42), srgb(0.74, 0.50, 0.38), srgb(0.42, 0.24, 0.12)],
  meat: [srgb(0.62, 0.34, 0.26), srgb(0.44, 0.22, 0.24)],
  sauce: [srgb(0.86, 0.18, 0.14), srgb(0.62, 0.10, 0.16), srgb(0.36, 0.05, 0.06)],
  choc: [srgb(0.46, 0.28, 0.20), srgb(0.32, 0.19, 0.20), srgb(0.18, 0.09, 0.06)],
  coconut: [srgb(0.98, 0.96, 0.92), srgb(0.80, 0.80, 0.86)],
  sole: [srgb(0.22, 0.56, 0.86), srgb(0.16, 0.38, 0.66), srgb(0.06, 0.15, 0.30)],
  strap: [srgb(0.96, 0.82, 0.22), srgb(0.76, 0.58, 0.18), srgb(0.38, 0.27, 0.05)],
  coat: [srgb(0.26, 0.46, 0.80), srgb(0.18, 0.30, 0.60), srgb(0.07, 0.12, 0.28)],
  hat: [srgb(0.88, 0.22, 0.20), srgb(0.62, 0.13, 0.20), srgb(0.32, 0.06, 0.08)],
  beard: [srgb(0.98, 0.97, 0.94), srgb(0.80, 0.80, 0.88), srgb(0.40, 0.40, 0.48)],
  skin: [srgb(0.98, 0.76, 0.62), srgb(0.80, 0.56, 0.52)],
  boot: [srgb(0.30, 0.22, 0.20), srgb(0.20, 0.14, 0.16)],
};

export const ITEMS = {
  chip: {
    name: 'Hot chip', radius: 0.2, jaw: 0.2, edge: 0, catches: 1, value: 10, lump: [0.08, 0.12], fill: 0.05,
    air: 1, flutter: 0, spin: 9, burp: false, from: 0, chance: 3,
    parts: () => [[new RoundedBoxGeometry(0.1, 0.38, 0.1, 2, 0.03), C.chip]],
  },
  roll: {
    name: 'Sausage roll', radius: 0.32, jaw: 0.42, edge: 0, catches: 2, value: 30, lump: [0.13, 0.28], fill: 0.12,
    air: 1, flutter: 0, spin: 6, burp: false, from: 1, chance: 3,
    parts: () => [
      [new CapsuleGeometry(0.12, 0.34, 4, 12).scale(1, 1, 0.9), C.pastry],
      [new SphereGeometry(0.095, 10, 8).scale(1, 0.4, 0.9), C.meat, [0, 0.27, 0]],
      [new SphereGeometry(0.095, 10, 8).scale(1, 0.4, 0.9), C.meat, [0, -0.27, 0]],
    ],
  },
  lamington: {
    name: 'Lamington', radius: 0.24, jaw: 0.5, edge: 0.04, catches: 2, value: 30, lump: [0.16, 0.12], fill: 0.12,
    air: 1, flutter: 0, spin: 7, burp: false, from: 2, chance: 2,
    parts: () => [
      [new RoundedBoxGeometry(0.28, 0.28, 0.28, 2, 0.05), C.choc],
      ...Array.from({ length: 22 }, (_, i) => {
        // Flakes of coconut on the faces.
        const face = i % 6, u = hash(i * 3 + 1) - 0.5, v = hash(i * 3 + 2) - 0.5, axis = face >> 1, s = face & 1 ? 1 : -1;
        const at = [0, 0, 0];
        at[axis] = 0.142 * s;
        at[(axis + 1) % 3] = 0.22 * u;
        at[(axis + 2) % 3] = 0.22 * v;
        return [new SphereGeometry(0.018, 5, 4), C.coconut, at];
      }),
    ],
  },
  pie: {
    name: 'Meat pie', radius: 0.3, jaw: 0.3, edge: 0.14, catches: 3, value: 50, lump: [0.22, 0.06], fill: 0.2,
    air: 1, flutter: 0.6, spin: 4, burp: true, from: 4, chance: 2,
    parts: () => [
      [new CylinderGeometry(0.25, 0.21, 0.13, 20).rotateX(Math.PI / 2), C.pastry],
      [new SphereGeometry(0.09, 12, 8).scale(1, 1, 0.45), C.sauce, [0.02, -0.03, 0.07]],
    ],
  },
  thong: {
    name: 'Thong', radius: 0.34, jaw: 0.16, edge: 0.06, catches: 3, value: 60, lump: [0.12, 0.4], fill: 0.1,
    air: 1.1, flutter: 1.4, spin: 11, burp: true, from: 6, chance: 1.5,
    parts: () => [
      [new RoundedBoxGeometry(0.22, 0.62, 0.05, 2, 0.02).scale(1, 1, 1), C.sole],
      [new CapsuleGeometry(0.018, 0.2, 2, 6).rotateZ(1.0).rotateY(0.5), C.strap, [0.05, 0.13, 0.06]],
      [new CapsuleGeometry(0.018, 0.2, 2, 6).rotateZ(-1.0).rotateY(0.5), C.strap, [-0.05, 0.13, 0.06]],
      [new SphereGeometry(0.025, 6, 5), C.strap, [0, 0.2, 0.05]],
    ],
  },
  gnome: {
    // Held by the tip of its hat.
    name: 'Garden gnome', radius: 0.42, jaw: 0.24, edge: 0.34, catches: 4, value: 120, lump: [0.22, 0.36], fill: 0.35,
    air: 0.85, flutter: 0, spin: 5, burp: true, from: 8, chance: 1,
    parts: () => [
      [new ConeGeometry(0.12, 0.26, 12).rotateZ(Math.PI / 2), C.hat, [-0.2, 0, 0]],
      [new SphereGeometry(0.085, 12, 10), C.skin, [-0.04, 0, 0]],
      [new ConeGeometry(0.09, 0.18, 10).rotateZ(-Math.PI / 2), C.beard, [0.05, 0, 0.05]],
      [new CylinderGeometry(0.11, 0.15, 0.24, 12).rotateZ(Math.PI / 2), C.coat, [0.1, 0, 0]],
      [new SphereGeometry(0.05, 8, 6), C.boot, [0.24, 0.06, 0.02]],
      [new SphereGeometry(0.05, 8, 6), C.boot, [0.24, -0.06, 0.02]],
    ],
  },
};

// A new mesh of an item: one toon draw and one outline draw.
export function itemMesh(def, uniforms) {
  return new Group().add(...toonParts(def.parts(), uniforms));
}
