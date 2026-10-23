// A low front fence round the play area: white posts, a white top rail between them, and a chain wire
// mesh below, as on an Australian suburban front yard (or in Bluey). The same toon look as the props: a
// lit and a shade colour and an outline. Only along the yard edges of the two footpaths: the ends of the
// play area have no fence (the bounds and the physics fence stop the bird and the props there).
//
//   const fence = new Fence(asset, physics);   // physics optional: a solid wall for the props
//   scene.add(fence.object);
//
// Posts and rails are instanced (one draw each, and one for each outline). The wire is one mesh of flat
// quads, a diamond pattern in the shader with alphaToCoverage (soft edges with the multisampled target
// of grade.js, no sorting). Far away, where a diamond is a few pixels, the lines blend to a flat tint.
import { Color, DoubleSide, Float32BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { lightUniforms, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { outlineMaterial, smoothNormals, toonMaterial } from './props.js';
import { PLAY, streetHeight } from './street.js';

const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');

// Sizes in units: the bird is 2 tall (about 70 cm), so 1 unit is about 35 cm. A real front fence is about
// 1.2 m (3.4 units); this one is a little lower, as the rest of the street. The posts are higher than the
// bird's flutter (2.0), so it can't jump over. out: the fence line, this far outside PLAY (the physics
// fence for light props is 0.5 outside it, so a ball stops at the posts). post: width, height. rail:
// height of its top, height, depth. wire: bottom and top height; cell: diamond width and height (larger
// than real chain wire, as in a cartoon); width: line.
export const FENCE = {
  out: 0.6, spacing: 5,
  post: [0.26, 3.2], rail: [2.9, 0.22, 0.13],
  wire: { bottom: 0.06, top: 2.7, cell: [0.32, 0.44], width: 0.04 },
  solid: 0.2,   // thickness of the wall in the physics
};
// lit, shade, line. White posts with a warm tan line, as the reference; blue-grey wire.
const COLOURS = {
  post: [srgb(0.98, 0.97, 0.94), srgb(0.74, 0.73, 0.86), srgb(0.52, 0.43, 0.30)],
  wire: [srgb(0.66, 0.73, 0.80), srgb(0.47, 0.53, 0.68)],
};

export class Fence {
  constructor(asset, physics = null) {
    const runs = fenceRuns();
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
    const instanced = (geometry, list, matrix) => {
      geometry.setAttribute('_outline', smoothNormals(geometry));
      const meshes = [new InstancedMesh(geometry, toonMaterial(lit, shade, asset.uniforms), list.length), new InstancedMesh(geometry, outlineMaterial(line, asset.uniforms), list.length)];
      list.forEach((item, i) => { const m = matrix(item); for (const mesh of meshes) mesh.setMatrixAt(i, m); });
      meshes[0].castShadow = meshes[0].receiveShadow = true;
      for (const mesh of meshes) mesh.frustumCulled = false;
      return meshes;
    };
    const postGeometry = new RoundedBoxGeometry(pw, ph, pw, 2, 0.06).translate(0, ph / 2, 0);
    const q = new Quaternion(), up = new Vector3(0, 1, 0);
    const postMeshes = instanced(postGeometry, fencePosts(), p => new Matrix4().setPosition(p));
    // Rails: a unit long box, stretched to the gap between two posts.
    const railGeometry = new RoundedBoxGeometry(1, rh, rd, 2, 0.05).translate(0, railTop - rh / 2, 0);
    const railMeshes = instanced(railGeometry, rails, ([a, b]) => {
      q.setFromAxisAngle(up, Math.atan2(a.z - b.z, b.x - a.x));
      return new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(a.distanceTo(b) - pw + 0.02, 1, 1));
    });
    this.wire = new Mesh(wireGeometry(runs), wireMaterial(asset.sun));
    this.wire.receiveShadow = true;
    this.wire.frustumCulled = false;
    this.object = postMeshes[0];
    this.object.add(postMeshes[1], ...railMeshes, this.wire);
  }
}

const postCount = (a, b) => Math.max(1, Math.round(a.distanceTo(b) / FENCE.spacing));

// Post places: at the ends of each run and spaced along it. Corners are shared. The tufts (tufts.js) grow
// round them.
export function fencePosts() {
  const posts = new Map();
  for (const [a, b] of fenceRuns()) {
    const n = postCount(a, b);
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      posts.set(`${p.x.toFixed(2)},${p.z.toFixed(2)}`, p);
    }
  }
  return [...posts.values()];
}

// Straight runs [a, b] on the ground: the near and far sides, along the yard edges.
function fenceRuns() {
  const { out } = FENCE, x0 = PLAY.x[0] - out, x1 = PLAY.x[1] + out, z0 = PLAY.z[0] - out, z1 = PLAY.z[1] + out;
  const at = (x, z) => new Vector3(x, streetHeight(z), z);
  return [[at(x0, z1), at(x1, z1)], [at(x0, z0), at(x1, z0)]];
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

function wireMaterial(sun) {
  const f = v => v.toFixed(3);
  const { cell, width } = FENCE.wire, [lit, shade] = COLOURS.wire;
  return new ShaderMaterial({
    lights: true,
    side: DoubleSide,
    alphaToCoverage: true,
    uniforms: { ...lightUniforms(), uSun: { value: sun }, uLit: { value: lit }, uShade: { value: shade } },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vec3(0, 1, 0));
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      uniform vec3 uLit, uShade;
      varying vec2 vUv;
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
        float cover = max(wires(c.x + c.y), wires(c.x - c.y));
        if (cover < 0.02) discard;
        gl_FragColor = vec4(mix(uShade, uLit, sunShadow()), cover);
        #include <colorspace_fragment>
      }`,
  });
}
