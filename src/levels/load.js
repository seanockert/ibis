// Level JSON to a Level definition. Format: docs/levels.md.
//
//   const level = new Level(buildLevel(LEVELS.suburb), { asset, birds, scene });
import { FLIERS, SPECIES } from '../characters/species.js';
import { Backdrop } from '../world/backdrop.js';
import { PROPS } from '../world/kinds.js';
import { Sky } from '../world/sky.js';
import { AREAS } from './areas.js';

// Every level in src/levels/, by file name.
export const LEVELS = Object.fromEntries(Object.entries(import.meta.glob('./*.json', { eager: true, import: 'default' })).map(([path, data]) => [path.slice(2, -5), data]));

export function buildLevel(data) {
  check(data);
  const { areas } = data;
  const owns = areas.map(a => AREAS[a.type].ground?.(a) ?? null);
  const lands = owns.slice(1).filter(Boolean);
  if (!owns[0]) throw new Error(`Level ${data.id}: the first area must have a ground`);
  if (owns[0].from !== undefined && lands.length) throw new Error(`Level ${data.id}: a land first area must be the only land`);
  const ground = joinGrounds(owns[0], lands);
  const all = key => areas.flatMap(a => a[key] ?? []);
  const gates = all('props').filter(p => p.kind === 'gate');
  const bounds = {
    x: [Math.min(...areas.map(a => a.bounds.x[0])), Math.max(...areas.map(a => a.bounds.x[1]))],
    z: [Math.min(...areas.map(a => a.bounds.z[0])), Math.max(...areas.map(a => a.bounds.z[1]))],
  };
  return {
    id: data.id,
    mission: data.mission ?? null,
    ground,
    surface: ground.print,
    under: ground.kind,
    bounds,
    scenery: ctx => [
      ...(data.sky ? [new Sky(ctx.asset.sun)] : []),
      ...areas.flatMap((a, i) => AREAS[a.type].parts(a, { ...ctx, own: owns[i], bounds: a.bounds, gates })),
      ...(data.backdrop ? [new Backdrop(bounds)] : []),
    ],
    ambience: {
      cicadas: all('plants').filter(p => p.kind === 'gum').map(p => p.at),
      mower: data.ambience?.mower,
      frogs: data.ambience?.frogs,
    },
    // Seeds come from list order.
    characters: all('characters'),
    fliers: all('fliers'),
    props: all('props'),
  };
}

// Base ground with each land over it from z = land.from. The profile stops at cut: the land has its own mesh.
function joinGrounds(base, lands) {
  if (!lands.length) return base;
  const cut = Math.min(...lands.map(l => l.from));
  const at = (x, z) => (z < cut ? base : lands.find(l => z >= l.from) ?? base);
  const profile = [[cut, base.height(0, cut)], ...base.profile.filter(([z]) => z < cut)];
  return {
    profile, cut,
    height: (x, z) => at(x, z).height(x, z),
    floor: (x, z) => { const g = at(x, z); return g.floor ? g.floor(x, z) : g.height(x, z); },
    kind: (x, z) => at(x, z).kind(x, z),
    print: (x, z) => at(x, z).print(x, z),
  };
}

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
