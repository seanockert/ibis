// The ibis as a bird for the shared code: the SDF view, the bake and the game shaders.
import model from '../sdf/model.glsl?raw';
import { MAT } from './materialIds.js';
import { SHAPE } from './rig.js';

export const IBIS = {
  name: 'ibis',
  model,
  shape: SHAPE,
  MAT,
  // Eyes, mirrored: the centre in head space (x on each side). Flattened, so the eye reads as a big disc
  // without bulging past the head. LID_OPEN: the top lid line, open. PUPIL_DIR: where the pupil is, eye
  // space: big pupils look forward along the bill. PUPIL_R: pupil size. For eye.glsl.
  eye: `
const vec3 EYE_C = vec3(0.095, 0.04, 0.0);
const vec3 EYE_R = vec3(0.07, 0.12, 0.12);
const float LID_OPEN = 0.115;
const vec3 PUPIL_DIR = vec3(0.55, 0.12, 0.83);
const float PUPIL_R = 0.14;
`,
  scarf: true,      // model.glsl has scarfUncarved()
  headGroup: 0,     // part group of the head, neck, eyes and lids (see PARTS in tools/bake/bake.js)
  solid: true,      // has a solid in the physics
  view: { dist: 6.2, target: [0, 1, 0.3] },   // the close camera of sdf.html and the fixed views
};
