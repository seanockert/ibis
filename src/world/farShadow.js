// The far shadow: one sun shadow map of the plants over the whole level, drawn once. The sun's own map
// (stage.js) covers only an area round the camera; past it, sunShadow() (materials.js) takes the
// plants' shadows from this map, so a far tree keeps its shadow, at no cost each frame. The plants
// stand still in it, in the wind of time 0.
//
//   mesh.layers.enable(FAR_LAYER);                    // a mesh that casts into the far map (plants.js)
//   renderFarShadow(renderer, scene, sunDirection);   // after the level is built, and when the sun turns
import { Box3, DepthTexture, Matrix4, OrthographicCamera, Vector3, WebGLRenderTarget } from 'three';
import { FAR_SHADOW } from '../ibis/materials.js';
import { windDepthMaterial } from './wind.js';

export const FAR_LAYER = 5;
const SIZE = 2048;     // map size: about 0.04 units a texel over the street's plants
const MARGIN = 1;      // added round the casters' box, units
const BIAS = 0.15;     // a receiver is this much nearer the sun for the depth test, units
let target = null;

// sun: the unit direction to the sun.
export function renderFarShadow(renderer, scene, sun) {
  scene.updateMatrixWorld();
  const camera = new OrthographicCamera();
  camera.lookAt(sun.clone().negate());
  camera.updateMatrixWorld();
  // The box of the casters in the sun's view.
  const box = new Box3(), part = new Box3();
  scene.traverse(o => {
    if (!o.isMesh || !o.layers.isEnabled(FAR_LAYER)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
  });
  if (box.isEmpty()) return;
  box.expandByScalar(MARGIN);
  Object.assign(camera, { left: box.min.x, right: box.max.x, bottom: box.min.y, top: box.max.y, near: -box.max.z, far: -box.min.z });
  camera.updateProjectionMatrix();
  camera.layers.set(FAR_LAYER);

  target ??= new WebGLRenderTarget(SIZE, SIZE, { depthTexture: new DepthTexture(SIZE, SIZE) });
  const saved = { target: renderer.getRenderTarget(), override: scene.overrideMaterial, auto: renderer.shadowMap.autoUpdate };
  scene.overrideMaterial = windDepthMaterial();
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(saved.target);
  scene.overrideMaterial = saved.override;
  renderer.shadowMap.autoUpdate = saved.auto;

  // World to the map: x, y and depth in [0, 1], with the receiver moved BIAS toward the sun.
  const toMap = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  FAR_SHADOW.matrix.value.copy(toMap).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
    .multiply(new Matrix4().makeTranslation(new Vector3().copy(sun).multiplyScalar(BIAS)));
  FAR_SHADOW.map.value = target.depthTexture;
  FAR_SHADOW.on.value = true;
}
