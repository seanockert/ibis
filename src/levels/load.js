// Level data (JSON) to the level definition that Level (src/world/level.js) takes.
//
//   import SUBURB from './suburb.json';
//   const level = new Level(buildLevel(SUBURB), { asset, birds, scene });
//
// The format is in docs/levels.md. A "note" key anywhere is a comment: the loader ignores it.
import { FLIERS, SPECIES } from '../characters/species.js';
import { Backdrop } from '../world/backdrop.js';
import { PROPS } from '../world/kinds.js';
import { inPuddle, PUDDLE } from '../world/puddle.js';
import { Sky } from '../world/sky.js';
import { AREAS } from './areas.js';

export function buildLevel(data) {
  check(data);
  const { areas } = data;
  // The first area's ground is the level's ground.
  if (!AREAS[areas[0].type].ground) throw new Error(`Level ${data.id}: the first area must have a ground`);
  const ground = AREAS[areas[0].type].ground(areas[0]);
  const puddle = areas.some(a => a.puddle);
  const all = key => areas.flatMap(a => a[key] ?? []);
  const gates = all('props').filter(p => p.kind === 'gate');
  return {
    id: data.id,
    ground,
    // What a foot prints on (fx), and what it is on, for the sound of a step. None in the puddle.
    surface: (x, z) => (puddle && inPuddle(x, z) ? false : ground.print(x, z)),
    under: (x, z) => (puddle && inPuddle(x, z) ? 'puddle' : ground.kind(x, z)),
    // The box round all areas: the characters stay in it. Walls (the fence) keep them in an area.
    bounds: {
      x: [Math.min(...areas.map(a => a.bounds.x[0])), Math.max(...areas.map(a => a.bounds.x[1]))],
      z: [Math.min(...areas.map(a => a.bounds.z[0])), Math.max(...areas.map(a => a.bounds.z[1]))],
    },
    scenery: ctx => [
      ...(data.sky ? [new Sky(ctx.asset.sun)] : []),
      ...areas.flatMap(a => AREAS[a.type].parts(a, { ...ctx, bounds: a.bounds, gates })),
      ...(data.backdrop ? [new Backdrop()] : []),
    ],
    puddle,
    // Background sounds (ambience.js): cicadas in the gums, the mower, frogs at the puddle.
    ambience: {
      cicadas: all('plants').filter(p => p.kind === 'gum').map(p => p.at),
      mower: data.ambience?.mower,
      frogs: puddle ? PUDDLE.at : undefined,
    },
    // Seeds come from the place in these lists, so the order of the areas matters.
    characters: all('characters'),
    fliers: all('fliers'),
    props: all('props'),
  };
}

// Throws on a name that has no type, kind or species, with the path to it.
function check({ id, areas }) {
  const fail = (path, message) => { throw new Error(`Level ${id}: ${path}: ${message}`); };
  if (!areas?.length) fail('areas', 'no areas');
  areas.forEach((a, i) => {
    const at = `areas[${i}] (${a.id})`;
    if (!AREAS[a.type]) fail(at, `unknown type "${a.type}"`);
    if (!a.bounds) fail(at, 'no bounds');
    (a.props ?? []).forEach((p, j) => PROPS[p.kind] || fail(`${at}.props[${j}]`, `unknown kind "${p.kind}"`));
    (a.characters ?? []).forEach((c, j) => SPECIES[c.species] || fail(`${at}.characters[${j}]`, `unknown species "${c.species}"`));
    (a.fliers ?? []).forEach((c, j) => FLIERS[c.species] || fail(`${at}.fliers[${j}]`, `unknown species "${c.species}"`));
  });
}
