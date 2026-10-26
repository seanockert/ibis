// The noisy miner as a bird for the shared code: the SDF view, the bake and the game shaders. It uses the
// ibis rig and motion with its own body shape. It is made at about the size of the ibis, and the game
// scales it down by MINER_SCALE.
import { Vector3 } from 'three';
import model from './model.glsl?raw';
import { MAT } from './materialIds.js';
import { SHAPE as IBIS_SHAPE } from '../ibis/rig.js';

export const MINER_SCALE = 0.36;   // a noisy miner is about a third of the height of an ibis

// Some values are copied in model.glsl: change both.
const SHAPE = {
  ...IBIS_SHAPE,
  pelvisY: 0.55,
  thigh: 0.27,
  shank: 0.29,
  wingFold: 0.65,
  wingTuck: 1.0,
  wingLevel: 1,
  neckBase: new Vector3(0.0, 0.70, 0.22),
  neckTipUp: new Vector3(0, 0.16, 0.02),
  neckTipDown: new Vector3(0, 0.30, 0.80),
  neckCtrlUp: new Vector3(0, 0.08, 0.0),
  neckCtrlDown: new Vector3(0, 0.20, 0.12),
  neckTipReach: new Vector3(0, 0.03, 0.30),
  neckCtrlReach: new Vector3(0, 0.05, 0.14),
  headScale: 1.18,
  shoulder: new Vector3(0.16, 0.58, 0.02),
  hip: new Vector3(0.17, 0.02, 0.0),
  toes: [0.24, 0.30, 0.24, 0.14],
  jawHinge: new Vector3(0, -0.05, 0.12),
  pitch: 0.32,
  headPitch: -0.30,
};

export const MINER = {
  name: 'miner',
  model,
  shape: SHAPE,
  MAT,
  eye: `
const vec3 EYE_C = vec3(0.100, 0.030, 0.05);
const vec3 EYE_R = vec3(0.078, 0.135, 0.135);
const float LID_OPEN = 0.16;
const vec3 PUPIL_DIR = vec3(0.62, 0.10, 0.78);
const float PUPIL_R = 0.10;
`,
  scarf: false,
  headGroup: 5,   // the dark hood gets a line where it meets the pale body
  solid: false,   // no solid in the physics yet
  view: { dist: 4.8, target: [0, 0.72, 0.25] },
};
