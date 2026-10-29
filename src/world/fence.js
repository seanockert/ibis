// A low front fence: white posts, a white top rail between them, and a chain wire mesh below, as on an
// Australian suburban front yard (or in Bluey). The same toon look as the props: a lit and a shade colour
// and an outline. Along straight runs from the level data.
//
//   const fence = new Fence(asset, physics, { runs, gates, ground });   // runs: [[[x, z], [x, z]], ...]; gates: [{ at, width }], a gap in a run; physics optional: a solid wall
//   scene.add(fence.object);
//   fence.perches();   // where a flying miner can land: the post tops and the middle of each rail
//   fence.update(camera);   // every frame: the fade of the posts and rails near the camera
//
// Posts and rails are instanced (one draw each, and one for each outline). A post or a rail that the
// camera is in or near fades all over (seeIds() in props.js). The wire is one mesh of flat
// quads, a diamond pattern in the shader with alphaToCoverage (soft edges with the multisampled target
// of grade.js, no sorting). Far away, where a diamond is a few pixels, the lines blend to a flat tint.
import { DoubleSide, Float32BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, Line3, Matrix4, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { lightUniforms, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { outlineMaterial, SEE, SEE_THROUGH, seeIds, seeOn, smoothNormals, toonMaterial } from './props.js';
import { srgb, f } from './util.js';


// Sizes in units: the bird is 2 tall (about 70 cm), so 1 unit is about 35 cm. A real front fence is about
// 1.2 m (3.4 units); this one is a little lower, as the rest of the street. The posts are higher than the
// bird's flutter (2.0), so it can't jump over. out: the fence line, this far outside the play area (the
// physics fence for light props is 0.5 outside it, so a ball stops at the posts). post: width, height. rail:
// height of its top, height, depth. wire: bottom and top height; cell: diamond width and height (larger
// than real chain wire, as in a cartoon); width: line.
export const FENCE = {
  out: 0.6, spacing: 5,
  post: [0.26, 3.2], rail: [2.9, 0.22, 0.13],
  wire: { bottom: 0.06, top: 2.7, cell: [0.32, 0.44], width: 0.04 },
  solid: 0.2,   // thickness of the wall in the physics
};
// lit, shade, line. White posts with a warm tan line, as the reference; blue-grey wire. The gate (gate.js) too.
export const COLOURS = {
  post: [srgb(0.98, 0.97, 0.94), srgb(0.74, 0.73, 0.86), srgb(0.52, 0.43, 0.30)],
  wire: [srgb(0.66, 0.73, 0.80), srgb(0.47, 0.53, 0.68)],
};

export class Fence {
  constructor(asset, physics = null, { runs: list = [], gates = [], ground }) {
    const runs = fenceRuns(list, ground, gates);
    const [pw, ph] = FENCE.post, [railTop, rh, rd] = FENCE.rail;
    const rails = [];
    for (const [a, b] of runs) {
      const n = postCount(a, b);
      for (let i = 0; i < n; i++) rails.push([a.clone().lerp(b, i / n), a.clone().lerp(b, (i + 1) / n)]);
      // The wall: a thin box along the run, as high as the posts.
      if (physics) {
        const side = new Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(FENCE.solid / 2);
        physics.addTerrain([a, b].flatMap(p => [p.clone().add(side), p.clone().sub(side)]).flatMap(p => [p.x, p.y, p.z, p.x, p.y + ph, p.z]));
      }
    }
    const [lit, shade, line] = COLOURS.post;
    // Each instance's id (seeIds()) is its place in the list.
    const instanced = (geometry, list, matrix, ids) => {
      geometry.setAttribute('_outline', smoothNormals(geometry));
      geometry.setAttribute('aSeeId', new InstancedBufferAttribute(Float32Array.from(list, (_, i) => i), 1));
      const meshes = [new InstancedMesh(geometry, toonMaterial(lit, shade, asset.uniforms, { ids }), list.length), new InstancedMesh(geometry, outlineMaterial(line, asset.uniforms, { ids }), list.length)];
      list.forEach((item, i) => { const m = matrix(item); for (const mesh of meshes) mesh.setMatrixAt(i, m); });
      meshes[0].castShadow = meshes[0].receiveShadow = true;
      for (const mesh of meshes) mesh.frustumCulled = false;
      return meshes;
    };
    const postGeometry = roundedPost(pw, ph, 0.06);
    const q = new Quaternion(), up = new Vector3(0, 1, 0);
    const posts = this.posts = fencePosts(runs);
    this.see = { posts: seeIds(), rails: seeIds() };
    const postMeshes = instanced(postGeometry, posts, p => new Matrix4().setPosition(p), this.see.posts);
    // Rails: a unit long box, stretched to the gap between two posts.
    const railGeometry = roundedRail(rh, rd, 0.05).translate(0, railTop - rh / 2, 0);
    const railMeshes = instanced(railGeometry, rails, ([a, b]) => {
      q.setFromAxisAngle(up, Math.atan2(a.z - b.z, b.x - a.x));
      return new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(a.distanceTo(b) - pw + 0.02, 1, 1));
    }, this.see.rails);
    this.wire = new Mesh(wireGeometry(runs), wireMaterial(asset.sun));
    this.wire.receiveShadow = true;
    this.wire.frustumCulled = false;
    this.object = postMeshes[0];
    this.object.add(postMeshes[1], ...railMeshes, this.wire);
    this.rails = rails;
    // The volumes for the fade: a capsule along each post and each rail, SEE.margin larger.
    const y = railTop - rh / 2;
    this.volumes = {
      posts: posts.map(p => new Line3(p.clone(), p.clone().setY(p.y + ph))), post: pw / Math.SQRT2 + SEE.margin,
      rails: rails.map(([a, b]) => new Line3(a.clone().setY(a.y + y), b.clone().setY(b.y + y))), rail: Math.hypot(rh, rd) / 2 + SEE.margin,
    };
  }

  update(camera) {
    const eye = camera.position, { posts, post, rails, rail } = this.volumes;
    const near = (line, r) => line.closestPointToPoint(eye, true, closest).distanceToSquared(eye) < r * r;
    this.see.posts.update(posts.length, i => near(posts[i], post));
    this.see.rails.update(rails.length, i => near(rails[i], rail));
  }

  // Perches for the flying miners (src/characters/sentry.js), as perch() on a prop: the top of each post,
  // and the middle of the top of each rail, where a bird stands across the rail (face: across the run).
  perches() {
    const post = FENCE.post[1], rail = FENCE.rail[0];
    const spot = (p, face = null) => ({ perch: (out = new Vector3()) => out.copy(p), face });
    return [
      ...this.posts.map(p => spot(p.clone().setY(p.y + post))),
      ...this.rails.map(([a, b]) => spot(a.clone().lerp(b, 0.5).setY(a.y + rail), new Vector3(b.z - a.z, 0, a.x - b.x).normalize())),
    ];
  }
}

const closest = new Vector3();   // scratch

const postCount = (a, b) => Math.max(1, Math.round(a.distanceTo(b) / FENCE.spacing));

// Post places: at the ends of each run and spaced along it. Corners are shared. The tufts (tufts.js) grow
// round them. runs: from fenceRuns().
export function fencePosts(runs) {
  const posts = new Map();
  for (const [a, b] of runs) {
    const n = postCount(a, b);
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      posts.set(`${p.x.toFixed(2)},${p.z.toFixed(2)}`, p);
    }
  }
  return [...posts.values()];
}

// Straight runs [a, b] on the ground, from [[x, z], [x, z]] pairs. gates: [{ at: [x, z], width }]: a gate
// within GATE_ON of a run cuts a gap width wide in it, centred on at. The posts at the ends of the gap
// are the gate posts.
export function fenceRuns(list, ground, gates = []) {
  const at = ([x, z]) => new Vector3(x, ground.height(x, z), z);
  return list.flatMap(([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const point = t => [a[0] + ux * t, a[1] + uz * t];
    // Each gate as a distance along the run and from it.
    const cuts = gates.map(({ at: [x, z], width }) => ({ t: (x - a[0]) * ux + (z - a[1]) * uz, off: Math.abs((x - a[0]) * uz - (z - a[1]) * ux), half: width / 2 }))
      .filter(c => c.off < GATE_ON && c.t > c.half && c.t < len - c.half).sort((p, q) => p.t - q.t);
    const runs = [];
    let from = 0;
    for (const c of cuts) { runs.push([point(from), point(c.t - c.half)]); from = c.t + c.half; }
    runs.push([from ? point(from) : a, b]);
    return runs.map(([p, q]) => [at(p), at(q)]);
  });
}
const GATE_ON = 0.5;

// Segments in each quarter round: as a RoundedBoxGeometry of 2 segments.
const ROUND = 4;

// Points round a rectangle with round corners, half sizes a and b, corner radius r: [x, y, normal x,
// normal y], counter-clockwise.
function roundedRect(a, b, r) {
  const out = [];
  for (const [sx, sy, from] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]]) {
    for (let k = 0; k <= ROUND; k++) {
      const t = (from + k / ROUND) * Math.PI / 2, c = Math.cos(t), s = Math.sin(t);
      out.push([sx * (a - r) + r * c, sy * (b - r) + r * s, c, s]);
    }
  }
  return out;
}

// Indexed geometry from rows of [x, y, z, nx, ny, nz] that wrap round: a quad strip between each pair of
// rows, outward for rows that go up or along +x. No triangles of zero area (where a row closes to a point).
function rings(rows, extra = []) {
  const position = [], normal = [], index = [], n = rows[0].length;
  for (const row of rows) for (const [x, y, z, nx, ny, nz] of row) { position.push(x, y, z); normal.push(nx, ny, nz); }
  const same = (i, j) => [0, 1, 2].every(k => Math.abs(position[3 * i + k] - position[3 * j + k]) < 1e-6);
  const tri = (a, b, c) => { if (!same(a, b) && !same(b, c) && !same(c, a)) index.push(a, b, c); };
  for (let j = 0; j + 1 < rows.length; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + (i + 1) % n;
      tri(a, b, b + n);
      tri(a, b + n, a + n);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  g.setIndex(index.concat(extra));
  return g;
}

// A post: width w, height h, the four upright edges and the top edges round with radius r. No bottom: it
// stands in the grass. The same shape as a RoundedBoxGeometry of 2 segments, with no flat face split.
function roundedPost(w, h, r) {
  const ring = roundedRect(w / 2, w / 2, r);
  // Profile: up the side, then a quarter round over to the top.
  const profile = [[0, 0], ...Array.from({ length: ROUND + 1 }, (_, k) => [k / ROUND * Math.PI / 2, h - r])];
  const rows = profile.map(([t, y]) => ring.map(([x, z, nx, nz]) => {
    const c = Math.cos(t), s = Math.sin(t), cx = x - r * nx, cz = z - r * nz;
    return [cx + r * c * nx, y + r * s, -(cz + r * c * nz), c * nx, s, -c * nz];
  }));
  // Top: the last ring is the square between the four corner centres.
  const top = ROUND * ring.length + ring.length, q = ROUND + 1;
  return rings(rows, [top, top + q, top + 2 * q, top, top + 2 * q, top + 3 * q]);
}

// A rail: unit long along x, height h and depth d, the four long edges round with radius r. No ends: they
// are in the posts.
function roundedRail(h, d, r) {
  const ring = roundedRect(h / 2, d / 2, r);
  return rings([-0.5, 0.5].map(x => ring.map(([y, z, ny, nz]) => [x, y, z, 0, ny, nz])));
}

// One quad for each run, from the wire bottom to its top. uv: x along the run, y up, in units.
function wireGeometry(runs) {
  const { bottom, top } = FENCE.wire, position = [], uv = [], index = [];
  for (const [a, b] of runs) {
    const n = position.length / 3, len = a.distanceTo(b);
    for (const [p, u] of [[a, 0], [b, len]]) {
      position.push(p.x, p.y + bottom, p.z, p.x, p.y + top, p.z);
      uv.push(u, bottom, u, top);
    }
    index.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

export function wireMaterial(sun) {
  const { cell, width } = FENCE.wire, [lit, shade] = COLOURS.wire;
  return new ShaderMaterial({
    lights: true,
    side: DoubleSide,
    alphaToCoverage: true,
    uniforms: { ...lightUniforms(), uSun: { value: sun }, uLit: { value: lit }, uShade: { value: shade }, uSee: seeOn },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vec3(0, 1, 0));
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      ${SEE_THROUGH}
      uniform vec3 uLit, uShade;
      varying vec2 vUv;
      varying vec3 vWorld;
      // Cover of one set of diagonal wires, a in cells. Far away, where a cell is a few pixels, it
      // blends to the mean cover, so the mesh does not shimmer.
      float wires(float a) {
        float hw = ${f(width / 2)} / ${f(Math.min(...cell))}, w = max(fwidth(a), 1e-5);
        float d = abs(fract(a + 0.5) - 0.5);
        float line = 1.0 - smoothstep(hw - w, hw + w, d);
        return mix(line, min(3.0 * hw, 1.0), smoothstep(0.12, 0.35, w));
      }
      void main() {
        vec2 c = vUv / vec2(${f(cell[0])}, ${f(cell[1])});
        float cover = max(wires(c.x + c.y), wires(c.x - c.y)) * seeThrough(vWorld);
        if (cover < 0.02) discard;
        gl_FragColor = vec4(toonLit(uShade, uLit, sunShadow(), vec3(0.0, 1.0, 0.0)), cover);
        #include <colorspace_fragment>
      }`,
  });
}
