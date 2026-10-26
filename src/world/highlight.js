// A thick white outline round the prop that a peck would pick up now, so the player can see what the
// bill can take before the peck. Physics.target() picks the prop; the prop gives its outline geometry
// and world matrix (hull(id)).
//
//   const highlight = new Highlight(asset.uniforms);
//   scene.add(highlight.object);
//   highlight.update(props, physics.target(ibis));   // every frame, after the props update
//
// Draws of the prop's outline geometry, after the opaque scene and before the glass (renderOrder in the
// transparent list). A mask, no colour: the prop's front faces (all of them, with no depth test: a label
// in front of the glass hid it) and its dark line where it shows (the hull at the line width) write
// HIGHLIGHT.stencil. Then the white: the inverted hull, a band wider than the dark line, only outside
// the mask, so it never covers the prop or its line, and its back faces don't show through the prop's
// own glass. It takes the depth of the front of the prop's bounding sphere: at the depth of the
// back faces, the ground in front of a prop that lies on it covered the white below the prop. It writes
// depth, so the glass of a bottle behind does not draw over it, and a bottle in front tints it.
import { AlwaysStencilFunc, FrontSide, Group, Mesh, MeshBasicMaterial, NotEqualStencilFunc, ReplaceStencilOp, Sphere } from 'three';
import { outlineMaterial } from './props.js';
import { srgb } from './util.js';

// colour: sRGB. screen: the width past the dark line, a part of the view height (about 5 px at 800). stencil: the mask
// value, above the ibis's (1 to 5) and the glass's (8).
export const HIGHLIGHT = { colour: srgb(1, 1, 1), screen: 0.006, stencil: 9 };

export class Highlight {
  constructor(shared) {
    const mask = {
      colorWrite: false, depthWrite: false, transparent: true,
      stencilWrite: true, stencilRef: HIGHLIGHT.stencil, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp,
    };
    const faces = new MeshBasicMaterial({ side: FrontSide, depthTest: false, ...mask });
    const line = Object.assign(outlineMaterial(HIGHLIGHT.colour, shared), mask);
    this.white = Object.assign(outlineMaterial(HIGHLIGHT.colour, shared, { screen: HIGHLIGHT.screen, front: true }), {
      transparent: true, stencilWrite: true, stencilRef: HIGHLIGHT.stencil, stencilFunc: NotEqualStencilFunc,
    });
    this.meshes = [faces, line, this.white].map((material, i) => {
      const mesh = new Mesh(undefined, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = i < 2 ? 2 : 2.5;   // the mask, then the white, before the glass (3)
      return mesh;
    });
    this.sphere = new Sphere();
    this.object = new Group().add(...this.meshes);
    this.object.visible = false;
  }

  // props: each may have hull(id) → { geometry, matrix } or null. id: the prop body to outline, or null.
  update(props, id) {
    const hull = id === null ? null : props.reduce((found, p) => found ?? p.hull?.(id) ?? null, null);
    this.object.visible = !!hull;
    if (!hull) return;
    for (const mesh of this.meshes) {
      mesh.geometry = hull.geometry;
      mesh.matrix.copy(hull.matrix);
      mesh.matrixWorldNeedsUpdate = true;
    }
    if (!hull.geometry.boundingSphere) hull.geometry.computeBoundingSphere();
    const { center, radius } = this.sphere.copy(hull.geometry.boundingSphere).applyMatrix4(hull.matrix);
    this.white.uniforms.uFront.value.set(center.x, center.y, center.z, radius);
  }
}
