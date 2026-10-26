// Character species for level data (src/levels/): the name in a level to a maker (asset, seed). Each
// character has object, character (src/ibis/motion/character.js) and update(dt). Only the ibis for now.
import { Ibis } from '../ibis/Ibis.js';

export const SPECIES = { ibis: (asset, seed) => new Ibis(asset, { seed }) };
