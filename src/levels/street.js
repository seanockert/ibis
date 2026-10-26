// The street: an Australian suburban street, the free play level. Level data for Level (src/world/level.js).
//
// ground: profile (heights across z, for the physics) and height(x, z). surface(x, z): what a foot
// prints on (fx). bounds: the box the characters stay in. scenery(asset, physics): the parts with
// update(camera, dt, ibises, solids), or none. puddle: a muddy puddle (puddle.js).
// characters: species (species.js), at [x, z], heading, player (the one the input drives) or brain
// ('wander', wander.js).
// fliers: species (FLIERS in species.js) and the options of their Flight (src/miner/flight.js): height
// and radius of the circle over the player, where on it they start (angle) and which way round (dir).
// They dive at the player's head (swoop.js).
// props: kind (kinds.js), at [x, z], heading, and the options of the kind. The height comes from
// place.js: a prop stands on the ground or on a prop before it in the list. Two props at the same place
// stack.
import { Backdrop } from '../world/backdrop.js';
import { Fence } from '../world/fence.js';
import { inPuddle } from '../world/puddle.js';
import { Sky } from '../world/sky.js';
import { PLAY, printOn, PROFILE, Street, streetHeight } from '../world/street.js';
import { Tufts } from '../world/tufts.js';

export const STREET = {
  ground: { profile: PROFILE, height: (x, z) => streetHeight(z) },
  surface: (x, z) => (inPuddle(x, z) ? false : printOn(x, z)),   // pressed grass, dust; none in the puddle
  bounds: PLAY,
  // The sky, the ground, the tufts, the trees, and a white post and wire fence round the play area.
  scenery: (asset, physics) => [new Sky(asset.sun), new Street(asset.sun), new Tufts(), new Backdrop(), new Fence(asset, physics)],
  puddle: true,

  characters: [
    { species: 'ibis', at: [0, 0], heading: 0, player: true },
  ],

  // Three noisy miners in the sky over the player.
  fliers: [
    { species: 'miner', height: 4.5, radius: 6, angle: 0, dir: 1 },
    { species: 'miner', height: 5.2, radius: 7.5, angle: 2.1, dir: 1 },
    { species: 'miner', height: 3.9, radius: 5, angle: 4.2, dir: -1 },
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
