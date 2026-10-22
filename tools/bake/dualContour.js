// Dual contouring: one vertex per grid cell that the surface crosses, and one quad per crossed grid edge.
// The vertex minimises the squared distance to the tangent planes at the cell's edge crossings (a QEF),
// so it sits on sharp edges and corners instead of cutting them.
// d holds the distance at grid points, index x + nx * (y + ny * z). normalsAt(xyz) returns unit normals.
const CORNERS = Array.from({ length: 8 }, (_, c) => [c & 1, (c >> 1) & 1, (c >> 2) & 1]);
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// The 12 cell edges as (corner offset, axis).
const CELL_EDGES = [];
for (let a = 0; a < 3; a++) for (const c of CORNERS) if (c[a] === 0) CELL_EDGES.push([c, a]);
const QEF_PULL = 0.05;   // weight that pulls the vertex toward the mean crossing, so flat cells stay stable

export function dualContour(d, dims, min, cell, normalsAt) {
  const [nx, ny, nz] = dims;
  const at = (i, j, k) => d[i + nx * (j + ny * k)];

  // Crossings on grid edges: key = point index * 3 + axis.
  const edgeIndex = new Map(), cross = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = at(i, j, k);
    for (let a = 0; a < 3; a++) {
      const [ox, oy, oz] = AXES[a];
      if (i + ox >= nx || j + oy >= ny || k + oz >= nz) continue;
      const v1 = at(i + ox, j + oy, k + oz);
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      edgeIndex.set((i + nx * (j + ny * k)) * 3 + a, cross.length / 3);
      cross.push(min[0] + cell * (i + t * ox), min[1] + cell * (j + t * oy), min[2] + cell * (k + t * oz));
    }
  }
  const points = new Float32Array(cross);
  const normals = normalsAt(points);

  // One vertex per cell with a crossing.
  const cellVertex = new Map(), pos = [];
  const ata = new Float64Array(6), atb = new Float64Array(3);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let n = 0, mx = 0, my = 0, mz = 0;
    const found = [];
    for (const [c, a] of CELL_EDGES) {
      const e = edgeIndex.get(((i + c[0]) + nx * ((j + c[1]) + ny * (k + c[2]))) * 3 + a);
      if (e === undefined) continue;
      found.push(e);
      mx += points[e * 3]; my += points[e * 3 + 1]; mz += points[e * 3 + 2]; n++;
    }
    if (n === 0) continue;
    mx /= n; my /= n; mz /= n;
    // Solve (sum n n^T + w I) x = sum n (n . (p - m)) + 0, in coordinates relative to the mean m.
    ata.fill(0); atb.fill(0);
    for (const e of found) {
      const ax = normals[e * 3], ay = normals[e * 3 + 1], az = normals[e * 3 + 2];
      const b = ax * (points[e * 3] - mx) + ay * (points[e * 3 + 1] - my) + az * (points[e * 3 + 2] - mz);
      ata[0] += ax * ax; ata[1] += ax * ay; ata[2] += ax * az; ata[3] += ay * ay; ata[4] += ay * az; ata[5] += az * az;
      atb[0] += ax * b; atb[1] += ay * b; atb[2] += az * b;
    }
    const w = QEF_PULL * n;
    const x = solve3(ata[0] + w, ata[1], ata[2], ata[3] + w, ata[4], ata[5] + w, atb[0], atb[1], atb[2]);
    // Keep the vertex in its cell, with a little slack.
    const lo = [min[0] + cell * (i - 0.1), min[1] + cell * (j - 0.1), min[2] + cell * (k - 0.1)];
    const p = [mx + x[0], my + x[1], mz + x[2]].map((v, a) => Math.min(Math.max(v, lo[a]), lo[a] + cell * 1.2));
    cellVertex.set(i + nx * (j + ny * k), pos.length / 3);
    pos.push(...p);
  }

  // A quad round each crossed edge, from the four cells that share it.
  const tris = [];
  const dist = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  for (const [key] of edgeIndex) {
    const a = key % 3, p = (key - a) / 3;
    const i = p % nx, j = Math.floor(p / nx) % ny, k = Math.floor(p / (nx * ny));
    const u = (a + 1) % 3, v = (a + 2) % 3;
    const c = [i, j, k];
    if (c[u] === 0 || c[v] === 0) continue;
    const cellAt = (du, dv) => {
      const q = [...c];
      q[u] -= du; q[v] -= dv;
      return cellVertex.get(q[0] + nx * (q[1] + ny * q[2]));
    };
    let q0 = cellAt(0, 0), q1 = cellAt(1, 0), q2 = cellAt(1, 1), q3 = cellAt(0, 1);
    if ([q0, q1, q2, q3].includes(undefined)) continue;
    // Face outward: the winding depends on which end of the edge is inside.
    if (d[p] > 0) [q1, q3] = [q3, q1];
    if (dist(q0, q2) < dist(q1, q3)) tris.push(q0, q1, q2, q0, q2, q3);
    else tris.push(q0, q1, q3, q1, q2, q3);
  }
  return { pos: new Float32Array(pos), tris: new Uint32Array(tris) };
}

// Solves the symmetric 3x3 system [a b c; b d e; c e f] x = (g, h, i).
function solve3(a, b, c, d, e, f, g, h, i) {
  const A = d * f - e * e, B = c * e - b * f, C = b * e - c * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const D = a * f - c * c, E = b * c - a * e, F = a * d - b * b;
  return [(A * g + B * h + C * i) / det, (B * g + D * h + E * i) / det, (C * g + E * h + F * i) / det];
}
