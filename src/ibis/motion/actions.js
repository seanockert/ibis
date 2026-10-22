// Faces and actions. An action is a short move that plays over the base motion (idle, waddle, jump).
//
// Action fields:
//   length            seconds, or Infinity for a loop that plays until stop()
//   fadeIn, fadeOut   blend times, seconds. Keep fadeIn short: a game action must start at once
//   mask              weight per channel (see CHANNELS) while the bird stands. Missing channels are 0
//   moveMask          weight per channel while the bird walks or is in the air, so the legs keep walking
//   face              expression (see FACES) for the length of the action
//   apply(P, t)       changes the pose P at action time t. P starts as a copy of the base pose
//   root(t)           optional root motion: speed along the heading (less than 0 backward). The legs walk
//                     it through the gait, with no foot slide
//   lock              true: player input does nothing until cancelAfter seconds, then input ends the action
//   events            optional [{ at, type, ... }]: events at action times, for effects and sound.
//                     'thump' { amount } kicks the squash spring. dust: 'rump' or 'feet' makes a puff there
//   anger             0 to 1: comic anger lines round the head while the action plays (effects.js)
import { Vector3 } from 'three';
import { clipPose } from '../rig.js';
import { TAU, mix, smoothstep, window4 } from './spring.js';

// Pose keys in each channel. A mask gives one weight to each channel.
export const CHANNELS = {
  root: ['bob', 'x', 'z'],
  body: ['pitch', 'roll', 'yaw'],
  legs: ['footL', 'footR', 'splay', 'footYawL', 'footYawR'],
  neck: ['neck', 'reach', 'stretch', 'headPitch', 'headYaw', 'headRoll', 'headFwd'],
  jaw: ['jaw'],
  wings: ['wingL', 'wingR', 'sweepL', 'sweepR'],
  face: ['blink', 'look', 'lid', 'lidTilt', 'lowLid', 'pupil'],
};
export const FACE_KEYS = ['blink', 'lid', 'lidTilt', 'lowLid', 'pupil'];

const ALL = { root: 1, body: 1, legs: 1, neck: 1, jaw: 1, wings: 1, face: 1 };
const UPPER = { body: 1, neck: 1, jaw: 1, wings: 1, face: 1 };
const HEAD = { neck: 1, jaw: 1, face: 1 };

// Expressions: values for the face keys. Missing keys take the neutral value.
export const FACES = {
  neutral: { blink: 0, lid: 0, lidTilt: 0, lowLid: 0, pupil: 1 },
  happy: { blink: 1 },
  angry: { lid: 0.3, lidTilt: 0.9, lowLid: 0.2, pupil: 0.8 },
  effort: { lid: 0.45, lidTilt: 0.3, lowLid: 0.5 },
  wide: { lid: -0.4, pupil: 0.7 },
  squint: { lid: 0.6, lowLid: 0.4, lidTilt: 0.2 },
  smug: { lid: 0.92, lidTilt: -0.15 },
  dazed: { lid: 0.35, lowLid: 0.15, pupil: 0.75 },
};
export const face = name => ({ ...FACES.neutral, ...FACES[name] });

// Blends the face keys of P toward expression name, with weight w.
function blendFace(P, name, w) {
  const f = face(name);
  for (const key of FACE_KEYS) P[key] = mix(P[key], f[key], w);
}

// Blends Q into P in place, with weight w times the mask weight of each channel.
export function blendMasked(P, Q, w, mask) {
  for (const [channel, keys] of Object.entries(CHANNELS)) {
    const k = w * (mask[channel] || 0);
    if (k <= 0) continue;
    for (const key of keys) {
      if (typeof P[key] === 'number') P[key] = mix(P[key], Q[key], k);
      else P[key].lerp(Q[key], k);
    }
  }
}

// One hop: up for the middle of 0..1, a dip (squash) at the start and the end.
function hop(u) {
  if (u <= 0 || u >= 1) return 0;
  if (u < 0.12) return -0.5 * Math.sin(Math.PI * u / 0.12);
  if (u < 0.85) return Math.sin(Math.PI * (u - 0.12) / 0.73);
  return -0.4 * Math.sin(Math.PI * (u - 0.85) / 0.15);
}

// An authored clip from rig.js as an action. It sets the whole pose, so the look and the root heading
// layers still apply on top.
function clipAction(name, length) {
  return {
    length, fadeIn: 0.12, fadeOut: 0.3, mask: ALL, moveMask: UPPER,
    apply(P, t) {
      const Q = clipPose(name, t);
      for (const key in Q) P[key] = Q[key];
    },
  };
}

export const ACTIONS = {
  peck: clipAction('peck', 2 / 1.2),
  squawk: clipAction('squawk', 1.5),
  flap: clipAction('flap', 2 / 0.75),

  // Two quick hops with happy eyes, a head tilt to one side then the other, a honk at each top, and
  // the wings fluttering. It ends chest out and head up.
  happy: {
    length: 1.25, fadeIn: 0.05, fadeOut: 0.3, mask: ALL, moveMask: UPPER, face: 'happy',
    apply(P, t) {
      const hops = [0, 0.42];
      let h = 0, honk = 0;
      for (const t0 of hops) {
        const u = (t - t0) / 0.42;
        h += hop(u);
        honk = Math.max(honk, window4(0.15, 0.3, 0.55, 0.8, u));
      }
      const air = Math.max(h, 0) * 0.2;
      const dip = Math.min(h, 0) * 0.06;
      P.bob += air + dip;
      P.footL.y += air;
      P.footR.y += air;
      P.stretch = 1 + 0.12 * h;
      P.pitch = mix(P.pitch, -0.08, smoothstep(0, 0.1, t));
      const tilt = t < 0.42 ? 1 : t < 0.84 ? -1 : 0.4;
      P.headRoll = 0.3 * tilt * smoothstep(0, 0.1, t);
      P.headPitch = mix(P.headPitch, -0.4, smoothstep(0, 0.12, t));
      P.headYaw *= 0.3;
      P.jaw = 0.38 * honk;
      const flutter = smoothstep(0, 0.08, t) * (1 - smoothstep(0.8, 1.0, t));
      P.wingL = P.wingR = mix(0.06, 0.32, smoothstep(0, 0.1, t)) + 0.35 * flutter * Math.sin(TAU * 7 * t);
      P.look.set(0, 0.2);
    },
  },

  // Angry head shake: narrow eyes, fast shake that dies away with the beak clacking, a stamp, then a
  // "hmph": the head turns away and up with the eyes shut.
  headShake: {
    length: 1.4, fadeIn: 0.04, fadeOut: 0.3, mask: ALL, moveMask: { neck: 1, jaw: 1, face: 1 }, face: 'angry', anger: 1,
    apply(P, t) {
      const shake = t < 0.7 ? Math.sin(TAU * 6.5 * t) * (1 - t / 0.7) ** 1.5 : 0;
      const pull = smoothstep(0, 0.06, t);
      P.headFwd = mix(P.headFwd, -0.05, pull);
      P.stretch = mix(1, 0.9, pull);
      P.headYaw = 0.42 * shake;
      P.headRoll = -0.12 * shake;
      P.headPitch = mix(P.headPitch, 0.2, pull);
      P.roll -= 0.03 * shake;
      P.jaw = t < 0.7 ? 0.14 * Math.max(Math.sin(TAU * 13 * t), 0) : 0;
      P.wingL = P.wingR = 0.06 + 0.1 * window4(0, 0.08, 0.6, 0.8, t);
      // Stamp: the right foot comes up, then down hard.
      const lift = window4(0.62, 0.72, 0.76, 0.8, t);
      P.footR.y += 0.1 * lift;
      P.bob += 0.02 * lift - 0.03 * window4(0.78, 0.8, 0.84, 0.95, t);
      // Hmph.
      const away = smoothstep(0.85, 1.0, t);
      P.headYaw += 0.6 * away;
      P.headPitch = mix(P.headPitch, -0.3, away);
      P.pitch = mix(P.pitch, P.pitch - 0.08, away);
      P.lid = mix(P.lid, FACES.smug.lid, away);
      P.lidTilt = mix(P.lidTilt, FACES.smug.lidTilt, away);
      P.lowLid = mix(P.lowLid, 0, away);
      P.look.set(0, 0.2);
    },
  },

  // Flinch from a prod: eyes squeezed, the head pulls into the body. The spring kicks that push the body
  // away and flick the wings are in the animator (prod()).
  flinch: {
    length: 0.45, fadeIn: 0.02, fadeOut: 0.25, mask: HEAD, moveMask: HEAD, face: 'squint',
    apply(P, t) {
      const k = window4(0, 0.03, 0.2, 0.45, t);
      P.stretch = mix(P.stretch, 0.82, k);
      P.headFwd = mix(P.headFwd, -0.06, k);
      P.jaw = 0.12 * k;
    },
  },
  // Look hard at someone: angry eyes, head low and pushed forward.
  glare: {
    length: 1.2, fadeIn: 0.05, fadeOut: 0.3, mask: HEAD, moveMask: HEAD, face: 'angry', anger: 0.7,
    apply(P, t) {
      const k = smoothstep(0, 0.12, t);
      P.headFwd = mix(P.headFwd, 0.05, k);
      P.headPitch = mix(P.headPitch, 0.3, k);
      P.stretch = mix(P.stretch, 0.9, k);
      P.headYaw *= 1 - k;
      P.look.set(0, 0.25);
    },
  },

  // Threat, like a goose: a quick rise, then low with the neck straight out, wings arched forward, beak
  // open in a hiss that shakes, and the head swaying like a snake.
  threat: {
    length: 1.5, fadeIn: 0.03, fadeOut: 0.25, mask: ALL, moveMask: UPPER, face: 'angry', anger: 1,
    apply(P, t) {
      const rise = window4(0, 0.03, 0.05, 0.1, t);
      const k = smoothstep(0.04, 0.12, t) * (1 - smoothstep(1.2, 1.5, t));
      const hiss = Math.sin(TAU * 23 * t), sway = Math.sin(TAU * 1.3 * t);
      const lunge = k * window4(0.45, 0.52, 0.6, 0.78, t);
      P.bob += 0.04 * rise - 0.13 * k;
      P.stretch = mix(P.stretch, 1.15, rise);
      P.headPitch = mix(mix(P.headPitch, -0.35, rise), 0.05, k);
      P.pitch = mix(P.pitch, 0.6, k);
      P.reach = k;
      P.headFwd += 0.12 * lunge;
      P.headYaw = mix(P.headYaw, 0.16 * sway, k);
      P.headRoll = 0.08 * sway * k;
      P.jaw = k * (0.22 + 0.04 * hiss);
      P.wingL = P.wingR = mix(P.wingL, 0.95 + 0.03 * hiss, k);
      P.sweepL = P.sweepR = 0.45 * k;
      P.footL.set(mix(P.footL.x, 0.31, k), P.footL.y, mix(P.footL.z, 0.16, k));
      P.footR.set(mix(P.footR.x, -0.31, k), P.footR.y, mix(P.footR.z, -0.06, k));
      P.look.set(0, 0.1);
    },
  },

  // Startled: a jump of fright with wide eyes, fast steps backward with the wings flailing, a trip over
  // its own feet onto its bottom, a dazed moment with the eyes rolling, then up again, a little smug.
  startle: {
    length: 1.75, fadeIn: 0.02, fadeOut: 0.25, mask: ALL, moveMask: ALL, lock: true, cancelAfter: 1.3,
    root: t => (t < 0.06 ? 0 : t < 0.55 ? -1.8 : t < 0.68 ? -0.6 : 0),
    events: [{ at: 0.66, type: 'thump', amount: 14, dust: 'rump' }],
    apply(P, t) {
      const take = window4(0, 0.02, 0.05, 0.1, t);
      const back = window4(0.05, 0.1, 0.52, 0.62, t);
      const sit = window4(0.55, 0.66, 1.2, 1.45, t);
      const daze = window4(0.72, 0.8, 1.1, 1.2, t);
      const smug = window4(1.4, 1.5, 1.65, 1.75, t);
      // Take.
      P.bob += 0.08 * take;
      P.footL.y += 0.06 * take;
      P.footR.y += 0.06 * take;
      P.stretch = mix(P.stretch, 0.8, take);
      // Backpedal: the gait walks the legs backward; the body leans back and the wings flail.
      P.pitch = mix(P.pitch, -0.25, back);
      P.headPitch = mix(P.headPitch, -0.3, back);
      const flail = Math.max(take, back);
      P.wingL = mix(P.wingL, 1.1 + 0.4 * Math.sin(TAU * 6.5 * t), flail);
      P.wingR = mix(P.wingR, 1.1 + 0.4 * Math.sin(TAU * 6.5 * t + 2.1), flail);
      P.sweepL = 0.3 * Math.sin(TAU * 6.5 * t + 0.8) * back;
      P.sweepR = 0.3 * Math.sin(TAU * 6.5 * t + 2.9) * back;
      P.jaw = 0.25 * flail;
      // Trip and sit: the feet shoot forward and the body drops back.
      P.bob = mix(P.bob, -0.24, sit);
      P.pitch = mix(P.pitch, -0.35, sit);
      P.headPitch = mix(P.headPitch, 0.05, sit);
      P.footL.lerp(new Vector3(0.22, 0.12, 0.36), sit);
      P.footR.lerp(new Vector3(-0.2, 0.06, 0.3), sit);
      P.splay = mix(P.splay, 0.4, sit);
      P.wingL = mix(P.wingL, 0.55, sit * (1 - flail));
      P.wingR = mix(P.wingR, 0.5, sit * (1 - flail));
      // Dazed: the pupils roll and the head wobbles.
      P.look.set(0.7 * Math.cos(TAU * 2.2 * t) * daze, 0.6 * Math.sin(TAU * 2.2 * t) * daze + 0.1 * (1 - daze));
      P.headRoll = 0.2 * Math.sin(TAU * 0.9 * t) * daze;
      P.headYaw = mix(P.headYaw, 0.15 * Math.sin(TAU * 0.6 * t), daze);
      // Faces: wide, then dazed, then smug.
      const wide = Math.max(take, back);
      blendFace(P, 'wide', wide);
      blendFace(P, 'dazed', daze);
      blendFace(P, 'smug', smug);
    },
  },

  // Stumble: a toe catches, the body pitches far forward with the neck flung out and the wings
  // windmilling, quick steps to catch the fall, then up straight and proud, with a look to each side:
  // did anyone see?
  stumble: {
    length: 2.0, fadeIn: 0.02, fadeOut: 0.3, mask: ALL, moveMask: ALL, lock: true, cancelAfter: 1.2,
    root: t => (t < 0.15 ? 1.7 : t < 0.7 ? 1.2 : t < 0.85 ? 0.4 : 0),
    events: [{ at: 0.75, type: 'thump', amount: 8, dust: 'feet' }],
    apply(P, t) {
      const caught = window4(0, 0.02, 0.1, 0.18, t);
      const fall = window4(0.05, 0.18, 0.6, 0.8, t);
      const proud = window4(0.7, 0.85, 1.75, 2.0, t);
      P.footR.set(P.footR.x, mix(P.footR.y, 0.05, caught), mix(P.footR.z, -0.25, caught));
      P.pitch = mix(P.pitch, 0.95, fall);
      P.reach = 0.6 * fall;
      P.headPitch = mix(P.headPitch, 0.1, fall);
      P.jaw = 0.25 * fall;
      P.wingL = mix(P.wingL, 0.9 + 0.5 * Math.sin(TAU * 4 * t), fall);
      P.wingR = mix(P.wingR, 0.9 + 0.5 * Math.sin(TAU * 4 * t + Math.PI), fall);
      P.sweepL = 0.4 * Math.sin(TAU * 4 * t) * fall;
      P.sweepR = -0.4 * Math.sin(TAU * 4 * t) * fall;
      // Proud: chest up, head up, then a glance each way.
      P.pitch = mix(P.pitch, -0.1, proud);
      P.headPitch = mix(P.headPitch, -0.3, proud);
      const glance = 0.5 * window4(1.05, 1.15, 1.3, 1.4, t) - 0.5 * window4(1.35, 1.45, 1.6, 1.7, t);
      P.headYaw = mix(P.headYaw, glance, proud);
      P.look.x = mix(P.look.x, 1.4 * glance, proud);
      blendFace(P, 'wide', fall);
      blendFace(P, 'smug', window4(0.8, 0.9, 1.0, 1.08, t) + window4(1.7, 1.8, 1.9, 2.0, t));
    },
  },

  // Full body shake, like a wet dog: a short squash, then a wave that runs from the body to the head,
  // the wings loose, then the feathers settle. 'shakeOff' is when the water flies off.
  shake: {
    length: 1.5, fadeIn: 0.04, fadeOut: 0.3, mask: ALL, moveMask: UPPER, face: 'squint',
    events: [{ at: 0.45, type: 'shakeOff' }],
    apply(P, t) {
      const squash = window4(0, 0.05, 0.1, 0.16, t);
      const d = window4(0.1, 0.18, 0.75, 1.05, t);
      const w = TAU * 7 * t;
      P.bob -= 0.03 * squash;
      P.stretch = mix(P.stretch, 0.85, squash) + 0.05 * d;
      P.roll += 0.16 * Math.sin(w) * d;
      P.yaw += 0.1 * Math.sin(w + 0.6) * d;
      P.headYaw = 0.35 * Math.sin(w - 1.2) * d;
      P.headRoll = 0.22 * Math.sin(w - 1.8) * d;
      P.wingL = 0.12 + 0.25 * Math.abs(Math.sin(w + 0.4)) * d;
      P.wingR = 0.12 + 0.25 * Math.abs(Math.sin(w + 0.4 + Math.PI / 2)) * d;
      P.jaw = 0.08 * d;
      const settle = smoothstep(1.0, 1.2, t);
      P.headPitch = mix(P.headPitch, -0.2, settle);
      blendFace(P, 'smug', settle);
    },
  },
};
