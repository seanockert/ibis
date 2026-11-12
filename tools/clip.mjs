// Finds poses where the bird goes through itself: for each move of MOVES (src/moves.js), it runs the
// script for 4 s at 60 steps per second and measures how deep the head and the bill go into the body,
// the lower legs into the body, and the head into the ground. Shapes from src/sdf/model.glsl.
// No browser. Usage: node tools/clip.mjs [N ...]   (N: move numbers, as anim=N; none: all moves)
// CLIP_LOG=1 also prints each frame that clips.
import { Vector3 } from 'three';
import { MOVES, startMove } from '../src/moves.js';
import { Character } from '../src/ibis/motion/character.js';
import { HEAD_SCALE, solveRig } from '../src/ibis/rig.js';

const TOLERANCE = 0.02;   // units: less than this is not a clip
// body() in model.glsl: ellipsoids in body space, [centre, radii].
const BODY = [[[0, 0.20, -0.06], [0.37, 0.43, 0.44]], [[0, 0.56, 0.12], [0.23, 0.30, 0.27]], [[0, 0.30, -0.32], [0.22, 0.26, 0.26]]];
// skullBill() in model.glsl: the skull, and the upper bill (a curve A, B, C, radius 0.10 to 0.014). Head space.
const A = new Vector3(0, -0.01, 0.10), B = new Vector3(0, 0, 0.58), C = new Vector3(0, -0.42, 0.86);
const quad = t => A.clone().multiplyScalar((1 - t) ** 2).addScaledVector(B, 2 * t * (1 - t)).addScaledVector(C, t * t);
const HEAD = [[new Vector3(0, 0.02, -0.03), 0.14], ...Array.from({ length: 8 }, (_, i) => [quad((i + 1) / 9), 0.10 - 0.086 * (i + 1) / 9])];
const SHANK = 0.04;   // the lower leg's radius

const ellipsoid = (q, [c, r]) => (Math.hypot((q.x - c[0]) / r[0], (q.y - c[1]) / r[1], (q.z - c[2]) / r[2]) - 1) * Math.min(...r);
const body = q => Math.min(...BODY.map(e => ellipsoid(q, e)));

const only = process.argv.slice(2).map(Number);
for (let i = 0; i < MOVES.length; i++) {
  if (only.length && !only.includes(i + 1)) continue;
  const c = new Character({ seed: i }), run = startMove(c, i), worst = {};
  const note = (depth, part, t) => {
    if (depth <= TOLERANCE) return;
    if (process.env.CLIP_LOG) console.log(`    ${t.toFixed(2)} ${part} ${depth.toFixed(2)}`);
    if (depth > (worst[part]?.depth ?? 0)) worst[part] = { depth, t };
  };
  for (let t = 0; t < 4; t += 1 / 60) {
    run(c, t);
    c.update(1 / 60);
    const R = solveRig(c.pose), inverse = R.body.clone().invert();   // not a transpose: the squash scales it
    const inBody = p => body(p.clone().sub(R.pelvis).applyMatrix4(inverse));
    for (const [h, r] of HEAD) {
      const p = h.clone().multiplyScalar(HEAD_SCALE).applyMatrix4(R.headRot).add(R.head);
      note(r * HEAD_SCALE - inBody(p), 'head in body', t);
      note(r * HEAD_SCALE * 0.5 - p.y, 'head in ground', t);
    }
    // From a third of the way down (above it, the thigh blends into the body) to the foot.
    for (const [knee, foot, side] of [[R.kneeL, R.footL, 'left'], [R.kneeR, R.footR, 'right']])
      for (let k = 0.3; k <= 1; k += 0.14) note(SHANK - inBody(knee.clone().lerp(foot, k)), `${side} leg in body`, t);
  }
  const out = Object.entries(worst).map(([part, w]) => `${part} ${w.depth.toFixed(2)} at t=${w.t.toFixed(2)}`).join(', ');
  console.log(String(i + 1).padStart(2), MOVES[i].name.padEnd(14), out || 'ok');
}
