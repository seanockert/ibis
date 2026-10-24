// Test ground for the foot placement (animator.js): steps up to a top and a ramp down. The street has a
// kerb of its own (street.js).
// Walls higher than GROUND.stepUp (the sides of the top) stop the bird, and a drop farther than
// GROUND.stepDown is a fall. Each piece is a prism, a profile in x and y along z: a static convex hull
// in physics.js and a toon mesh, as the props.
//
//   const terrain = new Terrain(physics, asset);
//   scene.add(terrain.object);
import { ExtrudeGeometry, Group, Shape } from 'three';
import { toonParts } from './props.js';
import { srgb } from './util.js';

const STONE = [srgb(0.86, 0.80, 0.72), srgb(0.66, 0.62, 0.74), srgb(0.25, 0.22, 0.30)];   // lit, shade, line

// profile: [x, y] corners, counter-clockwise. z: [from, to]. World units: the bird is 2 tall.
export const COURSE = [
  { profile: [[3, 0], [4, 0], [4, 0.15], [3, 0.15]], z: [-1, 1.4] },
  { profile: [[4, 0], [5, 0], [5, 0.3], [4, 0.3]], z: [-1, 1.4] },
  { profile: [[5, 0], [7, 0], [7, 0.45], [5, 0.45]], z: [-1, 1.4] },
  { profile: [[7, 0], [9, 0], [7, 0.45]], z: [-1, 1.4] },            // ramp, about 13 degrees
];

export class Terrain {
  constructor(physics, asset, pieces = COURSE) {
    const parts = pieces.map(({ profile, z: [z0, z1] }) => {
      physics.addTerrain(profile.flatMap(([x, y]) => [x, y, z0, x, y, z1]));
      return [new ExtrudeGeometry(new Shape(profile.map(([x, y]) => ({ x, y }))), { depth: z1 - z0, bevelEnabled: false }), STONE, [0, 0, z0]];
    });
    this.object = new Group().add(...toonParts(parts, asset.uniforms));
  }
}
