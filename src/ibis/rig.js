// Ibis rig: a Pose, the authored clips, and the solve from a Pose to joint positions and bone matrices.
// Procedural motion (gait, jump, actions, expressions) is in src/ibis/motion/. It makes Poses too.
// This is the one source of the animation. The game, the SDF view (sdf.html) and the bake all use it.
// Character space: y up, +z toward the beak, feet on y = 0.
import { Matrix3, Matrix4, Quaternion, Vector2, Vector3, Vector4 } from 'three';
import { TAU, clamp, mix, smoothstep } from './motion/spring.js';

// Body shape: the sizes the solve uses. Other species have their own (src/miner/bird.js). Some values
// are copied in model.glsl: change both.
export const SHAPE = {
  pelvisY: 0.58,
  thigh: 0.30,
  shank: 0.31,
  wingFold: 0.50,
  wingTuck: 0.70,   // folded wings roll about their long axis to face back
  wingLevel: 0,     // 1: an open wing turns against the body pitch, so its chord stays level
  neckBase: new Vector3(0.0, 0.72, 0.20),   // body space
  nape: new Vector3(0.0, -0.06, -0.08),     // head space: the neck joins the back of the skull here
  // Neck end (the nape) and Bezier control point, upright and reaching down. Offsets from the neck base,
  // except neckTipDown, which is in character space, above the lift.
  neckTipUp: new Vector3(0, 0.40, 0.0),
  neckTipDown: new Vector3(0, 1.12, 1.30),
  neckCtrlUp: new Vector3(0, 0.30, -0.10),
  neckCtrlDown: new Vector3(0, 0.30, 0.15),
  // Neck held straight out in front, head low (a goose hiss). Offsets from the neck base.
  neckTipReach: new Vector3(0, 0.06, 0.58),
  neckCtrlReach: new Vector3(0, 0.10, 0.28),
  headScale: 1.12,
  shoulder: new Vector3(0.20, 0.60, -0.04),   // body space, left side
  hip: new Vector3(0.20, 0.04, 0.0),          // body space, left side
  toes: [0.34, 0.42, 0.34, 0.20],             // toe lengths from the ankle, as toeDir()
  jawHinge: new Vector3(0, -0.07, 0.10),      // head space, before headScale
  pitch: 0,       // added to the Pose's body pitch
  headPitch: 0,   // added to the Pose's head pitch
};
export const HEAD_SCALE = SHAPE.headScale;
export const NECK_BONES = 8;

const fract = x => x - Math.floor(x);
const rotX = a => new Matrix4().makeRotationX(a);
const rotY = a => new Matrix4().makeRotationY(a);
const rotZ = a => new Matrix4().makeRotationZ(a);
const mul = (...ms) => ms.reduce((a, b) => a.multiply(b), new Matrix4());

// ---- pose ----
export function restPose() {
  return {
    bob: 0, pitch: 0.15, roll: 0, yaw: 0,   // pelvis height offset and body rotation
    x: 0, z: 0,                             // pelvis offset on the ground: sway and lurch
    lift: 0,                                // height above the ground: moves the pelvis and the feet
    footL: new Vector3(0.25, 0.05, 0.06),   // IK foot targets, character space, relative to lift
    footR: new Vector3(-0.25, 0.05, 0.06),
    splay: 0,                               // toes turn out, radians
    footYawL: 0, footYawR: 0,               // foot turn about y, radians: a planted foot keeps its heading
    floorL: 0, floorR: 0,                   // ground height under each foot, from the root: steps and slopes
    slopeL: new Vector3(0, 1, 0),           // ground normal under each foot, character space: the foot
    slopeR: new Vector3(0, 1, 0),           // and the toes lie on it
    air: 0,                                 // height of the root above the ground: the toes curl in the air
    neck: 0,                                // 0 upright, 1 reaching to the ground
    reach: 0,                               // 1 neck straight out in front
    stretch: 1,                             // neck length: less than 1 squashes the head into the body
    headPitch: 0.12, headYaw: 0, headRoll: 0, headFwd: 0,
    jaw: 0, blink: 0,                       // blink 1 = happy closed eyes
    lid: 0, lidTilt: 0, lowLid: 0, pupil: 1,  // top lid (less than 0 wide), angry tilt, lower lid, pupil size
    wingL: 0, wingR: 0,                     // wing spread, radians
    sweepL: 0, sweepR: 0,                   // wings swing forward (more than 0) or back, radians
    look: new Vector2(0, 0),                // pupil offset
  };
}

export function mixPose(a, b, k) {
  const P = {};
  for (const key in a) {
    P[key] = typeof a[key] === 'number' ? mix(a[key], b[key], k) : a[key].clone().lerp(b[key], k);
  }
  return P;
}

// ---- clips ----
// Authored clips: pose from time. src/ibis/motion/ plays them as the idle base and as actions, and adds the
// blinks.
function idleClip(t) {
  const P = restPose();
  P.bob = 0.012 * Math.sin(t * 2.4);
  P.pitch += 0.02 * Math.sin(t * 2.4);
  P.headYaw = 0.45 * (smoothstep(0.2, 0.5, fract(t * 0.25)) - smoothstep(0.7, 0.95, fract(t * 0.25)));
  P.headPitch += 0.06 * Math.sin(t * 1.3);
  P.look.set(0.35 * Math.sin(t * 0.8), 0.1);
  P.wingL = P.wingR = 0.03 + 0.02 * Math.sin(t * 2.4);
  return P;
}

function peckClip(t) {
  const P = restPose();
  const c = fract(t * 1.2);
  const jab = smoothstep(0.0, 0.12, c) * (1.0 - smoothstep(0.2, 0.55, c));
  P.pitch = 0.75;
  P.bob = -0.06;
  P.footL.set(0.25, 0.05, 0.02);
  P.footR.set(-0.25, 0.05, 0.10);
  P.neck = 0.8 + 0.2 * jab;
  P.headPitch = 0.8 + 0.25 * jab;
  P.headYaw = 0.12 * Math.sin(t * 1.7);
  P.jaw = 0.12 * jab;
  P.wingL = P.wingR = 0.06;
  P.look.set(0, -0.35);
  return P;
}

function squawkClip(t) {
  const P = restPose();
  const beat = Math.sin(t * TAU * 2.0);
  P.pitch = -0.05;
  P.bob = 0.02 * Math.abs(beat);
  P.headPitch = -0.6 + 0.08 * beat;
  P.headFwd = -0.05;
  P.jaw = 0.42 + 0.1 * beat;
  P.blink = 1.0;
  P.wingL = P.wingR = 0.28 + 0.12 * Math.abs(beat);
  return P;
}

const clipFns = { idle: idleClip, peck: peckClip, squawk: squawkClip };

export function clipPose(name, t) { return clipFns[name](t); }

// ---- solve ----
// Two-bone IK: the middle joint for root a, end c and bone lengths l1, l2, bent toward pole.
function solveJoint(a, c, l1, l2, pole) {
  const ac = c.clone().sub(a);
  const len = ac.length();
  const dir = ac.divideScalar(Math.max(len, 1e-4));
  const d = clamp(len, 0.01, l1 + l2 - 0.001);
  const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  const side = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return a.clone().addScaledVector(dir, x).addScaledVector(side, h);
}

const at = (m, x, y, z) => new Vector3(x, y, z).applyMatrix4(m);

// Joint positions and part rotations for a Pose. Same values as the g* uniforms in model.glsl,
// with rotations in place of their inverses.
export function solveRig(P, S = SHAPE) {
  const R = {};
  R.pelvis = new Vector3(P.x, S.pelvisY + P.bob + P.lift, P.z);
  R.body = mul(rotY(P.yaw), rotZ(P.roll), rotX(P.pitch + S.pitch));
  const toBody = (x, y, z) => at(R.body, x, y, z).add(R.pelvis);

  // The neck runs from its base to the nape, and the head turns about the nape.
  R.neckBase = toBody(S.neckBase.x, S.neckBase.y, S.neckBase.z);
  const tipUp = R.neckBase.clone().addScaledVector(S.neckTipUp, P.stretch).add(new Vector3(0, 0, P.headFwd));
  // The peck reaches down to the level the bird stands on (lift), as the feet do, not to y = 0.
  R.neckTip = tipUp.lerp(S.neckTipDown.clone().setY(S.neckTipDown.y + P.lift), P.neck);
  R.neckCtrl = R.neckBase.clone().add(S.neckCtrlUp.clone().multiplyScalar(P.stretch).lerp(S.neckCtrlDown, P.neck));
  if (P.reach > 0) {
    R.neckTip.lerp(R.neckBase.clone().add(S.neckTipReach), P.reach);
    R.neckCtrl.lerp(R.neckBase.clone().add(S.neckCtrlReach), P.reach);
  }
  R.headRot = mul(rotY(P.headYaw), rotX(P.headPitch + S.headPitch), rotZ(P.headRoll));
  R.head = R.neckTip.clone().sub(S.nape.clone().multiplyScalar(S.headScale).applyMatrix4(R.headRot));

  const foldL = S.wingFold * (1 - 0.8 * clamp(P.wingL, 0, 1));
  const foldR = S.wingFold * (1 - 0.8 * clamp(P.wingR, 0, 1));
  R.shoulderL = toBody(S.shoulder.x, S.shoulder.y, S.shoulder.z);
  R.shoulderR = toBody(-S.shoulder.x, S.shoulder.y, S.shoulder.z);
  const tuckL = S.wingTuck * (1 - clamp(P.wingL, 0, 1));
  const tuckR = S.wingTuck * (1 - clamp(P.wingR, 0, 1));
  // With wingLevel, an open wing turns back by the body pitch about its own axis.
  const levelL = S.wingLevel * (P.pitch + S.pitch) * smoothstep(0.7, 1.2, P.wingL);
  const levelR = S.wingLevel * (P.pitch + S.pitch) * smoothstep(0.7, 1.2, P.wingR);
  R.wingL = mul(R.body.clone(), rotY(-P.sweepL), rotX(foldL - levelL), rotY(tuckL), rotZ(P.wingL));
  R.wingR = mul(R.body.clone(), rotY(P.sweepR), rotX(foldR - levelR), rotY(-tuckR), rotZ(-P.wingR));

  R.pole = at(rotY(P.yaw), 0, 0, -1);
  R.hipL = toBody(S.hip.x, S.hip.y, S.hip.z);
  R.hipR = toBody(-S.hip.x, S.hip.y, S.hip.z);
  R.footL = P.footL.clone().setY(P.footL.y + P.lift + P.floorL);
  R.footR = P.footR.clone().setY(P.footR.y + P.lift + P.floorR);
  R.clearL = P.footL.y + P.air;   // foot height above the ground under it
  R.clearR = P.footR.y + P.air;
  R.slopeL = P.slopeL.clone().normalize();
  R.slopeR = P.slopeR.clone().normalize();
  R.splay = P.splay;
  R.footYawL = P.footYawL;
  R.footYawR = P.footYawR;
  R.kneeL = solveJoint(R.hipL, R.footL, S.thigh, S.shank, R.pole);
  R.kneeR = solveJoint(R.hipR, R.footR, S.thigh, S.shank, R.pole);

  R.jaw = P.jaw;
  R.blink = P.blink;
  R.look = P.look.clone();
  R.expr = new Vector4(P.lid, P.lidTilt, P.lowLid, P.pupil);
  return R;
}

// Uniform values for model.glsl.
export function rigUniforms(R) {
  const inv = m => new Matrix3().setFromMatrix4(m).transpose();
  return {
    gPelvis: R.pelvis, gNeckBase: R.neckBase, gNeckCtrl: R.neckCtrl, gNeckTip: R.neckTip, gHead: R.head,
    gShoulderL: R.shoulderL, gShoulderR: R.shoulderR, gHipL: R.hipL, gHipR: R.hipR,
    gKneeL: R.kneeL, gKneeR: R.kneeR, gFootL: R.footL, gFootR: R.footR,
    gBodyInv: inv(R.body), gHeadInv: inv(R.headRot), gWingInvL: inv(R.wingL), gWingInvR: inv(R.wingR),
    gJaw: R.jaw, gBlink: R.blink, gLook: R.look, gExpr: R.expr,
  };
}

// ---- bones ----
const SIDES = [['L', 1], ['R', -1]];
const TOES = [0, 1, 2, 3];   // 0-2 forward, left to right as seen from behind, 3 back

export const BONES = [
  'pelvis', ...Array.from({ length: NECK_BONES }, (_, i) => 'neck' + i), 'head', 'jaw', 'wingL', 'wingR',
  ...SIDES.flatMap(([s]) => ['thigh' + s, 'shank' + s, 'foot' + s, ...TOES.map(i => 'toe' + s + i)]),
];

export function bezier(a, b, c, t) {
  return a.clone().lerp(b, t).lerp(b.clone().lerp(c, t), t);
}

// Toe direction on the ground, character space. side is 1 for the left foot and -1 for the right.
export function toeDir(side, i) {
  if (i === 3) return new Vector3(-side * 0.04, 0, -0.20).normalize();
  const a = (i - 1) * 0.62 + side * 0.14;
  return new Vector3(Math.sin(a), 0, Math.cos(a));
}

// Toe length from the ankle, character units. Same as lowerLeg() in model.glsl.
export const toeLength = (i, S = SHAPE) => S.toes[i];

// Toes curl down while the foot is lifted. clear: foot height above the ground.
function toeCurl(clear, side, i, S) {
  const curl = clamp((clear - 0.06) * 3, 0, 0.5);
  const drop = Math.atan2((i === 3 ? 0.06 : 0.18) * curl, toeLength(i, S));
  const axis = new Vector3(0, 1, 0).cross(toeDir(side, i)).normalize();
  return new Matrix4().makeRotationAxis(axis, drop);
}

// Frame with y along dir and z toward pole.
function aimFrame(dir, pole) {
  const y = dir.clone().normalize();
  const z = pole.clone().addScaledVector(y, -pole.dot(y)).normalize();
  return new Matrix4().makeBasis(new Vector3().crossVectors(y, z), y, z);
}

const UP = new Vector3(0, 1, 0);
const place = (pos, rot) => new Matrix4().setPosition(pos).multiply(rot);

// Neck sample points along the Bezier, from the base to the head.
function neckPoints(R) {
  return Array.from({ length: NECK_BONES + 1 }, (_, k) => bezier(R.neckBase, R.neckCtrl, R.neckTip, k / NECK_BONES));
}

// Bone matrices in character space, in BONES order. A neck bone runs along the chord between two
// neck points and stretches with it, relative to bindLengths.
export function boneMatrices(R, bindLengths, S = SHAPE) {
  const out = {};
  out.pelvis = place(R.pelvis, R.body);
  const pts = neckPoints(R);
  const right = at(R.body, 1, 0, 0);
  for (let k = 0; k < NECK_BONES; k++) {
    const chord = pts[k + 1].clone().sub(pts[k]);
    const len = chord.length();
    const z = chord.divideScalar(len);
    const x = right.clone().addScaledVector(z, -right.dot(z)).normalize();
    const rot = new Matrix4().makeBasis(x, new Vector3().crossVectors(z, x), z);
    const stretch = bindLengths ? len / bindLengths[k] : 1;
    out['neck' + k] = place(pts[k], rot).multiply(new Matrix4().makeScale(1, 1, stretch));
  }
  out.head = place(R.head, R.headRot);
  const hinge = S.jawHinge.clone().multiplyScalar(S.headScale);
  out.jaw = out.head.clone().multiply(mul(
    new Matrix4().makeTranslation(hinge), rotX(R.jaw), new Matrix4().makeTranslation(hinge.clone().negate())));
  out.wingL = place(R.shoulderL, R.wingL);
  out.wingR = place(R.shoulderR, R.wingR);
  for (const [s, side] of SIDES) {
    const hip = R['hip' + s], knee = R['knee' + s], foot = R['foot' + s];
    out['thigh' + s] = place(hip, aimFrame(knee.clone().sub(hip), R.pole));
    out['shank' + s] = place(knee, aimFrame(foot.clone().sub(knee), R.pole));
    // The foot lies on the ground: up turns to the slope normal, then the foot turns about it.
    const tilt = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(UP, R['slope' + s]));
    const turn = tilt.multiply(rotY(side * R.splay + R['footYaw' + s]));
    out['foot' + s] = place(foot, turn);
    for (const i of TOES) out['toe' + s + i] = place(foot, mul(turn.clone(), toeCurl(R['clear' + s], side, i, S)));
  }
  return BONES.map(name => out[name]);
}

// Bind pose: the rest pose. The mesh is baked in it. neckLengths: the bind lengths of the neck bones.
export function bindPose(S = SHAPE) {
  const rig = solveRig(restPose(), S);
  const pts = neckPoints(rig);
  return { rig, neckLengths: pts.slice(1).map((p, k) => p.distanceTo(pts[k])) };
}
export const { rig: BIND_RIG, neckLengths: NECK_BIND_LENGTHS } = bindPose();
