// Character species for level data (src/levels/): the name in a level to a maker (birds, seed). birds: the
// bird assets by species (loadIbis()). Each character has object, character (src/ibis/motion/character.js)
// and update(dt). The miner on the ground uses the ibis motion for now, so it only stands: it has no brain.
// FLIERS: the same for birds in the air (src/miner/flier.js), with the options of their Flight.
import { Ibis } from '../ibis/Ibis.js';
import { MINER_SCALE } from '../miner/bird.js';
import { Flier } from '../miner/flier.js';

export const SPECIES = {
  ibis: (birds, seed) => new Ibis(birds.ibis, { seed }),
  miner: (birds, seed) => new Ibis(birds.miner, { seed, scale: MINER_SCALE }),
};

export const FLIERS = { miner: (birds, seed, flight) => new Flier(birds.miner, { seed, ...flight }) };
