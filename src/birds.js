// The birds by name, for the bird URL parameter of sdf.html, index.html and the bake.
import { IBIS } from './ibis/bird.js';
import { MINER } from './miner/bird.js';

export const BIRDS = { ibis: IBIS, miner: MINER };

// The bird of the page: ?bird=miner, or the ibis.
export const pageBird = (search = location.search) => BIRDS[new URLSearchParams(search).get('bird')] ?? IBIS;
