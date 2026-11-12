// Ibis character for three.js: the baked mesh (public/ibis.glb), toon materials with an outline, and a
// Character (src/ibis/motion/) that moves it and drives the bones through src/ibis/rig.js.
//
//   const asset = await loadIbis(IBIS);   // a bird from src/birds.js: its mesh is public/<name>.glb
//   const ibis = new Ibis(asset);
//   scene.add(ibis.object);
//   ibis.input.move.set(0, 1);   // walk toward +z. ibis.input.fast, ibis.input.jump
//   ibis.act('happy');
//   ibis.update(dt);   // every frame
import {
  AlwaysStencilFunc, BufferGeometry, Color, Float32BufferAttribute, KeepStencilOp, NotEqualStencilFunc, ReplaceStencilOp,
  Ray, Sphere, SkinnedMesh, Uint16BufferAttribute, Vector3, Vector4,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bodyMaterial, hullMaterial, lineMaterial, sharedUniforms } from './materials.js';
import { Character } from './motion/character.js';
import { BONES, bindPose, boneMatrices, rigUniforms, solveRig } from './rig.js';

export { ACTIONS } from './motion/actions.js';

// _group values, see tools/bake/bake.js.
const TORSO_GROUP = 0;
const WING_GROUP = 2;
const SCARF_GROUP = 4;

// Holds the character in every pose, character space, from the pelvis. Used for frustum culling.
const BOUND_OFFSET = new Vector3(0, 0.42, 0.3);
const BOUND_R = 1.9;

// Loads the mesh of a bird (src/birds.js) once. Every Ibis made from the asset shares its geometry and
// the shared uniforms (the sun direction). Pass the uniforms of another asset to share them.
export async function loadIbis(bird, uniforms = sharedUniforms()) {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/${bird.name}.glb`);
  let body;
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) body = o; });
  const palette = body.userData.palette;
  groupByPart(body.geometry);
  return {
    bird,
    neckLengths: bindPose(bird.shape).neckLengths,
    scene: gltf.scene,
    palette,
    lineGeometry: borderLines(body.geometry, palette),
    uniforms,
    sun: uniforms.uSun.value,   // toward the sun, world space. Copy a new direction into it.
  };
}

export class Ibis {
  // scale: the size of the bird in the world. The motion is in character units, so a scaled bird that
  // walks takes steps that are too short for its speed.
  constructor(asset, { seed = 0, scale = 1 } = {}) {
    this.bird = asset.bird;
    this.neckLengths = asset.neckLengths;
    this.object = cloneSkinned(asset.scene);
    this.object.scale.setScalar(scale);
    this.object.traverse(o => { if (o.isSkinnedMesh) this.body = o; });
    const byName = Object.fromEntries(this.body.skeleton.bones.map(b => [b.name, b]));
    this.bones = BONES.map(name => byName[name]);

    // Each part group draws its stencil value, and the inner outline of a group draws only where the
    // stencil holds a different group.
    const body = bodyMaterial(asset.palette, asset.uniforms, this.bird);
    this.uniforms = body.uniforms;
    // Materials by part group (_group): a missing group leaves a gap, not a shift.
    const byGroup = make => { const out = []; for (const g of this.body.geometry.groups) out[g.materialIndex] = make(g.materialIndex); return out; };
    this.body.material = byGroup(i => stencilled(body, i + 1, AlwaysStencilFunc, ReplaceStencilOp));
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    // The contours of the wings and the scarf do not draw over the torso (stencil 1): the body shader
    // draws their lines there instead.
    const contour = hullMaterial(asset.palette, asset.uniforms, body, 'contour', this.bird);
    // One material for each group (shared uniforms), so showOnly() can hide a group.
    this.contour = this.attach(this.body.geometry, byGroup(i =>
      i === WING_GROUP || i === SCARF_GROUP ? stencilled(contour, TORSO_GROUP + 1, NotEqualStencilFunc, KeepStencilOp) : sharing(contour)));
    this.contour.renderOrder = 1;   // after every body has drawn its stencil
    this.glowUniform = contour.uniforms.uGlow;
    // skinIndex counts the skeleton's bones. -1 where a bake has no scarf ends.
    const bone = name => this.body.skeleton.bones.indexOf(byName[name]);
    contour.uniforms.uScarfBones.value.set(bone('scarfR'), bone('scarfL'));
    this.scarfSwing = contour.uniforms.uScarfSwing.value;
    const inner = hullMaterial(asset.palette, asset.uniforms, body, 'inner', this.bird);
    this.inner = this.attach(this.body.geometry, byGroup(i => stencilled(inner, i + 1, NotEqualStencilFunc, KeepStencilOp)));
    this.inner.renderOrder = 1;   // after every body has drawn its stencil
    // The wings and the scarf get their inner lines from the SDF test in the body shader instead.
    for (const g of [WING_GROUP, SCARF_GROUP]) if (this.inner.material[g]) this.inner.material[g].visible = false;
    this.lines = this.attach(asset.lineGeometry, lineMaterial(asset.uniforms, body));
    this.meshes = [this.body, this.contour, this.inner, this.lines];
    this.shown = this.meshes.slice(0, 3).map(m => m.material.map(x => x?.visible));   // for showOnly()
    const viewport = new Vector4();
    for (const mesh of this.meshes) {
      mesh.boundingSphere = new Sphere(BOUND_OFFSET.clone(), BOUND_R);
      mesh.onBeforeRender = renderer => { asset.uniforms.uViewHeight.value = renderer.getCurrentViewport(viewport).w; };
    }

    this.character = new Character({ seed });
    this.inPlace = false;   // true: the character moves on the spot, and object keeps its transform
    this.update(0);
  }

  // Draws only the part groups in groups (the _group values of tools/bake/bake.js: 3 is the legs), with
  // no border lines. null: all, as made. A bird in a disguise shows only its legs (disguise.js).
  showOnly(groups) {
    this.meshes.slice(0, 3).forEach((m, k) => m.material.forEach((x, i) => { if (x) x.visible = this.shown[k][i] && (!groups || groups.includes(i)); }));
    this.lines.visible = !groups;
  }

  // A second skinned mesh on the same skeleton.
  attach(geometry, material) {
    const mesh = new SkinnedMesh(geometry, material);
    mesh.bind(this.body.skeleton, this.body.bindMatrix);
    this.body.parent.add(mesh);
    return mesh;
  }

  get input() { return this.character.input; }

  // Plays an action by name (see ACTIONS in motion/actions.js).
  act(name, options) { this.character.act(name, options); }

  // Steps the character and poses the mesh. The object follows the character's position and heading.
  update(dt) {
    this.setPose(this.character.update(Math.max(dt, 1e-4)));
    if (this.inPlace) return;
    const c = this.character;
    this.object.position.set(c.position.x, 0, c.position.z);
    this.object.rotation.set(0, c.heading, 0);
  }

  // Poses the character directly. Takes a Pose from rig.js.
  setPose(pose) {
    const rig = solveRig(pose, this.bird.shape);
    this.rig = rig;
    boneMatrices(rig, this.neckLengths, this.bird.shape).forEach((m, i) => {
      const b = this.bones[i];
      if (b) m.decompose(b.position, b.quaternion, b.scale);   // an older bake has no later bones
    });
    for (const [name, value] of Object.entries(rigUniforms(rig))) this.uniforms[name].value = value;
    // A swung scarf end stands off the chest: its contour hull draws over the torso too, as it does over
    // the background. At rest the body shader draws that line (overLine() in materials.js).
    const swing = v => Math.max(Math.abs(v.x), Math.abs(v.y));
    this.scarfSwing.set(swing(pose.scarfR), swing(pose.scarfL));
    const scarfContour = this.contour.material[SCARF_GROUP];
    if (scarfContour) scarfContour.stencilFunc = rig.scarfSwing > 0 ? AlwaysStencilFunc : NotEqualStencilFunc;
    for (const mesh of this.meshes) mesh.boundingSphere.center.copy(rig.pelvis).add(BOUND_OFFSET);
  }

  // Distance along a world ray to the body or the head, or null on a miss. Two spheres stand in for the
  // mesh: enough for a click, and cheap.
  hit(ray) {
    const local = new Ray().copy(ray).applyMatrix4(this.object.matrixWorld.clone().invert());
    const scale = this.object.matrixWorld.getMaxScaleOnAxis();
    const R = this.rig;
    const spheres = [new Sphere(R.pelvis.clone().add(new Vector3(0, 0.25, 0.05)), 0.5), new Sphere(R.head, 0.3)];
    let best = null;
    for (const s of spheres) {
      const p = local.intersectSphere(s, new Vector3());
      if (p) { const d = p.distanceTo(local.origin) * scale; if (best === null || d < best) best = d; }
    }
    return best;
  }

  // A prod (a click or a tap) at a world point.
  prod(point) { this.character.prod(this.object.worldToLocal(point.clone())); }

  // A blow from a diving bird at a world point.
  strike(point) { this.character.strike(this.object.worldToLocal(point.clone())); }

  // Mud from 0 (clean) to 1 (mud up to the belly), with splashes above the mud line.
  // 0 to 1: the contour goes white and wider, as a highlight (a miner that a peck would snap at).
  get glow() { return this.glowUniform.value; }
  set glow(value) { this.glowUniform.value = value; }

  // Bulge i (0 to BULGES - 1, materials.js): the surface goes out round a capsule from a to b (character
  // space) of radius r, by k (0 off, 1 full), so it wraps what the bird swallows.
  bulge(i, a, b, r, k) {
    this.uniforms.uBulgeA.value[i].set(a.x, a.y, a.z, r);
    this.uniforms.uBulgeB.value[i].set(b.x, b.y, b.z, k);
  }

  get mud() { return this.uniforms.uMud.value; }
  set mud(value) { this.uniforms.uMud.value = value; }

  // Wet from 0 (dry) to 1 (soaked): darker feathers, streaks and a hard highlight.
  get wet() { return this.uniforms.uWet.value; }
  set wet(value) { this.uniforms.uWet.value = value; }

  dispose() {
    for (const mesh of this.meshes) [mesh.material].flat().forEach(m => m.dispose());
  }
}

// A copy of material that shares its uniforms.
function sharing(material) {
  const m = material.clone();
  m.uniforms = material.uniforms;
  return m;
}

// A copy of material that shares its uniforms, with a stencil test and write. ref is the part group.
function stencilled(material, ref, func, op) {
  const m = material.clone();
  m.uniforms = material.uniforms;
  Object.assign(m, { stencilWrite: true, stencilRef: ref, stencilFunc: func, stencilZPass: op });
  return m;
}

// Sorts the triangles by part group (the _group attribute) and adds one geometry group for each, with
// the part group as its material index.
function groupByPart(geometry) {
  const part = geometry.attributes._group, index = geometry.index.array;
  const tris = Array.from({ length: index.length / 3 }, (_, t) => t);
  tris.sort((a, b) => part.getX(index[a * 3]) - part.getX(index[b * 3]));
  const sorted = new index.constructor(index.length);
  tris.forEach((t, i) => sorted.set(index.subarray(t * 3, t * 3 + 3), i * 3));
  geometry.index.array.set(sorted);
  geometry.clearGroups();
  let start = 0;
  for (let i = 1; i <= tris.length; i++) {
    if (i === tris.length || part.getX(sorted[i * 3]) !== part.getX(sorted[start * 3])) {
      geometry.addGroup(start * 3, (i - start) * 3, part.getX(sorted[start * 3]));
      start = i;
    }
  }
}

// One quad per mesh edge where two materials meet. The mesh has a separate vertex on each side of a
// material border, so vertices are matched by position.
function borderLines(geometry, palette) {
  const pos = geometry.attributes.position, mat = geometry.attributes._mat;
  const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
  const index = geometry.index.array;
  const firstAt = new Map(), canon = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].map(x => Math.round(x * 1e5)).join(',');
    if (!firstAt.has(key)) firstAt.set(key, i);
    canon[i] = firstAt.get(key);
  }
  const edges = new Map();
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = canon[index[t + e]], b = canon[index[t + (e + 1) % 3]];
      const key = a < b ? a * pos.count + b : b * pos.count + a;
      if (!edges.has(key)) edges.set(key, { a, b, mats: new Set() });
      edges.get(key).mats.add(Math.round(mat.getX(index[t])));
    }
  }
  // Line colour: the darker line colour of the materials that meet.
  const lineColor = mats => {
    const cs = [...mats].map(id => new Color().setRGB(...palette[id].line, 'srgb'));
    return cs.reduce((best, c) => (c.getHSL({}).l < best.getHSL({}).l ? c : best));
  };
  const a = { position: [], other: [], skinIndex: [], skinWeight: [], skinIndexOther: [], skinWeightOther: [], corner: [], lineColor: [] };
  const lineIndex = [];
  const push = (self, other, end, side, color) => {
    a.position.push(pos.getX(self), pos.getY(self), pos.getZ(self));
    a.other.push(pos.getX(other), pos.getY(other), pos.getZ(other));
    for (const [attr, src, v] of [['skinIndex', skinIndex, self], ['skinWeight', skinWeight, self], ['skinIndexOther', skinIndex, other], ['skinWeightOther', skinWeight, other]]) {
      a[attr].push(src.getX(v), src.getY(v), src.getZ(v), src.getW(v));
    }
    a.corner.push(end, side);
    a.lineColor.push(color.r, color.g, color.b);
  };
  for (const { a: va, b: vb, mats } of edges.values()) {
    if (mats.size < 2) continue;
    const color = lineColor(mats);
    const base = a.corner.length / 2;
    push(va, vb, 0, -1, color); push(va, vb, 0, 1, color);
    push(vb, va, 1, -1, color); push(vb, va, 1, 1, color);
    lineIndex.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(a.position, 3));
  g.setAttribute('other', new Float32BufferAttribute(a.other, 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(a.skinIndex, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(a.skinWeight, 4));
  g.setAttribute('skinIndexOther', new Uint16BufferAttribute(a.skinIndexOther, 4));
  g.setAttribute('skinWeightOther', new Float32BufferAttribute(a.skinWeightOther, 4));
  g.setAttribute('corner', new Float32BufferAttribute(a.corner, 2));
  g.setAttribute('lineColor', new Float32BufferAttribute(a.lineColor, 3));
  g.setIndex(lineIndex);
  return g;
}
