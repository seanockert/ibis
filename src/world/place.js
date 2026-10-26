// Placement of props in a level: the height of each prop's bottom (base), so that no prop starts in the
// ground or in another prop. Two dynamic bodies that start inside each other stick together.
//
//   const bases = stack(defs, def => PROPS[def.kind].footprint(def), ground.height);
//
// A prop stands on the highest thing under its footprint: the ground, or the top of a prop before it
// in the list. So two props at the same place stack, and a prop must come after what it stands on.
// The footprint is a rectangle turned by the heading, as the prop.

const GAP = 0.002;   // between a prop and what it stands on, so they don't start in contact
const SAMPLE = 0.25;   // the ground is sampled at most this far apart under a footprint

// defs: [{ at: [x, z], heading }]. footprint(def): { half: [x, z], height, centre: [x, z] }, centre
// from at in the prop's frame. height(x, z): the ground. Gives the base of each def.
export function stack(defs, footprint, height) {
  const placed = [];
  return defs.map(def => {
    const f = footprint(def), rect = rectangle(def, f);
    let base = groundUnder(rect, height);
    for (const p of placed) if (overlap(rect, p.rect)) base = Math.max(base, p.top + GAP);
    placed.push({ rect, top: base + f.height });
    return base;
  });
}

// World rectangle: centre, half size and the unit axes of its local x and z.
function rectangle({ at: [x, z], heading = 0 }, { half, centre: [cx, cz] = [0, 0] }) {
  const cs = Math.cos(heading), sn = Math.sin(heading);
  return { c: [x + cx * cs + cz * sn, z - cx * sn + cz * cs], half, axes: [[cs, -sn], [sn, cs]] };
}

// The highest ground under the rectangle, on a grid of points.
function groundUnder({ c, half, axes: [ax, az] }, height) {
  const n = half.map(h => Math.ceil(2 * h / SAMPLE));
  let top = -Infinity;
  for (let i = 0; i <= n[0]; i++) for (let j = 0; j <= n[1]; j++) {
    const u = (2 * i / n[0] - 1) * half[0], v = (2 * j / n[1] - 1) * half[1];
    top = Math.max(top, height(c[0] + u * ax[0] + v * az[0], c[1] + u * ax[1] + v * az[1]));
  }
  return top;
}

// Separating axis test of two turned rectangles.
function overlap(a, b) {
  const d = [b.c[0] - a.c[0], b.c[1] - a.c[1]];
  const reach = (r, axis) => r.half[0] * Math.abs(dot(r.axes[0], axis)) + r.half[1] * Math.abs(dot(r.axes[1], axis));
  return [...a.axes, ...b.axes].every(axis => Math.abs(dot(d, axis)) < reach(a, axis) + reach(b, axis));
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
