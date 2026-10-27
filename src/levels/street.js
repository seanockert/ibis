// The street: an Australian suburban street, the free play level. Level data for Level (src/world/level.js).
//
// ground: profile (heights across z, for the physics) and height(x, z). surface(x, z): what a foot
// prints on (fx). bounds: the box the characters stay in. scenery(asset, physics): the parts with
// update(camera, dt, ibises, solids), or none. puddle: a muddy puddle (puddle.js).
// characters: species (species.js), at [x, z], heading, player (the one the input drives) or brain
// ('wander', wander.js).
// fliers: species (FLIERS in species.js), home [x, z] (each sits on the highest perch near it and guards
// it, sentry.js) and the options of their Flight (src/miner/flight.js): height and radius of the circle
// over the player when they attack, and which way round (dir).
// props: kind (kinds.js), at [x, z], heading, and the options of the kind. The height comes from
// place.js: a prop stands on the ground or on a prop before it in the list. Two props at the same place
// stack.
import { Backdrop } from '../world/backdrop.js';
import { Fence } from '../world/fence.js';
import { Plants } from '../world/plants.js';
import { inPuddle } from '../world/puddle.js';
import { Sky } from '../world/sky.js';
import { PLAY, printOn, PROFILE, Street, streetHeight } from '../world/street.js';
import { Tufts } from '../world/tufts.js';

// Trees and shrubs (plants.js). Most in the far yards, behind the fence (z -27.1), in front of the
// backdrop (z -42): gums at the back, bottlebrushes between them, shrubs along the fence. One street
// tree on the near nature strip, down the street from the start, with a solid trunk and a miner on its perch branch,
// and three shrubs on the same strip at the end of the play area.
const PLANTED = [
  { kind: 'bottlebrush', at: [20, 1.6], perch: [-1, -0.6] },
  { kind: 'gum', at: [-21, -36] },
  { kind: 'gum', at: [15, -37] },
  { kind: 'gum', at: [40, -35] },
  { kind: 'bottlebrush', at: [-4, -32] },
  { kind: 'bottlebrush', at: [27, -31.5] },
  { kind: 'bottlebrush', at: [-36, -32] },
  { kind: 'shrub', at: [-14, -29], flowers: 'yellow' },
  { kind: 'shrub', at: [-11.5, -29.6] },
  { kind: 'shrub', at: [4, -29] },
  { kind: 'shrub', at: [9, -29.4], flowers: 'pink' },
  { kind: 'shrub', at: [19, -29] },
  { kind: 'shrub', at: [32, -29.2], flowers: 'yellow' },
  { kind: 'shrub', at: [-28, -29.3], flowers: 'pink' },
  { kind: 'shrub', at: [-42, -29] },
  { kind: 'shrub', at: [40, 0.8] },
  { kind: 'shrub', at: [42.8, -1.2], flowers: 'yellow' },
  { kind: 'shrub', at: [45.3, 1] },
];

export const STREET = {
  ground: { profile: PROFILE, height: (x, z) => streetHeight(z) },
  surface: (x, z) => (inPuddle(x, z) ? false : printOn(x, z)),   // pressed grass, dust; none in the puddle
  bounds: PLAY,
  // The sky, the ground, the tufts, the far trees, a white post and wire fence round the play area, and
  // the trees and shrubs in the yards.
  scenery: (asset, physics) => [new Sky(asset.sun), new Street(asset.sun), new Tufts(), new Backdrop(), new Fence(asset, physics), new Plants(asset, physics, PLANTED)],
  puddle: true,

  characters: [
    { species: 'ibis', at: [0, 0], heading: 0, player: true },
  ],

  // Three noisy miners on the posts of the far fence, in front of the free play camera: two guard the
  // part behind the small bin, one the part behind the stack of boxes. One on the perch branch of the
  // street tree: no post is near it.
  fliers: [
    { species: 'miner', home: [-10, -27], height: 4.5, radius: 5, dir: 1 },
    { species: 'miner', home: [-10, -27], height: 4, radius: 4, dir: -1 },
    { species: 'miner', home: [12, -27], height: 4.5, radius: 5, dir: 1 },
    { species: 'miner', home: [20, 1.6], height: 4.5, radius: 5, dir: -1 },
  ],

  props: [
    // The football on the nature strip, for the feet and the head.
    { kind: 'ball', at: [1.4, 1.3], heading: 0.7 },
    // Wheelie bins: one on the near nature strip, two on the far one.
    { kind: 'bin', at: [-10, -1], heading: -2.5 },
    { kind: 'bin', at: [-9, -19.7], heading: 0.2, small: true, lid: 'yellow' },
    { kind: 'bin', at: [10, -20], heading: -0.3 },
    // Cardboard boxes, 60 to 70% of the bird's height: two on the nature strip, one on the footpath.
    { kind: 'box', at: [-3.6, 1.2], size: [1.25, 1.3, 1.1], heading: 0.3 },
    { kind: 'box', at: [-5.6, -0.3], size: [1.0, 1.2, 1.0], heading: -0.5 },
    { kind: 'box', at: [-4.2, 4.2], size: [1.3, 1.4, 1.05], heading: 0.1 },
    // A stack on the far nature strip: two boxes, a cereal box on top.
    { kind: 'box', at: [7, -20], size: [1.3, 1.4, 1.05], heading: 0.1 },
    { kind: 'box', at: [7.1, -19.7], size: [1.5, 0.8, 0.8], heading: 0.4 },
    { kind: 'cereal', at: [7, -20], size: [0.52, 0.74, 0.18], heading: 0.5, print: 'berry' },
    // Cereal boxes on the footpath.
    { kind: 'cereal', at: [-2.4, 4.6], size: [0.6, 0.86, 0.2], heading: -0.4, print: 'sunny' },
    { kind: 'cereal', at: [-1.6, 3.9], size: [0.52, 0.74, 0.18], heading: 0.5, print: 'berry' },
    // Stubbies as bowling pins on the road, in the near lane: kick the football down off the kerb at them.
    { kind: 'stubbies', at: [1.8, -6.2] },
  ],
};
