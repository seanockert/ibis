// Area types: ground(area) and parts(area, ctx). Format: docs/levels.md.
import { hash } from '../ibis/motion/spring.js';
import { Clover } from '../world/clover.js';
import { Fence } from '../world/fence.js';
import { Field, Land, wildTufts } from '../world/land.js';
import { Lamps } from '../world/lamps.js';
import { Plants } from '../world/plants.js';
import { Street, STREET_GROUND } from '../world/street.js';
import { Tufts } from '../world/tufts.js';

// Mulch bed radius. A plant's bed overrides it.
const BEDS = { gum: 2.6, bottlebrush: 2.0 };
// Worn grass under a land tree: radius, wear.
const SHADE = { gum: [4.5, 0.7], bottlebrush: [3, 0.6] };

export const AREAS = {
  street: {
    ground: () => STREET_GROUND,
    parts({ fences = [], plants = [], lamps = [], clover = [] }, { asset, physics, ground, bounds, gates }) {
      const beds = plants.filter(p => p.bed ?? BEDS[p.kind]).map(p => ({ at: p.at, radius: p.bed ?? BEDS[p.kind] }));
      const fence = new Fence(asset, physics, { runs: fences, gates, ground }), cut = ground.cut ?? Infinity;
      return [
        new Street(asset.sun, beds, ground.profile),
        new Tufts({ ground, beds, poles: lamps.map(l => l.at), posts: fence.posts, clear: clearOf(clover, gates), keep: (x, z) => z < cut }),
        ...(clover.length ? [new Clover(asset, clover, ground)] : []),
        fence,
        new Plants(asset, physics, plants, { ground, bounds }),
        new Lamps(asset, physics, lamps, { ground }),
      ];
    },
  },
  land: {
    ground: area => new Field({ ...area, features: [...(area.features ?? []), ...shade(area)] }),
    parts(area, { asset, physics, ground, own, bounds, gates }) {
      const { fences = [], plants = [], clover = [] } = area;
      return [
        new Land(asset.sun, own, physics, { base: own === ground }),
        new Tufts({ ground, tufts: wildTufts(own, clearOf(clover, gates)) }),
        ...(clover.length ? [new Clover(asset, clover, ground)] : []),
        ...(fences.length ? [new Fence(asset, physics, { runs: fences, gates, ground })] : []),
        // No row plants in the gully.
        new Plants(asset, physics, [...plants, ...rowsOf(area).filter(({ at }) => own.height(...at) > -0.15 && own.surface(...at)[1] < 0.2)], { ground, bounds }),
      ];
    },
  },
};

// No tufts in the clover or where a gate swings.
const clearOf = (clover, gates) => [...clover, ...gates.map(g => ({ at: g.at, radius: g.width / 2 }))];

// An area's row plants, made once.
const rows = new WeakMap();
const rowsOf = area => rows.get(area) ?? rows.set(area, plantRows(area.rows ?? [])).get(area);

function shade(area) {
  const { box } = area;
  return [...(area.plants ?? []), ...rowsOf(area)].filter(p => SHADE[p.kind] && p.at[0] > box.x[0] && p.at[0] < box.x[1] && p.at[1] > box.z[0] && p.at[1] < box.z[1])
    .map(p => ({ type: 'shade', at: p.at, radius: SHADE[p.kind][0], wear: SHADE[p.kind][1] }));
}

// { from, to, every, kinds, jitter, seed } to plants. A kind: a name or plant options.
export function plantRows(rows) {
  return rows.flatMap(({ from, to, every, kinds, jitter = 0, seed = 1 }) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.max(1, Math.round(len / every));
    let k = seed * 7919;
    const r = () => hash(k++);
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n, pick = kinds[Math.floor(r() * kinds.length)];
      return { ...(typeof pick === 'string' ? { kind: pick } : pick), at: [from[0] + (to[0] - from[0]) * t + jitter * (2 * r() - 1), from[1] + (to[1] - from[1]) * t + jitter * (2 * r() - 1)], seed: seed * 101 + i };
    });
  });
}
