// Land: hills, gullies, worn grass, dirt and mud. Owns all ground at z >= box.z[0]. See docs/land.md.
//
//   const field = new Field(area);   // from area.box and area.features
//   field.height(x, z)   // drawn ground
//   field.floor(x, z)    // physics ground: lower in mud, so feet sink
//   field.kind(x, z)     // 'grass', 'dirt' or 'mud'
//   const land = new Land(asset.sun, field, physics);
//   land.update(camera, dt);   land.splash(x, z, strength);   // mud rings
//   wildTufts(field)   // for Tufts({ tufts })
//
// Features:
//   { type: 'hill', at, radius: [rx, rz], height, turn }
//   { type: 'gully', path, width, vary, depth, mud, dry, bank, taper }
//   { type: 'noise', scale, height }
//   { type: 'track', path, width, vary, wear }
//   { type: 'dirt' | 'shade', at, radius, wear }
//   { type: 'patches', scale, above, wear }
import { BufferGeometry, CatmullRomCurve3, DataTexture, Float32BufferAttribute, LinearFilter, Mesh, RGBAFormat, ShaderMaterial, Vector3, Vector4 } from 'three';
import { lightUniforms, NOISE, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { hash } from '../ibis/motion/spring.js';
import { MUD_WATER, mudUniforms, Ripples } from './mud.js';
import { haze } from './sky.js';
import { BLADES, DEPTH_BEHIND, DEPTH_BIAS, GRASS, GRASS_MARKS, grassUniforms, HAZE_FROM, PRINTS, WET_GROUND, wetUniforms } from './street.js';
import { noise2, tuftClusters } from './tufts.js';
import { f, srgb } from './util.js';

// low: above -GROUND_DEPTH (physics.js) less sink. slope: N.L change for
// the full slope tone. worn, dirt: wear thresholds. ragged: noise on the wear.
export const LAND = {
  cell: 1, surface: 0.5, edge: 4, low: -0.8, sink: 0.28, reach: 450, grow: 0.3, slope: 0.16,
  worn: 0.36, dirt: 0.62, ragged: 0.5,
};
// lit, shade. The mud's colours are in mud.js.
const COLOURS = {
  worn: [srgb(0.80, 0.79, 0.52), srgb(0.46, 0.53, 0.54)],
  dirt: [srgb(0.80, 0.66, 0.47), srgb(0.53, 0.48, 0.57)],
};
// Mud values: water above at, shallow band to shallow.
const WATER = { at: 0.85, shallow: 0.9 };
const WORN_MIX = 0.45;   // the part of the worn colour over the grass
const DAMP = srgb(0.80, 0.86, 0.84);
// Footprints.
const LAND_PRINTS = {
  dirt: { lit: srgb(0.66, 0.51, 0.36), shade: srgb(0.42, 0.38, 0.48), alpha: 0.55, wet: [srgb(0.52, 0.40, 0.30), srgb(0.34, 0.31, 0.42)] },
  mud: { lit: srgb(0.30, 0.22, 0.17), shade: srgb(0.19, 0.17, 0.25), alpha: 0.7, wet: [srgb(0.26, 0.19, 0.15), srgb(0.17, 0.15, 0.23)] },
};
// wildTufts(). tries: clusters per 100 square units. long: gully grass out to reach past the bank. bare:
// no tufts above this wear.
const WILD = {
  seed: 23, bare: 0.4, tries: 6,
  long: { reach: 3.2, step: 0.42, chance: 0.75, size: [0.6, 2.0], wide: 0.6, density: 0.25 },
};

export class Field {
  constructor({ box, features = [] }) {
    const { cell } = LAND;
    this.box = box;
    this.x0 = box.x[0];
    this.z0 = box.z[0];
    this.nx = Math.round((box.x[1] - box.x[0]) / cell);
    this.nz = Math.round((box.z[1] - box.z[0]) / cell);
    this.features = features.map(prepare);
    this.raised = this.features.filter(ft => ft.def.height);
    // The wear features that reach each WEAR_CELL cell, in their order.
    this.cw = Math.ceil((box.x[1] - box.x[0]) / WEAR_CELL) + 1;
    this.ch = Math.ceil((box.z[1] - box.z[0]) / WEAR_CELL) + 1;
    this.wearCells = Array.from({ length: this.cw * this.ch }, () => []);
    for (const ft of this.features.filter(g => g.def.wear)) {
      const [x0, x1, z0, z1] = ft.bounds ?? [-Infinity, Infinity, -Infinity, Infinity];
      for (let j = this.cellZ(z0); j <= this.cellZ(z1); j++) for (let i = this.cellX(x0); i <= this.cellX(x1); i++) this.wearCells[j * this.cw + i].push(ft);
    }
    const n = (this.nx + 1) * (this.nz + 1);
    this.heights = new Float32Array(n);
    this.mud = new Float32Array(n);     // the mud at each grid point
    this.floors = new Float32Array(n);  // the heights less the sink
    for (let j = 0; j <= this.nz; j++) {
      for (let i = 0; i <= this.nx; i++) {
        const x = this.x0 + i * cell, z = this.z0 + j * cell, k = j * (this.nx + 1) + i;
        this.heights[k] = this.raw(x, z);
        this.mud[k] = this.mudAt(x, z);
        this.floors[k] = this.heights[k] - LAND.sink * smooth(0.3, 0.8, this.mud[k]);
      }
    }
    this.texture = this.surfaceTexture();
    // As a level ground they are passed as functions.
    for (const name of ['height', 'floor', 'kind', 'print']) this[name] = this[name].bind(this);
  }

  // As a level ground (load.js): it owns z from here. No profile slabs: the physics gets its own mesh.
  get from() { return this.box.z[0]; }
  get profile() { return []; }

  inside(x, z) { return x >= this.box.x[0] && x <= this.box.x[1] && z >= this.box.z[0] && z <= this.box.z[1]; }

  cellX(x) { return Math.min(Math.max(Math.floor((x - this.x0) / WEAR_CELL), 0), this.cw - 1); }
  cellZ(z) { return Math.min(Math.max(Math.floor((z - this.z0) / WEAR_CELL), 0), this.ch - 1); }

  raw(x, z) {
    let h = 0;
    for (const ft of this.raised) h += ft.def.height(ft, x, z);
    return Math.max(h * this.fade(x, z), LAND.low);
  }

  fade(x, z) {
    const { box } = this, e = LAND.edge;
    const d = Math.min(x - box.x[0], box.x[1] - x, z - box.z[0], box.z[1] - z);
    const t = Math.min(Math.max(d / e, 0), 1);
    return t * t * (3 - 2 * t);
  }

  // The mud alone: the gullies.
  mudAt(x, z) {
    const out = { keep: 1, mud: 0 };
    for (const ft of this.features) if (ft.def.wet) ft.def.wear(ft, x, z, out);
    return Math.min(out.mud, 1) * this.fade(x, z);
  }

  // [wear, mud], smooth. Wears join as 1 - (1 - a)(1 - b).
  surface(x, z) {
    const out = { keep: 1, mud: 0 };
    for (const ft of this.wearCells[this.cellZ(z) * this.cw + this.cellX(x)]) ft.def.wear(ft, x, z, out);
    const fade = this.fade(x, z);
    return [(1 - out.keep) * fade, Math.min(out.mud, 1) * fade];
  }

  height(x, z) { return this.lerp(this.heights, x, z); }

  floor(x, z) { return this.lerp(this.floors, x, z); }

  // Grid value on the mesh triangles (diagonal (i + 1, j) to (i, j + 1)).
  lerp(H, x, z) {
    const { cell } = LAND, u0 = (x - this.x0) / cell, v0 = (z - this.z0) / cell;
    if (u0 < 0 || v0 < 0 || u0 >= this.nx || v0 >= this.nz) return 0;
    const i = Math.floor(u0), j = Math.floor(v0), u = u0 - i, v = v0 - j, w = this.nx + 1;
    const a = H[j * w + i], b = H[j * w + i + 1], c = H[(j + 1) * w + i], d = H[(j + 1) * w + i + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  // Without the shader noise: edges differ a little.
  kind(x, z) {
    if (!this.inside(x, z)) return 'grass';
    const [wear, mud] = this.surface(x, z);
    return mud > 0.5 ? 'mud' : wear > LAND.dirt ? 'dirt' : 'grass';
  }

  print(x, z) { const k = this.kind(x, z); return LAND_PRINTS[k] ?? PRINTS.grass; }

  normal(i, j) {
    const w = this.nx + 1, H = this.heights, at = (a, b) => H[Math.min(Math.max(b, 0), this.nz) * w + Math.min(Math.max(a, 0), this.nx)];
    return new Vector3(-(at(i + 1, j) - at(i - 1, j)) / (2 * LAND.cell), 1, -(at(i, j + 1) - at(i, j - 1)) / (2 * LAND.cell)).normalize();
  }

  surfaceTexture() {
    const s = LAND.surface, w = Math.ceil((this.box.x[1] - this.x0) / s), h = Math.ceil((this.box.z[1] - this.z0) / s);
    const data = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const [wear, mud] = this.surface(this.x0 + (i + 0.5) * s, this.z0 + (j + 0.5) * s), k = (j * w + i) * 4;
        data[k] = Math.round(wear * 255);
        data[k + 1] = Math.round(mud * 255);
        data[k + 3] = 255;
      }
    }
    const texture = new DataTexture(data, w, h, RGBAFormat);
    texture.magFilter = texture.minFilter = LinearFilter;
    texture.needsUpdate = true;
    this.surfaceSize = [w * s, h * s];
    return texture;
  }
}

// Feature types. height(ft, x, z): added to the height. wear(ft, x, z, out): out.keep times (1 - wear),
// out.mud at most the mud. A new type: an entry here, and prepare() if it needs sizes ready.
const addWear = (out, w) => { out.keep *= 1 - Math.min(Math.max(w, 0), 1); };
// A pool's distance in units of its edge (1), with a ragged outline.
function poolEdge(ft, x, z) {
  const [wx, wz] = warp(x, z, ft.small * 0.6), dx = wx - ft.at[0], dz = wz - ft.at[1];
  return Math.hypot((dx * ft.cs - dz * ft.sn) / ft.rx, (dx * ft.sn + dz * ft.cs) / ft.rz);
}

// warp() moves a point at most 0.47 of the radius: past 1.48 radii (bounds) there is no wear.
const spotWear = (ft, x, z, out) => {
  const dx = x - ft.at[0], dz = z - ft.at[1], far = 1.48 * ft.radius;
  if (dx * dx + dz * dz > far * far) return;
  const [wx, wz] = warp(x, z, ft.radius);
  addWear(out, ft.wear * (1 - smooth(0.25, 1, Math.hypot(wx - ft.at[0], wz - ft.at[1]) / ft.radius)));
};
const FEATURES = {
  hill: {
    height(ft, x, z) {
      const dx = x - ft.at[0], dz = z - ft.at[1];
      const u = (dx * ft.cs + dz * ft.sn) / ft.radius[0], v = (-dx * ft.sn + dz * ft.cs) / ft.radius[1], r2 = u * u + v * v;
      return r2 < 1 ? ft.height * (1 - r2) ** 2 : 0;
    },
  },
  gully: {
    wet: true,
    height(ft, x, z) {
      const g = alongCurve(ft, x, z), t = g ? g.d / g.half : 1;
      return t < 1 ? -g.depth * (1 - t * t) ** 2 : 0;
    },
    wear(ft, x, z, out) {
      const g = alongCurve(ft, x, z);
      if (!g) return;
      if (g.wet > 0) out.mud = Math.max(out.mud, 1 - smooth(g.wet - 0.5, g.wet + 0.5, g.d));
      // Banks: more wear where wet.
      const edge = Math.max(g.wet, g.half * 0.4);
      addWear(out, (1 - smooth(edge + ft.bank * 0.2, edge + ft.bank, g.d)) * (0.35 + 0.4 * g.wetness) * (0.4 + 1.0 * noise2(x * 0.3, z * 0.3, 19)));
    },
  },
  noise: { height: (ft, x, z) => ft.height * (noise2(x * ft.scale, z * ft.scale, 41) - 0.5) },
  track: {
    wear(ft, x, z, out) {
      const g = alongCurve(ft, x, z);
      if (g) addWear(out, ft.wear * (1 - smooth(0.3, 1, g.d / g.half)));
    },
  },
  // A mud hole, an oval with a ragged edge.
  pool: {
    wet: true,
    height(ft, x, z) {
      const t = poolEdge(ft, x, z);
      return t < 1 ? -ft.depth * (1 - t * t) ** 2 : 0;
    },
    wear(ft, x, z, out) {
      const t = poolEdge(ft, x, z), bank = ft.mud + ft.bank / ft.small;
      // Over 1 unit, as the gully: a sharper edge shows the texels.
      const e = 0.5 / ft.small;
      out.mud = Math.max(out.mud, 1 - smooth(ft.mud - e, ft.mud + e, t));
      addWear(out, (1 - smooth(ft.mud + 0.05, bank, t)) * 0.75 * (0.4 + noise2(x * 0.3, z * 0.3, 19)));
    },
  },
  dirt: { wear: spotWear },
  shade: { wear: spotWear },
  patches: { wear: (ft, x, z, out) => addWear(out, ft.wear * smooth(ft.above - 0.12, ft.above + 0.12, noise2(x * ft.scale, z * ft.scale, 13))) },
};

// Curve features: per point half width (and gully depth and wetness) from noise along the curve.
function prepare(ft, index) {
  const def = FEATURES[ft.type];
  if (ft.type === 'hill') return { ...ft, def, cs: Math.cos(ft.turn ?? 0), sn: Math.sin(ft.turn ?? 0) };
  if (ft.type === 'pool') {
    const out = { depth: 0.4, mud: 0.75, bank: 0.8, heading: 0, ...ft, def };
    const [rx, rz] = [ft.radius].flat().concat([ft.radius].flat()), far = Math.max(rx, rz) * 1.6 + out.bank;
    return Object.assign(out, { rx, rz, small: Math.min(rx, rz), cs: Math.cos(out.heading), sn: Math.sin(out.heading), bounds: [ft.at[0] - far, ft.at[0] + far, ft.at[1] - far, ft.at[1] + far] });
  }
  if (ft.type !== 'gully' && ft.type !== 'track') {
    const far = ft.radius * 1.48, bounds = ft.at && [ft.at[0] - far, ft.at[0] + far, ft.at[1] - far, ft.at[1] + far];
    return { wear: 1, ...ft, def, bounds };
  }
  const gully = ft.type === 'gully';
  const out = gully ? { vary: 0.5, mud: 0.6, dry: 0.3, bank: 1.5, taper: 10, ...ft, def } : { vary: 0.4, wear: 0.8, taper: 1.5, ...ft, def };
  const curve = new CatmullRomCurve3(ft.path.map(([x, z]) => new Vector3(x, 0, z)));
  const length = curve.getLength(), seed = 61 + index * 17;
  out.points = curve.getSpacedPoints(Math.ceil(length / 1.5)).map((p, i, all) => {
    const s = length * i / (all.length - 1), ends = smooth(0, out.taper, s) * smooth(0, out.taper, length - s);
    const grow = (1 + out.vary * (2 * noise2(s * 0.07, 0.5, seed) - 1)) * Math.max(ends, 0.02), half = out.width / 2 * grow;
    if (!gully) return { x: p.x, z: p.z, half };
    const wetness = smooth(out.dry - 0.1, out.dry + 0.1, noise2(s * 0.09, 3.5, seed + 1));
    return { x: p.x, z: p.z, half, depth: out.depth * (0.5 + 0.5 * grow), wetness, wet: half * out.mud * wetness };
  });
  // Each CURVE_CELL cell lists the segments within pad of it: farther, no caller uses the curve.
  const pad = out.width * (1 + out.vary) / 2 + (out.bank ?? 0) + 4;
  out.cells = new Map();
  for (let i = 1; i < out.points.length; i++) {
    const a = out.points[i - 1], b = out.points[i], cell = v => Math.floor(v / CURVE_CELL);
    for (let cx = cell(Math.min(a.x, b.x) - pad); cx <= cell(Math.max(a.x, b.x) + pad); cx++) {
      for (let cz = cell(Math.min(a.z, b.z) - pad); cz <= cell(Math.max(a.z, b.z) + pad); cz++) {
        const key = cx * 4096 + cz;
        if (!out.cells.has(key)) out.cells.set(key, []);
        out.cells.get(key).push(i);
      }
    }
  }
  const xs = out.points.map(p => p.x), zs = out.points.map(p => p.z);
  out.bounds = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
  return out;
}
const CURVE_CELL = 4;
const WEAR_CELL = 4;

// Nearest curve point: { d, half, depth, wetness, wet }, or null. d wobbles with noise.
function alongCurve({ points, cells }, x, z) {
  const near = cells.get(Math.floor(x / CURVE_CELL) * 4096 + Math.floor(z / CURVE_CELL));
  if (!near) return null;
  let best = Infinity, k = 0, t = 0;
  for (const i of near) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    const u = Math.min(Math.max(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0), 1);
    const d2 = (x - a.x - dx * u) ** 2 + (z - a.z - dz * u) ** 2;
    if (d2 < best) { best = d2; k = i; t = u; }
  }
  const a = points[k - 1], b = points[k], mix = key => a[key] + (b[key] - a[key]) * t;
  const half = mix('half');
  return { d: Math.sqrt(best) + 0.3 * half * (noise2(x * 0.35, z * 0.35, 17) - 0.5), half, depth: a.depth === undefined ? 0 : mix('depth'), wetness: a.wetness === undefined ? 0 : mix('wetness'), wet: a.wet === undefined ? 0 : mix('wet') };
}

function warp(x, z, size) {
  const s = 1.2 / size, a = size / 3;
  return [x + a * (2 * noise2(x * s, z * s, 29) - 1), z + a * (2 * noise2(x * s + 5.2, z * s, 31) - 1)];
}

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function lines(from, to) {
  const { cell, reach, grow } = LAND, n = Math.round((to - from) / cell);
  const inside = Array.from({ length: n + 1 }, (_, i) => from + i * cell);
  const out = () => { const list = []; let x = 0; while (x < reach - 1e-6) { x = Math.min(x + cell * 3 + grow * x, reach); list.push(x); } return list; };
  return { inside, before: out().map(d => from - d).reverse(), after: out().map(d => to + d) };
}

// Triangles of a grid of nx by nz cells, rows of nx + 1 points, up the normal. The diagonal of each cell
// is (i + 1, j) to (i, j + 1), as Field.lerp().
function gridIndex(nx, nz) {
  const index = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  return index;
}

export class Land {
  // base: the level's only ground, flat all round the box. Otherwise the street is before it in z.
  constructor(sun, field, physics = null, { base = false } = {}) {
    const { box } = field, X = lines(box.x[0], box.x[1]), Z = lines(box.z[0], box.z[1]);
    const xs = [...X.before, ...X.inside, ...X.after], zs = [...(base ? Z.before : []), ...Z.inside, ...Z.after];
    const i0 = X.before.length, j0 = base ? Z.before.length : 0, position = [], normal = [], mud = [], index = gridIndex(xs.length - 1, zs.length - 1);
    zs.forEach((z, j) => xs.forEach((x, i) => {
      const gi = i - i0, gj = j - j0, inGrid = gi >= 0 && gi <= field.nx && gj >= 0 && gj <= field.nz, k = gj * (field.nx + 1) + gi;
      position.push(x, inGrid ? field.heights[k] : 0, z);
      normal.push(...(inGrid ? field.normal(gi, gj).toArray() : [0, 1, 0]));
      mud.push(inGrid ? field.mud[k] : 0);
    }));
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
    g.setAttribute('aMud', new Float32BufferAttribute(mud, 1));
    g.setIndex(index);
    this.ripples = new Ripples();   // rings on the water of the mud, from splash()
    this.object = new Mesh(g, landMaterial(sun, field, this.ripples));
    this.object.receiveShadow = true;
    this.object.renderOrder = -1;   // as the street's ground: after the solid scenery, before the birdss
    this.object.frustumCulled = false;
    this.triangles = index.length / 3;
    if (!physics) return;
    const points = [];
    for (let j = 0; j <= field.nz; j++) for (let i = 0; i <= field.nx; i++) points.push(field.x0 + i * LAND.cell, field.floors[j * (field.nx + 1) + i], field.z0 + j * LAND.cell);
    physics.addMesh(points, gridIndex(field.nx, field.nz));
  }

  update(camera, dt = 0) { this.ripples.update(dt); }

  splash(x, z, strength) { this.ripples.add(x, z, strength); }
}

// [x, z, height, seed, leafy, wide]. Grass only, not worn bare.
export function wildTufts(field, clear = []) {
  let n = WILD.seed * 7919;
  const r = () => hash(n++), out = [], { box } = field;
  const add = (x, z, h, leafy, wide = 1) => {
    const tuft = [x, z, h, r(), Math.min(Math.max(leafy, 0), 1), wide];
    if (!field.inside(x, z)) return;
    const [wear, mud] = field.surface(x, z);
    if (wear < WILD.bare && mud < 0.4 && !clear.some(({ at, radius }) => Math.hypot(x - at[0], z - at[1]) < radius)) out.push(tuft);
  };
  tuftClusters(r, box, Math.round(WILD.tries * (box.x[1] - box.x[0]) * (box.z[1] - box.z[0]) / 100), WILD.seed, () => true, add);
  const L = WILD.long;
  for (const ft of field.features.filter(g => g.type === 'gully')) {
    const [x0, x1, z0, z1] = ft.bounds;
    for (let x = x0; x < x1; x += L.step) {
      for (let z = z0; z < z1; z += L.step) {
        const px = x + L.step * r(), pz = z + L.step * r(), g = alongCurve(ft, px, pz);
        if (!g) continue;
        const out = (g.d - g.wet) / (ft.bank + L.reach);
        if (out < 0 || out > 1 || r() > L.chance * (0.6 + 0.8 * noise2(px * L.density, pz * L.density, WILD.seed + 1)) * (1 - out * out)) continue;
        add(px, pz, (L.size[1] + (L.size[0] - L.size[1]) * out) * (0.75 + 0.25 * r()), 0.25 * r(), L.wide);
      }
    }
  }
  return out;
}

function landMaterial(sun, field, ripples) {
  const uniforms = {
    ...lightUniforms(), ...mudUniforms(), ...ripples.uniforms, ...grassUniforms(), uHaze: haze, uSun: { value: sun }, uSurface: { value: field.texture },
    uBox: { value: new Vector4(field.x0, field.z0, 1 / field.surfaceSize[0], 1 / field.surfaceSize[1]) }, uDamp: { value: DAMP },
    ...wetUniforms(),
  };
  for (const [name, [lit, shade]] of Object.entries(COLOURS)) {
    uniforms[`u_${name}Lit`] = { value: lit };
    uniforms[`u_${name}Shade`] = { value: shade };
  }
  const tone = name => `mix(u_${name}Shade, u_${name}Lit, lit)`;
  return new ShaderMaterial({
    lights: true,
    uniforms,
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      ${DEPTH_BEHIND}
      attribute float aMud;
      varying vec3 vWorld, vNormal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * world;
        // No depth bias in mud: it hides the sunk feet.
        depthBehind(world.xyz, ${f(DEPTH_BIAS)} * (1.0 - smoothstep(0.3, 0.6, aMud)));
        toonShadowCoord(world, normal);
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      ${NOISE}
      #define FRAGMENT
      ${GRASS}
      ${BLADES}
      ${GRASS_MARKS}
      ${MUD_WATER}
      ${Object.keys(COLOURS).map(n => `uniform vec3 u_${n}Lit, u_${n}Shade;`).join('\n')}
      uniform vec3 uHaze, uSun, uDamp;
      ${WET_GROUND}
      uniform sampler2D uSurface;
      uniform vec4 uBox;
      varying vec3 vWorld, vNormal;
      void main() {
        vec3 p = vWorld, n = normalize(vNormal);
        float near = patchNear(p);
        vec2 lamp = lampLight(n);
        float lit = lampBand(toonBand(n, uSun), lamp);
        Upright u = upright(p);
        vec2 q = (p.xz - uBox.xy) * uBox.zw, s = vec2(0.0);
        if (q.x > 0.0 && q.y > 0.0 && q.x < 1.0 && q.y < 1.0) s = texture2D(uSurface, q).rg;
        float isWorn = 0.0, isDirt = 0.0, isMud = 0.0, mud = s.y, wm = 1e-4;
        if (s.x + s.y > 0.01) {
          float clump = 0.72 * noise2(p.xz * 0.6 + vec2(17.0, 5.0)) + 0.28 * noise2(p.xz * 2.2 + vec2(41.0, 23.0)) - 0.5;
          float worn = s.x + ${f(LAND.ragged)} * clump, ww = max(fwidth(worn), 1e-4);
          isWorn = smoothstep(${f(LAND.worn)} - ww, ${f(LAND.worn)} + ww, worn);
          isDirt = smoothstep(${f(LAND.dirt)} - ww, ${f(LAND.dirt)} + ww, worn);
          mud = s.y + 0.3 * clump;
          wm = max(fwidth(mud), 1e-4);
          isMud = smoothstep(0.5 - wm, 0.5 + wm, mud);
        }
        float sun, lush, light = 0.0;
        grassPatches(p.xz, 1.0, sun, lush);
        vec3 grass = grassColour(sun, lush, lit, near);
        grass *= mix(vec3(1.0), uDamp, smoothstep(0.15, 0.45, s.y));
        vec3 col = mix(grass, mix(grass, ${tone('worn')}, ${f(WORN_MIX)}), isWorn);
        col = mix(col, ${tone('dirt')}, isDirt);
        if (near > 0.0 && isMud < 1.0) {
          float mark = near * grassMarks(p, u, light) * (1.0 - 0.5 * isDirt) * (1.0 - isMud);
          col = mix(col, markColour(grass, light, lit), mark);
        }
        if (isMud > 0.0) {
          vec3 mudCol = ${tone('bank')};
          float water = smoothstep(${f(WATER.at)} - wm, ${f(WATER.at)} + wm, mud);
          mudCol = mix(mudCol, mudWater(p.xz, 1.0 - smoothstep(${f(WATER.shallow)} - wm, ${f(WATER.shallow)} + wm, mud), smoothstep(${f(WATER.shallow)}, ${f(WATER.shallow + 0.04)}, mud), lit), water);
          mudCol = mix(mudCol, ${tone('line')}, inside(abs(mud - ${f(WATER.at)}), wm, wm));
          mudCol = mix(mudCol, ${tone('line')}, 0.5 * inside(abs(mud - 0.5), 0.8 * wm, wm));
          col = mix(col, mudCol, isMud);
        }
        float rel = clamp((dot(n, uSun) - uSun.y) / ${f(LAND.slope)}, -1.0, 1.0);
        col *= rel < 0.0 ? mix(vec3(1.0), vec3(0.84, 0.86, 0.97), -rel) : mix(vec3(1.0), vec3(1.06, 1.05, 0.96), rel);
        col = wetGround(col, p.xz);
        col = night(col, lamp);
        col = mix(col, uHaze, smoothstep(${f(HAZE_FROM[0])}, ${f(HAZE_FROM[1])}, distance(p, cameraPosition)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
