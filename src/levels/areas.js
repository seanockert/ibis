// Area types for level data (src/levels/*.json): the type of an area to its ground and its scenery.
// Each type: ground(area), the ground under the area (level.js: profile, height, kind, print), and
// parts(area, ctx), the scenery of the area. ctx: { asset, physics, ground, bounds, gates }. gates: the
// gate props of all areas ({ at, width }): a gap in a fence run that one lies on.
import { Clover } from '../world/clover.js';
import { Fence, fencePosts, fenceRuns } from '../world/fence.js';
import { Lamps } from '../world/lamps.js';
import { Plants } from '../world/plants.js';
import { Street, STREET_GROUND } from '../world/street.js';
import { Tufts } from '../world/tufts.js';

// Mulch bed radius round the foot of each tree (street.js); shrubs have none. A plant's bed overrides it.
const BEDS = { gum: 2.6, bottlebrush: 2.0 };

export const AREAS = {
  // The street (street.js): strips along x. fences: [[x, z], [x, z]] runs. plants, lamps, clover: lists
  // of the options of Plants, Lamps and Clover. The tufts grow round the lamps and the fence posts, and
  // not in the beds or the clover.
  street: {
    ground: () => STREET_GROUND,
    parts({ fences = [], plants = [], lamps = [], clover = [] }, { asset, physics, ground, bounds, gates }) {
      const beds = plants.filter(p => p.bed ?? BEDS[p.kind]).map(p => ({ at: p.at, radius: p.bed ?? BEDS[p.kind] }));
      // No tufts where a gate swings.
      const clear = [...clover, ...gates.map(g => ({ at: g.at, radius: g.width / 2 }))];
      return [
        new Street(asset.sun, beds),
        new Tufts({ ground, beds, poles: lamps.map(l => l.at), posts: fencePosts(fenceRuns(fences, ground, gates)), clear }),
        new Clover(asset, clover, ground),
        new Fence(asset, physics, { runs: fences, gates, ground }),
        new Plants(asset, physics, plants, { ground, bounds }),
        new Lamps(asset, physics, lamps, { ground }),
      ];
    },
  },
  // Open ground: an area with no ground of its own (the first area's ground goes on under it), only
  // fences. A place to walk into, until it gets its own ground.
  open: {
    ground: null,
    parts: ({ fences = [] }, { asset, physics, ground, gates }) => [new Fence(asset, physics, { runs: fences, gates, ground })],
  },
};
