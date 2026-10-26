// Bakes the SDF model of a bird into a skinned glTF mesh in the bind pose. Runs in the browser (tools/bake.mjs).
// The bird is the bird URL parameter (src/birds.js), the ibis by default.
// For each part: sample the distance on a grid, mesh it with dual contouring, split the triangles where
// the material changes, simplify, then add normals and skin weights.
import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { BONES, NECK_BONES, bezier, bindPose, boneMatrices, toeDir, toeLength } from '../../src/ibis/rig.js';
import { pageBird } from '../../src/birds.js';
import { SdfEval } from './sdfEval.js';
import { dualContour } from './dualContour.js';

const SIMPLIFY_ERROR = 0.003;    // largest surface error after simplification, character units
const LINE_LOCK_SPACING = 0.02;  // distance between held points on a material line, character units
const BISECT_STEPS = 14;
const OUTLINE_SMOOTHING = 3;     // passes of neighbour averaging on the outline normals
const BONE = Object.fromEntries(BONES.map((name, i) => [name, i]));
const BIRD = pageBird();
const { MAT, shape: SHAPE } = BIRD;
const { rig: BIND_RIG, neckLengths: NECK_BIND_LENGTHS } = bindPose(SHAPE);

// part: PART_* in bake.glsl. cell: grid spacing. mat: one material for the whole part.
// group: the inner outline of a group never draws over the same group (see Ibis.js). 0 torso and head,
// 1 jaw, 2 wings, 3 legs, 4 scarf, 5 head apart from the torso (headGroup of the bird), so a line splits them.
const HEAD = BIRD.headGroup;
const PARTS = [
  { name: 'core', part: 1, group: 0, cell: 0.006, weights: coreWeights },
  { name: 'neck', part: 15, group: HEAD, cell: 0.005, weights: neckWeights },
  { name: 'head', part: 16, group: HEAD, cell: 0.004, weights: rigid('head') },
  { name: 'legL', part: 2, group: 3, cell: 0.004, weights: legWeights('L', 1) },
  { name: 'legR', part: 3, group: 3, cell: 0.004, weights: legWeights('R', -1) },
  { name: 'wingL', part: 4, group: 2, cell: 0.004, weights: rigid('wingL') },
  { name: 'wingR', part: 5, group: 2, cell: 0.004, weights: rigid('wingR') },
  { name: 'jaw', part: 6, group: 1, cell: 0.003, weights: rigid('jaw') },
  { name: 'eyes', part: 7, group: HEAD, cell: 0.003, mat: MAT.EYE, weights: rigid('head') },
  { name: 'lids', part: 8, group: HEAD, cell: 0.003, mat: MAT.LID, weights: rigid('head') },
  ...(BIRD.scarf ? [{ name: 'scarf', part: 9, group: 4, cell: 0.002, weights: rigid('pelvis') }] : []),
];
const PART_W = { body: 10, thighL: 11, thighR: 12 };

const V = (a, i) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

// ---- geometry ----
// Grid box round the part: a coarse pass over the whole character finds where the part is.
function partBounds(ev, part, pad) {
  const cell = 0.03, n = 131, min = [-1.95, -0.95, -1.65];
  const d = ev.grid(part, min, cell, [n, n, n]);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < d.length; i++) {
    if (d[i] > cell) continue;
    const c = [i % n, Math.floor(i / n) % n, Math.floor(i / (n * n))];
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], min[a] + c[a] * cell); hi[a] = Math.max(hi[a], min[a] + c[a] * cell); }
  }
  return { lo: lo.map(x => x - pad), hi: hi.map(x => x + pad) };
}

// Newton steps along the gradient onto the zero set. A step is at most maxStep long.
function project(ev, part, pos, iters, maxStep) {
  for (let it = 0; it < iters; it++) {
    const { g, d } = ev.gradient(part, pos);
    for (let i = 0; i < d.length; i++) {
      const gx = g[i * 3], gy = g[i * 3 + 1], gz = g[i * 3 + 2];
      const gg = gx * gx + gy * gy + gz * gz;
      if (gg < 1e-8) continue;
      let s = d[i] / gg;
      const len = Math.abs(s) * Math.sqrt(gg);
      if (len > maxStep) s *= maxStep / len;
      pos[i * 3] -= gx * s; pos[i * 3 + 1] -= gy * s; pos[i * 3 + 2] -= gz * s;
    }
  }
}

function unitGradient(ev, part, xyz) {
  const { g } = ev.gradient(part, xyz);
  for (let i = 0; i < g.length; i += 3) {
    const l = Math.hypot(g[i], g[i + 1], g[i + 2]) || 1;
    g[i] /= l; g[i + 1] /= l; g[i + 2] /= l;
  }
  return g;
}

// Splits triangles where the material changes, so every triangle has one material and the border runs
// along the true material line. Returns triangles and a material per triangle, over the extended points.
function splitMaterials(ev, spec, pos, tris) {
  const ids = ev.points(spec.part, pos).id;
  const points = Array.from(pos);
  const edgeKey = (a, b) => (a < b ? a * 0x200000 + b : b * 0x200000 + a);
  const edges = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e], b = tris[t + (e + 1) % 3];
      if (ids[a] !== ids[b] && !edges.has(edgeKey(a, b))) edges.set(edgeKey(a, b), [a, b]);
    }
  }
  // Bisect each mixed edge for the point where the material changes.
  const list = [...edges.values()];
  const lo = new Float32Array(list.length * 3), hi = new Float32Array(list.length * 3);
  list.forEach(([a, b], i) => { lo.set(pos.subarray(a * 3, a * 3 + 3), i * 3); hi.set(pos.subarray(b * 3, b * 3 + 3), i * 3); });
  const mid = new Float32Array(list.length * 3);
  for (let s = 0; s < BISECT_STEPS; s++) {
    for (let i = 0; i < mid.length; i++) mid[i] = (lo[i] + hi[i]) / 2;
    const midIds = ev.points(spec.part, mid).id;
    list.forEach(([a], i) => {
      const side = midIds[i] === ids[a] ? lo : hi;
      side.set(mid.subarray(i * 3, i * 3 + 3), i * 3);
    });
  }
  for (let i = 0; i < mid.length; i++) mid[i] = (lo[i] + hi[i]) / 2;
  project(ev, spec.part, mid, 2, spec.cell);
  const edgePoint = new Map();
  list.forEach(([a, b], i) => { edgePoint.set(edgeKey(a, b), points.length / 3); points.push(mid[i * 3], mid[i * 3 + 1], mid[i * 3 + 2]); });
  const at = (a, b) => edgePoint.get(edgeKey(a, b));

  const out = [], mats = [];
  const emit = (a, b, c, m) => { out.push(a, b, c); mats.push(m); };
  for (let t = 0; t < tris.length; t += 3) {
    let [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const ia = ids[a], ib = ids[b], ic = ids[c];
    if (ia === ib && ib === ic) { emit(a, b, c, ia); continue; }
    if (ia !== ib && ib !== ic && ia !== ic) {
      // Three materials: a fan round the middle of the three edge points.
      const ab = at(a, b), bc = at(b, c), ca = at(c, a);
      const g = points.length / 3;
      for (let k = 0; k < 3; k++) points.push((points[ab * 3 + k] + points[bc * 3 + k] + points[ca * 3 + k]) / 3);
      emit(a, ab, g, ia); emit(a, g, ca, ia);
      emit(b, bc, g, ib); emit(b, g, ab, ib);
      emit(c, ca, g, ic); emit(c, g, bc, ic);
      continue;
    }
    // Two materials: rotate so a is the odd vertex, keeping the winding.
    if (ia === ic) [a, b, c] = [b, c, a];
    else if (ia === ib) [a, b, c] = [c, a, b];
    const ab = at(a, b), ac = at(a, c);
    emit(a, ab, ac, ids[a]);
    emit(ab, b, c, ids[b]);
    emit(ab, c, ac, ids[b]);
  }
  return { points: new Float32Array(points), tris: out, mats };
}

// One vertex per (point, material), so material borders become open mesh borders.
function weldByMaterial(points, tris, mats) {
  const map = new Map(), pos = [], mat = [], index = [];
  for (let t = 0; t < mats.length; t++) {
    for (let k = 0; k < 3; k++) {
      const p = tris[t * 3 + k], key = p * 32 + mats[t];
      let v = map.get(key);
      if (v === undefined) {
        v = mat.length;
        map.set(key, v);
        pos.push(points[p * 3], points[p * 3 + 1], points[p * 3 + 2]);
        mat.push(mats[t]);
      }
      index.push(v);
    }
  }
  return { pos: new Float32Array(pos), mat, index: new Uint32Array(index) };
}

// Simplifies with the material lines held, then drops unused vertices. The simplifier sees two vertices
// at one position as a seam, not a border, so LockBorder alone lets a material line collapse along itself.
// The vertex lock holds material line points about LINE_LOCK_SPACING apart, so a line keeps its curve.
// The points between them can still collapse along the line.
function simplify(pos, mat, index) {
  const n = mat.length, firstMat = new Map(), lock = new Uint8Array(n);
  const key = v => `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
  for (let v = 0; v < n; v++) {
    const m = firstMat.get(key(v));
    if (m === undefined) firstMat.set(key(v), mat[v]);
    else if (m !== mat[v]) firstMat.set(key(v), -1);
  }
  const held = [], heldKeys = new Set();
  for (let v = 0; v < n; v++) {
    if (firstMat.get(key(v)) !== -1 || heldKeys.has(key(v))) continue;
    const p = V(pos, v);
    if (held.some(h => h.distanceTo(p) < LINE_LOCK_SPACING)) continue;
    held.push(p);
    heldKeys.add(key(v));
  }
  for (let v = 0; v < n; v++) lock[v] = heldKeys.has(key(v)) ? 1 : 0;
  const [simple] = MeshoptSimplifier.simplifyWithAttributes(index, pos, 3, new Float32Array(n), 1, [0], lock, 0, SIMPLIFY_ERROR,
    ['LockBorder', 'ErrorAbsolute']);
  const remap = new Int32Array(mat.length).fill(-1), outPos = [], outMat = [];
  const outIndex = new Uint32Array(simple.length);
  simple.forEach((v, i) => {
    if (remap[v] < 0) { remap[v] = outMat.length; outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); outMat.push(mat[v]); }
    outIndex[i] = remap[v];
  });
  return { pos: new Float32Array(outPos), mat: outMat, index: outIndex };
}

function bakePart(ev, spec) {
  const t0 = performance.now();
  const { lo, hi } = partBounds(ev, spec.part, 3 * spec.cell + 0.03);
  const dims = lo.map((l, a) => Math.ceil((hi[a] - l) / spec.cell) + 1);
  const d = ev.grid(spec.part, lo, spec.cell, dims);
  const raw = dualContour(d, dims, lo, spec.cell, xyz => unitGradient(ev, spec.part, xyz));
  const split = spec.mat
    ? { points: raw.pos, tris: Array.from(raw.tris), mats: new Array(raw.tris.length / 3).fill(spec.mat) }
    : splitMaterials(ev, spec, raw.pos, raw.tris);
  const welded = weldByMaterial(split.points, split.tris, split.mats);
  const simple = simplify(welded.pos, welded.mat, welded.index);
  const flipped = fixWinding(simple, unitGradient(ev, spec.part, simple.pos));
  const mesh = splitCreases(ev, spec.part, simple, outlineNormals(simple.pos, simple.index));
  const stats = {
    name: spec.name, grid: dims.join('x'), raw: raw.tris.length / 3, tris: mesh.index.length / 3,
    verts: mesh.mat.length, flipped, ms: Math.round(performance.now() - t0),
  };
  return { ...mesh, weights: spec.weights(ev, mesh.pos), spec, stats };
}

// Outline normal: the angle-weighted mean of the face normals round each position. Smooth across sharp
// edges, where the field gradient jumps between the faces, so the outline hull has no cracks or jags.
function outlineNormals(pos, index) {
  const key = i => `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`;
  const sums = new Map();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const vs = [index[t], index[t + 1], index[t + 2]];
    n.crossVectors(e1.subVectors(V(pos, vs[1]), V(pos, vs[0])), e2.subVectors(V(pos, vs[2]), V(pos, vs[0]))).normalize();
    vs.forEach((v, k) => {
      const angle = V(pos, vs[(k + 1) % 3]).sub(V(pos, v)).angleTo(V(pos, vs[(k + 2) % 3]).sub(V(pos, v)));
      const sum = sums.get(key(v)) || new THREE.Vector3();
      sums.set(key(v), sum.addScaledVector(n, angle));
    });
  }
  // Then average with the neighbours a few times, so neighbours push out together and sharp corners
  // don't throw out slivers.
  const near = new Map([...sums.keys()].map(k => [k, new Set()]));
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = key(index[t + k]);
      near.get(a).add(key(index[t + (k + 1) % 3])).add(key(index[t + (k + 2) % 3]));
    }
  }
  let normals = new Map([...sums].map(([k, v]) => [k, v.clone().normalize()]));
  for (let it = 0; it < OUTLINE_SMOOTHING; it++) {
    normals = new Map([...normals].map(([k, n]) => {
      const sum = n.clone();
      for (const j of near.get(k)) sum.add(normals.get(j));
      return [k, sum.normalize()];
    }));
  }
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) out.set(normals.get(key(i)).toArray(), i * 3);
  return out;
}

// Normals from the part's own field, so the shading matches the raymarch. A sharp edge gets a vertex
// on each side: every triangle corner takes the normal just inside its own triangle, and corners round
// a vertex with close normals share one vertex again.
const CREASE_COS = Math.cos(35 * Math.PI / 180);
function splitCreases(ev, part, mesh, outline) {
  const { pos, index, mat } = mesh;
  const smooth = unitGradient(ev, part, pos);
  const samples = new Float32Array(index.length * 3);
  for (let t = 0; t < index.length; t += 3) {
    const c = V(pos, index[t]).add(V(pos, index[t + 1])).add(V(pos, index[t + 2])).divideScalar(3);
    for (let k = 0; k < 3; k++) samples.set(V(pos, index[t + k]).lerp(c, 0.3).toArray(), (t + k) * 3);
  }
  const corner = unitGradient(ev, part, samples);
  const clusters = Array.from({ length: mat.length }, () => []);
  const out = { pos: [], normal: [], outline: [], mat: [], index: new Uint32Array(index.length) };
  for (let i = 0; i < index.length; i++) {
    const v = index[i], n = V(corner, i);
    let cl = clusters[v].find(c => c.sum.clone().normalize().dot(n) > CREASE_COS);
    if (!cl) { cl = { sum: new THREE.Vector3(), corners: [] }; clusters[v].push(cl); }
    cl.sum.add(n);
    cl.corners.push(i);
  }
  clusters.forEach((cls, v) => {
    for (const cl of cls) {
      const vi = out.mat.length;
      // One side only: the field normal at the vertex. Else the mean of the side's corner normals.
      const n = cls.length === 1 ? V(smooth, v) : cl.sum.normalize();
      out.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      out.normal.push(n.x, n.y, n.z);
      out.outline.push(outline[v * 3], outline[v * 3 + 1], outline[v * 3 + 2]);
      out.mat.push(mat[v]);
      for (const i of cl.corners) out.index[i] = vi;
    }
  });
  return { ...out, pos: new Float32Array(out.pos), normal: new Float32Array(out.normal), outline: new Float32Array(out.outline) };
}

// Dual contouring winding follows the grid. Flip each triangle that faces against the field gradient.
function fixWinding(mesh, normal) {
  const { pos, index } = mesh;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  let flips = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = V(pos, index[t]), b = V(pos, index[t + 1]), c = V(pos, index[t + 2]);
    e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
    const g = V(normal, index[t]).add(V(normal, index[t + 1])).add(V(normal, index[t + 2]));
    if (n.dot(g) < 0) { [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]]; flips++; }
  }
  return flips;
}

// ---- skin weights ----
// Up to 4 bone influences per vertex: { index: [bone...], weight: [w...] }.
function topFour(entries) {
  const top = entries.filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, [, w]) => s + w, 0);
  return { index: top.map(([b]) => b), weight: top.map(([, w]) => w / sum) };
}

// Soft nearest part: weight exp(-(d - dmin) / k).
function softmin(ds, k) {
  const m = Math.min(...ds);
  return ds.map(d => Math.exp(-(d - m) / k));
}

function rigid(bone) {
  return (ev, pos) => Array.from({ length: pos.length / 3 }, () => ({ index: [BONE[bone]], weight: [1] }));
}

// Body and thighs blend by distance to each sub-part.
function coreWeights(ev, pos) {
  const keys = ['body', 'thighL', 'thighR'];
  const ds = keys.map(k => ev.points(PART_W[k], pos).d);
  return Array.from({ length: pos.length / 3 }, (_, i) => {
    const w = softmin(ds.map(d => d[i]), 0.025);
    return topFour([[BONE.pelvis, w[0]], [BONE.thighL, w[1]], [BONE.thighR, w[2]]]);
  });
}

// Neck: spread over the chain by the nearest point on the neck curve.
function neckWeights(ev, pos) {
  const R = BIND_RIG;
  const samples = Array.from({ length: 257 }, (_, i) => bezier(R.neckBase, R.neckCtrl, R.neckTip, i / 256));
  return Array.from({ length: pos.length / 3 }, (_, i) => {
    const p = V(pos, i);
    let best = 0;
    samples.forEach((s, j) => { if (s.distanceToSquared(p) < samples[best].distanceToSquared(p)) best = j; });
    const s = (best / 256) * NECK_BONES;
    const w = Array.from({ length: NECK_BONES }, (_, k) => Math.max(0, 1 - Math.abs(s - (k + 0.5))));
    if (s < 0.5) w[0] = 1;
    if (s > NECK_BONES - 0.5) w[NECK_BONES - 1] = 1;
    return topFour(w.map((x, k) => [BONE['neck' + k], x]));
  });
}

function segmentDistance(p, a, b) {
  const ab = b.clone().sub(a);
  const t = Math.min(Math.max(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0), 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

// Shank, foot ball and toes blend by distance to each bone's segment.
function legWeights(s, side) {
  return (ev, pos) => {
    const R = BIND_RIG;
    const hip = R['hip' + s], knee = R['knee' + s], foot = R['foot' + s];
    const upper = hip.clone().lerp(knee, 0.5);
    const toes = [0, 1, 2, 3].map(i => {
      const dir = toeDir(side, i);
      return [foot.clone().addScaledVector(dir, 0.06), foot.clone().addScaledVector(dir, toeLength(i, SHAPE))];
    });
    return Array.from({ length: pos.length / 3 }, (_, i) => {
      const p = V(pos, i);
      const ds = [
        segmentDistance(p, upper, knee), segmentDistance(p, knee, foot), p.distanceTo(foot) - 0.07,
        ...toes.map(([a, b]) => segmentDistance(p, a, b) - 0.03),
      ];
      const w = softmin(ds, 0.015);
      return topFour([
        [BONE['thigh' + s], w[0]], [BONE['shank' + s], w[1]], [BONE['foot' + s], w[2]],
        ...[0, 1, 2, 3].map(t => [BONE['toe' + s + t], w[3 + t]]),
      ]);
    });
  };
}

// ---- output ----
// Four weights as bytes that sum to exactly 255.
function quantizeWeights(weight) {
  const q = [0, 1, 2, 3].map(k => Math.round((weight[k] ?? 0) * 255));
  q[0] += 255 - q.reduce((a, b) => a + b, 0);
  return q;
}

function buildGeometry(parts) {
  const pos = [], normal = [], outline = [], mat = [], group = [], line = [], edge = [], skinIndex = [], skinWeight = [], index = [];
  for (const part of parts) {
    const base = mat.length;
    const n = part.mat.length;
    const name = part.spec.name;
    // The eyes and lids sit in the skull and get no outline hull. The eye draws its own line where it
    // meets the skull (edge), and the lid draws its cut.
    const lineAttr = new Array(n).fill(name === 'eyes' || name === 'lids' ? 0 : 1);
    const edgeAttr = name === 'eyes' ? part.skullDistance : new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      pos.push(...part.pos.subarray(i * 3, i * 3 + 3));
      normal.push(...part.normal.subarray(i * 3, i * 3 + 3));
      outline.push(...part.outline.subarray(i * 3, i * 3 + 3));
      mat.push(part.mat[i]);
      group.push(part.spec.group);
      line.push(lineAttr[i]);
      edge.push(edgeAttr[i]);
      const w = part.weights[i];
      skinIndex.push(...[0, 1, 2, 3].map(k => w.index[k] ?? 0));
      skinWeight.push(...quantizeWeights(w.weight));
    }
    for (const v of part.index) index.push(base + v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('_outline', new THREE.Float32BufferAttribute(outline, 3));
  g.setAttribute('_mat', new THREE.Float32BufferAttribute(mat, 1));
  g.setAttribute('_group', new THREE.Float32BufferAttribute(group, 1));
  g.setAttribute('_line', new THREE.Float32BufferAttribute(line, 1));
  g.setAttribute('_edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(skinWeight, 4, true));
  g.setIndex(index);
  return g;
}

async function bake() {
  await MeshoptSimplifier.ready;
  const ev = new SdfEval(BIRD, BIND_RIG);
  const palette = ev.palette();
  const parts = PARTS.map(spec => bakePart(ev, spec));
  const eyes = parts.find(p => p.spec.name === 'eyes');
  eyes.skullDistance = ev.points(PARTS.find(p => p.name === 'head').part, eyes.pos).d;

  const used = [...new Set(parts.flatMap(p => p.mat)), MAT.PUPIL];
  const colors = Object.fromEntries(used.map(id => [id, palette(id === MAT.LID ? MAT.BLACK : id)]));
  const geometry = buildGeometry(parts);

  const root = new THREE.Group();
  root.name = BIRD.name;
  const bind = boneMatrices(BIND_RIG, NECK_BIND_LENGTHS, SHAPE);
  const bones = BONES.map((name, i) => {
    const b = new THREE.Bone();
    b.name = name;
    bind[i].decompose(b.position, b.quaternion, b.scale);
    root.add(b);
    return b;
  });
  const material = new THREE.MeshStandardMaterial({ name: BIRD.name, roughness: 1, metalness: 0 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'body';
  mesh.userData = { palette: colors };   // sRGB lit, shade and line colours by material id
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  const bytes = new Uint8Array(glb);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { glb: btoa(bin), stats: parts.map(p => p.stats) };
}

window.bakeResult = bake().catch(e => ({ error: e.stack || String(e) }));
