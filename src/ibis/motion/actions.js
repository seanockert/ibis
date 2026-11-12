// Faces and actions. An action is a short move that plays over the base motion (idle, waddle, jump).
//
// Action fields:
//   length            seconds, or Infinity for a loop that plays until stop()
//   fadeIn, fadeOut   blend times, seconds. Keep fadeIn short: a game action must start at once
//   mask              weight per channel (see CHANNELS) while the bird stands. Missing channels are 0
//   moveMask          weight per channel while the bird walks or is in the air, so the legs keep walking.
//                     Missing: the same as mask
//   face              expression (see FACES) for the length of the action
//   apply(P, t)       changes the pose P at action time t. P starts as a copy of the base pose
//   root(t)           optional root motion: speed along the heading (less than 0 backward). The legs walk
//                     it through the gait, with no foot slide
//   lock              true: player input does nothing until cancelAfter seconds, then input ends the action
//   events            optional [{ at, type, ... }]: events at action times, for effects and sound.
//                     'thump' { amount } kicks the squash spring. dust: 'rump' or 'feet' makes a puff there.
//                     Sound only (sound.js): 'call' { pitch, gain } a honk, 'hiss' { length }, 'clack'
//                     { amount } the bill snaps shut, 'stamp' a foot hits the ground. 'grab' (physics.js)
//                     picks up a prop in the bill, 'drop' lets it go, 'fling' (fling.js) throws it.
//                     'bite' (sentry.js) can hurt a miner. 'toss' (src/gulp/game.js) lets go of the item
//                     at the top of the flick, 'gulp' { beat } is a swallow
//   anger             0 to 1: comic anger lines round the head while the action plays (effects.js)
import { Vector3 } from 'three';
import { clipPose } from '../rig.js';
import { TAU, mix, smoothstep, window4 } from './spring.js';

// Pose keys in each channel. A mask gives one weight to each channel.
export const CHANNELS = {
  root: ['bob', 'x', 'z'],
  body: ['pitch', 'roll', 'yaw', 'squash', 'tail', 'scarfL', 'scarfR'],
  legs: ['footL', 'footR', 'splay', 'footYawL', 'footYawR'],
  neck: ['neck', 'reach', 'stretch', 'neckBody', 'tip', 'headPitch', 'headYaw', 'headRoll', 'headFwd'],
  jaw: ['jaw'],
  wings: ['wingL', 'wingR', 'sweepL', 'sweepR', 'curlL', 'curlR'],
  face: ['blink', 'look', 'lid', 'lidTilt', 'lowLid', 'pupil'],
  ground: ['floorL', 'floorR', 'slopeL', 'slopeR', 'air'],   // set after the actions (Animator.ground()). No mask uses it
};
// The bill opens this far for the drop of a held prop (GRAB.holds in physics.js has the hold openings).
export const GRIP = { drop: 0.95 };

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
export const FACE_KEYS = Object.keys(FACES.neutral);

// Blends the face keys of P toward expression name, with weight w.
function blendFace(P, name, w) {
  const f = face(name);
  for (const key of FACE_KEYS) P[key] = mix(P[key], f[key], w);
}

// Blends Q into P in place, with weight w times the mask weight of each channel.
const CHANNEL_KEYS = Object.entries(CHANNELS);
export function blendMasked(P, Q, w, mask) {
  for (const [channel, keys] of CHANNEL_KEYS) {
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
function clipAction(name, length, events) {
  return {
    length, fadeIn: 0.12, fadeOut: 0.3, mask: ALL, moveMask: UPPER, events,
    apply(P, t) {
      const Q = clipPose(name, t);
      for (const key in Q) P[key] = Q[key];
    },
  };
}

export const ACTIONS = {
  // 'grab' on the way down in the first jab: physics.js picks up a prop near the bill. Early, so a
  // fumble (a prop too big) takes over before the bill goes into the prop.
  peck: clipAction('peck', 2 / 1.2, [{ at: 0.08, type: 'grab' }]),
  // A peck that picks up a prop (physics.js): in place of the rest of the peck, one quick nod. The
  // head starts down at the prop, as the jab left it, comes straight up with it, and tosses a little.
  // The legs are not in the mask: the feet ease back from the peck stance as the peck fades out.
  lift: {
    length: 0.45, fadeIn: 0.05, fadeOut: 0.15, mask: { root: 1, body: 1, neck: 1, wings: 1, face: 1 }, moveMask: UPPER,
    apply(P, t) {
      const down = 0.8 * (1 - smoothstep(0.03, 0.22, t));
      const toss = window4(0.14, 0.22, 0.3, 0.45, t);
      P.pitch = mix(P.pitch, 0.75, down) - 0.15 * toss;
      P.bob = mix(P.bob, -0.06, down) + 0.04 * toss;
      P.neck = mix(P.neck, 1.0, down);
      P.headPitch = mix(P.headPitch, 1.05, down) - 0.5 * toss;
      P.stretch *= 1 + 0.15 * toss;
      P.wingL = P.wingR = mix(P.wingL, 0.06, down) + 0.35 * toss;
      P.look.y = mix(P.look.y, -0.35, down);
      blendFace(P, 'smug', toss);
    },
  },
  // A peck at a prop too big for the bill (physics.js): the bill opens wide on it with the head held
  // above it (lower, the head goes into the prop), snaps shut where it slips off, then the head comes
  // up, a small shake, and the bird slumps.
  fumble: {
    length: 1.1, fadeIn: 0.04, fadeOut: 0.2, mask: ALL, moveMask: UPPER, face: 'effort',
    events: [{ at: 0.26, type: 'clack', amount: 0.8 }],
    apply(P, t) {
      const down = window4(0, 0.04, 0.26, 0.32, t);
      const push = window4(0.04, 0.14, 0.2, 0.26, t);
      P.pitch = mix(P.pitch, 0.5, down);
      P.bob = mix(P.bob, -0.05, down);
      P.neck = mix(P.neck, 0.4, down);
      P.headPitch = mix(P.headPitch, 0.75, down) - 0.12 * push;
      P.headFwd = 0.04 * push;
      P.headYaw = mix(P.headYaw, 0.1 * Math.sin(TAU * 6 * t) * push, down);
      // Bill wide with a strain shake, shut where it slips off.
      P.jaw = window4(0.02, 0.08, 0.2, 0.26, t) * (0.95 + 0.06 * Math.sin(TAU * 12 * t));
      P.wingL = P.wingR = mix(P.wingL, 0.35, push) + 0.15 * Math.abs(Math.sin(TAU * 8 * t)) * push;
      // It slips: the head snaps up and back, the wings fly out.
      const recoil = window4(0.26, 0.3, 0.36, 0.6, t);
      P.headPitch -= 0.9 * recoil;
      P.pitch -= 0.35 * recoil;
      P.stretch *= 1 + 0.2 * recoil;
      P.wingL += 0.6 * recoil;
      P.wingR += 0.6 * recoil;
      // Give up: the head comes up, a small shake, then a slump with heavy lids.
      const up = window4(0.3, 0.45, 0.98, 1.1, t);
      const shake = Math.sin(TAU * 5 * (t - 0.5)) * window4(0.5, 0.54, 0.7, 0.8, t);
      P.headYaw += 0.35 * shake * up;
      P.headPitch = mix(P.headPitch, 0.35, up * (1 - recoil));
      P.bob -= 0.06 * window4(0.75, 0.85, 1.0, 1.1, t);
      P.wingL = P.wingR = mix(P.wingL, 0.12, window4(0.75, 0.82, 0.98, 1.1, t));
      blendFace(P, 'wide', recoil);
      blendFace(P, 'dazed', window4(0.5, 0.6, 0.98, 1.1, t));
      P.look.set(0, mix(-0.35, 0, up));
    },
  },
  // Hold the peck with a prop in the bill (Character.aim()): a wind-up that grows over the first 0.8 s,
  // the body back and the head pulled back and up, as a throw. Plays until release().
  aim: {
    length: Infinity, fadeIn: 0.08, fadeOut: 0.06, mask: UPPER, face: 'effort',
    apply(P, t) {
      const k = smoothstep(0, 0.8, t), wob = 0.04 * Math.sin(TAU * 7 * t) * k;
      P.pitch = mix(P.pitch, -0.35, k);
      P.bob -= 0.05 * k;
      P.stretch = mix(P.stretch, 0.8, k);
      P.headFwd = mix(P.headFwd, -0.15, k);
      P.headPitch = mix(P.headPitch, -1.0, k) + wob;
      P.wingL = P.wingR = mix(P.wingL, 0.3, k) + 0.05 * Math.sin(TAU * 7 * t + 1) * k;
    },
  },
  // The fling (Character.release() after an aim): the body springs up and forward and the neck shoots
  // out, and the bill lets go of the prop ('fling', fling.js) as it points forward and up. The head
  // follows through to level, holds, and comes back.
  fling: {
    length: 0.6, fadeIn: 0.02, fadeOut: 0.2, mask: UPPER, face: 'smug',
    events: [{ at: 0.07, type: 'fling' }],
    apply(P, t) {
      const back = 1 - smoothstep(0, 0.07, t), whip = window4(0.02, 0.07, 0.3, 0.6, t);
      const through = window4(0.07, 0.16, 0.3, 0.6, t);
      P.pitch = mix(mix(P.pitch, -0.35, back), 0.15, whip);
      P.bob += 0.05 * whip - 0.05 * back;
      P.stretch = mix(mix(P.stretch, 0.8, back), 1.4, whip);
      P.headFwd = mix(mix(P.headFwd, -0.15, back), 0.18, whip);
      P.headPitch = mix(mix(mix(P.headPitch, -1.0, back), -0.8, whip), -0.45, through);
      P.jaw = Math.max(P.jaw, 0.8 * window4(0.05, 0.07, 0.2, 0.35, t));
      P.wingL = P.wingR = mix(P.wingL, 0.8, window4(0.03, 0.08, 0.2, 0.45, t));
      P.tail.y += 0.5 * whip;
      P.squash *= 1 + 0.12 * whip;
    },
  },
  // A peck while the bill holds a prop: the bill gapes and the prop falls out, the head jerks up with
  // wide eyes, then looks down after it. No jab.
  drop: {
    length: 0.5, fadeIn: 0.02, fadeOut: 0.15, mask: { neck: 1, jaw: 1, wings: 1, face: 1 }, face: 'wide',
    events: [{ at: 0.06, type: 'drop' }],
    apply(P, t) {
      const jerk = window4(0, 0.05, 0.15, 0.3, t), after = window4(0.2, 0.3, 0.4, 0.5, t);
      P.jaw = Math.max(P.jaw, GRIP.drop * window4(0, 0.06, 0.2, 0.4, t));
      P.headPitch += -0.35 * jerk + 0.4 * after;
      P.stretch *= 1 + 0.12 * jerk;
      P.wingL += 0.35 * jerk;
      P.wingR += 0.35 * jerk;
      P.look.y = mix(P.look.y, -0.5, after);
    },
  },
  // A peck at a noisy miner in the air (Character.act with snapAt): the head shoots up and forward with
  // the bill wide, and the bill shuts hard. 'bite' (sentry.js): a miner near the head in the next
  // SNAP.window seconds is hurt.
  snap: {
    length: 0.55, fadeIn: 0.03, fadeOut: 0.2, mask: UPPER, face: 'angry', anger: 0.6,
    events: [{ at: 0.06, type: 'bite' }, { at: 0.13, type: 'clack', amount: 1 }],
    apply(P, t) {
      const up = window4(0, 0.07, 0.25, 0.55, t);
      P.stretch = mix(P.stretch, 1.3, up);
      P.headFwd = mix(P.headFwd, 0.1, up);
      P.headPitch = mix(P.headPitch, -0.5, up);
      P.pitch -= 0.12 * up;
      P.jaw = Math.max(P.jaw, 0.6 * window4(0, 0.04, 0.09, 0.13, t));
      P.wingL = P.wingR = mix(P.wingL, 0.3, up);
    },
  },
  // A honk at each jaw beat.
  squawk: clipAction('squawk', 1.5, [0.08, 0.58, 1.08].map((at, i) => ({ at, type: 'call', pitch: [1, 0.96, 0.92][i] }))),

  // Two quick hops with happy eyes, a head tilt to one side then the other, a honk at each top, and
  // the wings fluttering. It ends chest out and head up.
  happy: {
    length: 1.25, fadeIn: 0.05, fadeOut: 0.3, mask: ALL, moveMask: UPPER, face: 'happy',
    events: [{ at: 0.06, type: 'call', pitch: 1.12, gain: 0.8 }, { at: 0.48, type: 'call', pitch: 1.2, gain: 0.8 }],
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
      // Cartoon extras: a fast tail wag, the wing hands flutter, a squash at the bottom of each hop.
      const glee = window4(0, 0.1, 1.05, 1.25, t);
      P.tail.x += 0.55 * Math.sin(TAU * 5 * t) * glee;
      P.tail.y += 0.35 * glee;
      P.curlL += 0.45 * Math.sin(TAU * 8 * t) * glee;
      P.curlR += 0.45 * Math.sin(TAU * 8 * t + 1) * glee;
      P.squash *= 1 + 2.5 * dip + 0.4 * air;
    },
  },

  // Angry head shake: narrow eyes, fast shake that dies away with the beak clacking, a stamp, then a
  // "hmph": the head turns away and up with the eyes shut.
  headShake: {
    length: 1.4, fadeIn: 0.04, fadeOut: 0.3, mask: ALL, moveMask: HEAD, face: 'angry', anger: 1,
    // The bill shuts at each 1/13 s while the shake dies away, then the stamp.
    events: [
      ...Array.from({ length: 9 }, (_, k) => ({ at: (k + 1) / 13, type: 'clack', amount: (1 - (k + 1) / 13 / 0.7) ** 1.5 })),
      { at: 0.8, type: 'stamp' },
    ],
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
      P.tail.x += 0.45 * shake;
    },
  },

  // Flinch from a prod: eyes squeezed, the head pulls into the body. The spring kicks that push the body
  // away and flick the wings are in the animator (prod()).
  flinch: {
    length: 0.45, fadeIn: 0.02, fadeOut: 0.25, mask: HEAD, face: 'squint',
    events: [{ at: 0.02, type: 'call', pitch: 1.35, gain: 0.35 }],
    apply(P, t) {
      const k = window4(0, 0.03, 0.2, 0.45, t);
      P.stretch = mix(P.stretch, 0.82, k);
      P.headFwd = mix(P.headFwd, -0.06, k);
      P.jaw = 0.12 * k;
    },
  },
  // Look hard at someone: angry eyes, head low and pushed forward.
  glare: {
    length: 1.2, fadeIn: 0.05, fadeOut: 0.3, mask: HEAD, face: 'angry', anger: 0.7,
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
    events: [{ at: 0.06, type: 'hiss', length: 1.2 }],
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
      // Puffed up: lower and wider, the tail fanned up, the wing hands out.
      P.squash *= 1 - 0.14 * k;
      P.tail.y += 0.55 * k;
      P.curlL += 0.5 * k;
      P.curlR += 0.5 * k;
    },
  },

  // Startled: a jump of fright with wide eyes, fast steps backward with the wings flailing, a trip over
  // its own feet onto its bottom, a dazed moment with the eyes rolling, then up again, a little smug.
  startle: {
    length: 1.75, fadeIn: 0.02, fadeOut: 0.25, mask: ALL, lock: true, cancelAfter: 1.3,
    root: t => (t < 0.06 ? 0 : t < 0.55 ? -1.8 : t < 0.68 ? -0.6 : 0),
    events: [{ at: 0.02, type: 'call', pitch: 1.25 }, { at: 0.66, type: 'thump', amount: 14, dust: 'rump' }],
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
      // Shot up tall with the tail up and the hands flung out, then squashed flat on the sit.
      P.squash *= 1 + 0.25 * take + 0.12 * back - 0.25 * sit;
      P.tail.y += 0.7 * Math.max(take, back) - 0.2 * sit;
      P.curlL += 0.6 * Math.sin(TAU * 7 * t) * flail;
      P.curlR -= 0.6 * Math.sin(TAU * 7 * t) * flail;
    },
  },

  // Stumble: a toe catches at a run and the bird loses its balance to the side. The body tips over to
  // its right, the left foot comes off the ground, and the left wing shoots out and flaps to pull it
  // back. The right foot hops out wide and catches it, a wobble past upright, then up straight and
  // proud, with a look to each side: did anyone see?
  stumble: {
    length: 2.0, fadeIn: 0.02, fadeOut: 0.3, mask: ALL, lock: true, cancelAfter: 1.2,
    root: t => (t < 0.1 ? 1.5 : t < 0.25 ? 0.5 : 0),
    events: [{ at: 0.08, type: 'call', pitch: 1.1, gain: 0.6 }, { at: 0.42, type: 'thump', amount: 6, dust: 'feet' }],
    apply(P, t) {
      const caught = window4(0, 0.02, 0.08, 0.14, t);
      const tip = window4(0.04, 0.3, 0.42, 0.7, t);       // over to the right (roll more than 0)
      const hop = window4(0.18, 0.28, 0.42, 0.75, t);     // the right foot out wide
      const air = window4(0.06, 0.2, 0.38, 0.5, t);       // the left foot up, off the ground
      const wobble = -Math.sin(TAU * 2.4 * (t - 0.55)) * window4(0.55, 0.62, 0.95, 1.15, t);   // past upright, back
      const wing = window4(0.06, 0.16, 0.75, 1.05, t);    // the left wing out for balance
      const proud = window4(0.95, 1.05, 1.75, 2.0, t);
      // The toe catches: a jolt forward.
      P.footR.set(P.footR.x, mix(P.footR.y, 0.05, caught), mix(P.footR.z, -0.2, caught));
      P.pitch = mix(P.pitch, 0.45, caught);
      // Tip to the right side: the pelvis slides over the right foot, and the head stays more level.
      const roll = 0.7 * tip + 0.16 * wobble;
      P.roll += roll;
      P.x -= 0.16 * tip;
      P.pitch = mix(P.pitch, 0.3, tip);
      P.yaw -= 0.15 * tip;
      P.headRoll = -0.7 * roll;
      P.headPitch = mix(P.headPitch, -0.1, tip);
      P.stretch = mix(P.stretch, 1.1, tip);
      P.jaw = 0.3 * tip;
      // Feet: the right one hops out wide to catch the weight, the left one comes up.
      P.footR.x -= 0.3 * hop;
      P.footR.y += 0.1 * window4(0.18, 0.24, 0.3, 0.4, t);
      P.footL.x -= 0.06 * air;
      P.footL.y += 0.24 * air;
      P.footL.z += 0.08 * air;
      // Wings: the left one out wide and flapping hard, the right one a little open.
      P.wingL = mix(P.wingL, 1.25 + 0.35 * Math.sin(TAU * 5 * t), wing);
      P.sweepL = mix(P.sweepL, 0.25 * Math.sin(TAU * 5 * t + 0.8), wing);
      P.wingR = mix(P.wingR, 0.35, tip);
      // Proud: chest up, head up, then a glance each way.
      P.pitch = mix(P.pitch, -0.1, proud);
      P.headPitch = mix(P.headPitch, -0.3, proud);
      const glance = 0.5 * window4(1.15, 1.25, 1.4, 1.5, t) - 0.5 * window4(1.45, 1.55, 1.7, 1.8, t);
      P.headYaw = mix(P.headYaw, glance, proud);
      P.look.x = mix(P.look.x, 1.4 * glance, proud);
      blendFace(P, 'wide', Math.max(tip, wing * (1 - proud)));
      blendFace(P, 'smug', window4(0.95, 1.05, 1.12, 1.2, t) + window4(1.75, 1.85, 1.92, 2.0, t));
      // The wing hands flail, the tail swings for balance.
      P.curlL += 0.7 * Math.sin(TAU * 6 * t) * wing;
      P.curlR += 0.4 * Math.sin(TAU * 6 * t + 2) * wing;
      P.tail.x += 0.5 * tip;
    },
  },

  // Full body shake, like a wet dog: a short squash, then a wave that runs from the body to the head,
  // the wings loose, then the feathers settle. 'shakeOff' is when the water flies off.
  shake: {
    length: 1.5, fadeIn: 0.04, fadeOut: 0.3, mask: ALL, moveMask: UPPER, face: 'squint',
    events: [{ at: 0.12, type: 'ruffle', length: 0.85 }, { at: 0.45, type: 'shakeOff' }],
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
      // The tail and the wing hands whip with the shake.
      P.squash *= 1 - 0.15 * squash;
      P.tail.x += 0.6 * Math.sin(w + 1.0) * d;
      P.curlL += 0.5 * Math.sin(w) * d;
      P.curlR += 0.5 * Math.sin(w + 0.8) * d;
    },
  },

  // Lunge jab: the head pulls back, then the bird dashes forward with the neck straight out and stabs
  // with the bill. The bill shuts at the front of the stab ('bite'). Then it comes back up, ready.
  lunge: {
    length: 0.6, fadeIn: 0.02, fadeOut: 0.2, mask: { root: 1, body: 1, neck: 1, jaw: 1, wings: 1, face: 1 }, face: 'angry',
    lock: true, cancelAfter: 0.32,
    root: t => (t < 0.06 ? 0 : t < 0.2 ? 5 : t < 0.32 ? 1.5 : 0),
    events: [{ at: 0.06, type: 'whoosh' }, { at: 0.06, type: 'thump', amount: 4, dust: 'feet' }, { at: 0.13, type: 'bite' }, { at: 0.14, type: 'clack', amount: 1 }],
    apply(P, t) {
      const back = window4(0, 0.05, 0.06, 0.1, t);
      const stab = window4(0.06, 0.12, 0.24, 0.5, t);
      P.pitch = mix(P.pitch, -0.2, back);
      P.stretch = mix(P.stretch, 0.75, back);
      P.headFwd = mix(P.headFwd, -0.12, back);
      P.headPitch = mix(P.headPitch, -0.3, back);
      P.bob -= 0.06 * back;
      P.pitch = mix(P.pitch, 0.55, stab);
      P.reach = stab;
      P.stretch = mix(P.stretch, 1.25, stab);
      P.headFwd = mix(P.headFwd, 0.16, stab);
      P.headPitch = mix(P.headPitch, 0.1, stab);
      P.headYaw *= 1 - stab;
      P.bob -= 0.05 * stab;
      P.jaw = 0.5 * window4(0.05, 0.1, 0.12, 0.14, t);
      P.wingL = P.wingR = mix(P.wingL, 0.55, Math.max(back, stab));
      P.sweepL = P.sweepR = -0.35 * stab;
      P.look.set(0, 0.15);
      P.squash *= 1 - 0.12 * back + 0.14 * stab;   // gathers, then stretches into the stab
      P.tail.y += 0.4 * stab;
    },
  },

  // Side throw, with a prop in the bill: the head turns far to the side as a wind-up, then whips across
  // the front, and the bill opens at the front of the whip ('fling'). The body turns with the head.
  sideThrow: {
    length: 0.8, fadeIn: 0.04, fadeOut: 0.2, mask: UPPER, face: 'effort',
    events: [{ at: 0.22, type: 'whoosh' }, { at: 0.26, type: 'fling' }],
    apply(P, t) {
      const wind = smoothstep(0, 0.18, t) * (1 - smoothstep(0.18, 0.26, t));
      const whip = window4(0.18, 0.27, 0.4, 0.75, t);
      P.headYaw = 2.0 * wind - 1.1 * whip;
      P.yaw += 0.6 * wind - 0.45 * whip;
      P.roll += 0.12 * wind - 0.08 * whip;
      P.bob -= 0.05 * wind - 0.03 * whip;
      P.headRoll = -0.3 * wind + 0.25 * whip;
      P.headPitch = mix(mix(P.headPitch, 0.1, wind), -0.45, whip);
      P.stretch = mix(P.stretch, 0.85, wind);
      P.stretch = mix(P.stretch, 1.4, whip);
      P.headFwd = mix(P.headFwd, 0.15, whip);
      P.pitch = mix(P.pitch, 0.1, whip);
      P.jaw = 0.12 * wind + 0.8 * window4(0.24, 0.27, 0.4, 0.55, t);
      P.wingL = mix(P.wingL, 0.5, wind) + 0.3 * whip;
      P.wingR = mix(P.wingR, 0.8, whip);
      blendFace(P, 'smug', smoothstep(0.45, 0.6, t));
      P.tail.x -= 0.5 * whip;
      P.tail.x += 0.4 * wind;
    },
  },

  // Tug: the bill grips something low in front, the feet brace, and the bird leans far back and heaves
  // three times with the wings beating, stepping backward, the neck pulled long. Then the grip slips:
  // it shoots back and sits down hard, then gets up.
  tug: {
    length: 3.1, fadeIn: 0.04, fadeOut: 0.3, mask: ALL, moveMask: UPPER, face: 'effort',
    root: t => (t < 0.45 ? 0 : t < 1.95 ? -0.7 * Math.max(Math.sin(TAU * 1.8 * (t - 0.45)), 0.15) : t < 2.15 ? -2.4 : 0),
    events: [
      { at: 0.22, type: 'clack', amount: 0.6 }, ...[0.55, 1.1, 1.65].map(at => ({ at, type: 'stamp' })), { at: 1.98, type: 'drop' },
      { at: 2.0, type: 'call', pitch: 1.3, gain: 0.6 }, { at: 2.2, type: 'thump', amount: 14, dust: 'rump' },
    ],
    apply(P, t) {
      const grip = window4(0, 0.2, 1.95, 2.05, t);
      const brace = window4(0.22, 0.42, 1.95, 2.05, t);
      const heave = Math.max(Math.sin(TAU * 1.8 * (t - 0.45)), 0) * window4(0.4, 0.5, 1.85, 1.95, t);
      const pull = window4(0.4, 0.5, 1.85, 1.95, t);
      const sit = window4(2.12, 2.25, 2.55, 2.9, t);
      const fling = window4(1.95, 2.0, 2.1, 2.3, t);
      // Down to the grip, then the body leans far back and the neck pulls out long and low.
      P.pitch = mix(mix(P.pitch, 0.6, grip), -0.35, brace) - 0.1 * heave - 0.5 * fling - 0.45 * sit;
      P.bob += -0.06 * grip + 0.02 * brace - 0.32 * sit;
      P.neck = mix(P.neck, 0.6, grip);
      P.reach = 0.6 * brace;
      P.stretch = mix(P.stretch, 1.15, grip) + 0.3 * heave;
      P.headFwd = 0.06 * brace + 0.1 * heave;
      P.headPitch = mix(mix(P.headPitch, 0.8, grip), 0.45, brace) - 0.7 * fling + 0.3 * sit;
      P.headYaw = 0.15 * Math.sin(TAU * 7 * t) * heave;
      // Open, shut on the grip, open as it slips.
      P.jaw = 0.6 * window4(0.02, 0.12, 0.18, 0.22, t) + 0.12 * grip * smoothstep(0.2, 0.22, t) + 0.6 * window4(1.95, 1.98, 2.15, 2.4, t);
      P.roll += 0.07 * Math.sin(TAU * 1.8 * (t - 0.45)) * grip;
      P.footL.set(mix(P.footL.x, 0.33, grip), P.footL.y, mix(P.footL.z, 0.42, grip));
      P.footR.set(mix(P.footR.x, -0.33, grip), P.footR.y, mix(P.footR.z, 0.22, grip));
      // Sat down: the feet out in front, off the ground.
      P.footL.set(mix(P.footL.x, 0.3, sit), mix(P.footL.y, 0.25, sit), mix(P.footL.z, 0.45, sit));
      P.footR.set(mix(P.footR.x, -0.3, sit), mix(P.footR.y, 0.2, sit), mix(P.footR.z, 0.4, sit));
      P.splay = mix(P.splay, 0.3, grip);
      // The wings beat hard while it pulls, and fly up as it falls back.
      P.wingL = P.wingR = mix(P.wingL, 0.3, grip) + 0.6 * Math.abs(Math.sin(TAU * 4 * t)) * pull + 1.0 * fling + 0.3 * sit;
      P.sweepL = P.sweepR = -0.2 * heave;
      blendFace(P, 'wide', Math.max(fling, sit));
      // The hands beat with the wings, the tail lifts with each heave, flat on the sit.
      P.curlL += 0.5 * Math.sin(TAU * 4 * t + 1.2) * pull;
      P.curlR += 0.5 * Math.sin(TAU * 4 * t + 1.4) * pull;
      P.tail.y += 0.35 * heave + 0.4 * fling;
      P.squash *= 1 - 0.25 * sit;
    },
  },

  // Rummage: the head goes deep down in front, the tail goes up, and the bill digs fast from side to
  // side. Twice the head comes up and flicks something away over a shoulder. Then it comes up chewing.
  rummage: {
    length: 2.6, fadeIn: 0.05, fadeOut: 0.3, mask: ALL, moveMask: UPPER, face: 'squint',
    events: [{ at: 0.9, type: 'whoosh' }, { at: 1.55, type: 'whoosh' }, ...[2.05, 2.2, 2.35].map(at => ({ at, type: 'clack', amount: 0.4 }))],
    apply(P, t) {
      const down = window4(0, 0.15, 1.85, 2.05, t);
      const flick = window4(0.76, 0.86, 0.92, 1.1, t) + window4(1.41, 1.51, 1.57, 1.75, t);
      const side = t < 1.2 ? 1 : -1;
      const dig = (1 - flick) * down;
      const w = TAU * 7 * t;
      P.pitch = mix(P.pitch, 1.05, down) - 0.6 * flick;
      P.bob -= 0.06 * down - 0.04 * flick;
      P.neck = mix(P.neck, 1, dig);
      P.headPitch = mix(P.headPitch, 1.2, dig) + 0.15 * Math.sin(2 * w) * dig;
      P.headYaw = 0.5 * Math.sin(w) * dig + 1.3 * side * flick;
      P.headRoll = 0.2 * Math.sin(w + 1) * dig;
      P.headPitch -= 0.9 * flick;
      P.headFwd = 0.05 * Math.sin(2 * w + 0.5) * dig;
      P.jaw = 0.3 * Math.max(Math.sin(2 * w), 0) * dig + 0.7 * window4(0.86, 0.9, 0.96, 1.02, t) + 0.7 * window4(1.51, 1.55, 1.61, 1.67, t);
      P.roll += 0.08 * Math.sin(w * 0.5) * down;
      P.yaw += 0.25 * side * flick;
      P.wingL = P.wingR = mix(P.wingL, 0.2, down) + 0.12 * Math.sin(w) * dig + 0.4 * flick;
      P.footL.set(mix(P.footL.x, 0.3, down), P.footL.y, P.footL.z);
      P.footR.set(mix(P.footR.x, -0.3, down), P.footR.y, P.footR.z);
      // Up and chewing.
      const chew = window4(1.95, 2.05, 2.4, 2.6, t);
      P.headPitch = mix(P.headPitch, -0.15, chew);
      P.jaw = Math.max(P.jaw, 0.2 * Math.max(Math.sin(TAU * 6.7 * (t - 1.95)), 0) * chew);
      blendFace(P, 'happy', chew);
    },
  },

  // Knocked over: a big hit throws the bird back onto its side with the wings out. It lies there with
  // the legs kicking in the air, then rolls back over, scrambles up and shakes its head.
  knockedOver: {
    length: 2.6, fadeIn: 0.02, fadeOut: 0.3, mask: ALL, lock: true, cancelAfter: 2.0,
    root: t => (t < 0.3 ? -2.4 : t < 0.45 ? -0.6 : 0),
    events: [{ at: 0.01, type: 'thump', amount: 12 }, { at: 0.02, type: 'call', pitch: 1.3 }, { at: 0.42, type: 'thump', amount: 16, dust: 'rump' }],
    apply(P, t) {
      const hit = window4(0, 0.04, 0.12, 0.3, t);
      const down = window4(0.15, 0.42, 1.45, 1.85, t);
      const kick = window4(0.5, 0.6, 1.2, 1.4, t);
      const shake = window4(2.0, 2.05, 2.35, 2.5, t);
      // The hit: head back, wings out.
      P.headPitch = mix(P.headPitch, -0.6, hit);
      P.pitch = mix(P.pitch, -0.3, hit);
      P.stretch = mix(P.stretch, 0.8, hit);
      P.wingL = mix(P.wingL, 1.2, hit);
      P.wingR = mix(P.wingR, 1.1, hit);
      // The feet fly up in front as it goes back.
      P.footL.z += 0.3 * hit;
      P.footL.y += 0.1 * hit;
      // On its right side: the body rolls over, the legs come up to the left.
      P.roll = mix(P.roll, 1.35, down) + 0.06 * Math.sin(TAU * 3 * t) * kick;
      P.bob = mix(P.bob, -0.42, down);
      P.x = mix(P.x, -0.25, down);
      P.pitch = mix(P.pitch, 0.1, down);
      // The neck lies down with the body, and the head lies on its side on the ground.
      P.neckBody = down;
      P.tip.y += 0.06 * down;   // the head on the ground, not in it
      P.headRoll = mix(P.headRoll, 1.2, down);
      P.headPitch = mix(P.headPitch, 0.2, down);
      const k = TAU * 3.5 * t;
      P.footL.lerp(new Vector3(0.55 + 0.08 * Math.sin(k) * kick, 0.35 + 0.1 * Math.cos(k) * kick, 0.15 + 0.12 * Math.sin(k) * kick), down);
      P.footR.lerp(new Vector3(0.3 + 0.08 * Math.sin(k + 2) * kick, 0.12 + 0.1 * Math.cos(k + 2) * kick, 0.55 + 0.12 * Math.sin(k + 2) * kick), down);
      P.wingL = mix(P.wingL, 0.7 + 0.3 * Math.sin(TAU * 4 * t) * kick, down);
      P.wingR = mix(P.wingR, 0.15, down);
      P.jaw = 0.35 * hit + 0.2 * kick;
      // Dazed on the ground, then a head shake when up.
      const daze = window4(0.45, 0.55, 1.5, 1.8, t);
      P.look.set(0.7 * Math.cos(TAU * 2.2 * t) * daze, 0.6 * Math.sin(TAU * 2.2 * t) * daze);
      P.headYaw += 0.4 * Math.sin(TAU * 6 * t) * shake;
      P.jaw += 0.1 * shake;
      blendFace(P, 'wide', hit);
      blendFace(P, 'dazed', daze);
      blendFace(P, 'squint', shake);
      P.curlL += 0.6 * Math.sin(TAU * 4 * t) * kick + 0.5 * hit;
      P.curlR += 0.5 * hit;
      P.tail.y += 0.5 * hit;
    },
  },

  // Slip on a wet patch: the feet shoot apart, front and back, the body drops into the splits and the
  // wings flail. The feet scissor back under it, a wobble, then it stands and shakes out its feathers.
  slip: {
    length: 1.9, fadeIn: 0.02, fadeOut: 0.3, mask: ALL, lock: true, cancelAfter: 1.4, face: 'wide',
    events: [{ at: 0.03, type: 'call', pitch: 1.45, gain: 0.6 }, { at: 0.2, type: 'thump', amount: 8 }],
    apply(P, t) {
      const split = window4(0, 0.16, 0.5, 1.0, t);
      const flail = window4(0, 0.06, 0.9, 1.2, t);
      const wobble = Math.sin(TAU * 3 * (t - 0.2)) * window4(0.2, 0.3, 0.8, 1.05, t);
      const fluff = window4(1.25, 1.32, 1.55, 1.7, t);
      P.footL.set(mix(P.footL.x, 0.2, split), mix(P.footL.y, 0.04, split), mix(P.footL.z, 0.62, split) + 0.06 * wobble);
      P.footR.set(mix(P.footR.x, -0.34, split), mix(P.footR.y, 0.04, split), mix(P.footR.z, -0.6, split) - 0.06 * wobble);
      P.bob = mix(P.bob, -0.3, split);
      P.pitch = mix(P.pitch, -0.05, split);
      P.roll += 0.12 * wobble;
      P.yaw += 0.08 * wobble;
      P.headPitch = mix(P.headPitch, 0.1, split);
      P.stretch = mix(P.stretch, 1.15, flail);
      P.headRoll = -0.15 * wobble;
      const w = TAU * 6 * t;
      P.wingL = mix(P.wingL, 1.25 + 0.35 * Math.sin(w), flail);
      P.wingR = mix(P.wingR, 1.25 + 0.35 * Math.sin(w + 1.8), flail);
      P.sweepL = 0.25 * Math.sin(w + 0.8) * flail;
      P.sweepR = 0.25 * Math.sin(w + 2.6) * flail;
      P.jaw = 0.3 * flail;
      // Up, and a quick fluff of the feathers.
      P.roll += 0.1 * Math.sin(TAU * 8 * t) * fluff;
      P.wingL += 0.25 * fluff;
      P.wingR += 0.25 * fluff;
      blendFace(P, 'squint', fluff);
      blendFace(P, 'smug', window4(1.6, 1.7, 1.8, 1.9, t));
      // The wing hands windmill, the tail flicks up.
      P.curlL += 0.7 * Math.sin(w) * flail;
      P.curlR += 0.7 * Math.sin(w + 1.5) * flail;
      P.tail.y += 0.5 * flail;
      P.squash *= 1 - 0.2 * split;
    },
  },

  // Hard landing, after a big fall: a deep squash with the wings thrown out, a wobble from side to side,
  // then up with a relieved little shake.
  hardLand: {
    length: 1.4, fadeIn: 0.01, fadeOut: 0.3, mask: ALL, lock: true, cancelAfter: 0.7, face: 'wide',
    events: [{ at: 0.01, type: 'thump', amount: 18, dust: 'feet' }, { at: 0.02, type: 'stamp' }],
    apply(P, t) {
      const squash = window4(0, 0.05, 0.25, 0.7, t);
      const wobble = Math.sin(TAU * 2.5 * (t - 0.15)) * window4(0.15, 0.25, 0.6, 0.8, t);
      const shake = window4(0.9, 0.95, 1.15, 1.25, t);
      P.bob -= 0.16 * squash;
      P.squash *= 1 - 0.3 * squash;   // flat and wide on the impact
      P.pitch = mix(P.pitch, 0.3, squash);
      P.stretch = mix(P.stretch, 0.75, squash);
      P.headFwd += 0.14 * squash;   // the head stays in front of the chest
      P.headPitch = mix(P.headPitch, -0.1, squash);   // the bill stays off the ground
      P.footL.x = mix(P.footL.x, 0.33, squash);
      P.footR.x = mix(P.footR.x, -0.33, squash);
      P.splay = mix(P.splay, 0.35, squash);
      P.wingL = mix(P.wingL, 1.3 - 0.9 * smoothstep(0.05, 0.5, t), squash);
      P.wingR = mix(P.wingR, 1.2 - 0.85 * smoothstep(0.05, 0.5, t), squash);
      P.roll += 0.15 * wobble;
      P.headRoll = -0.2 * wobble;
      P.jaw = 0.3 * squash;
      P.headYaw += 0.3 * Math.sin(TAU * 7 * t) * shake;
      blendFace(P, 'dazed', window4(0.3, 0.4, 0.8, 0.9, t));
      blendFace(P, 'squint', shake);
    },
  },

  // Preen: the head goes round to the left side and back over the wing, and the bill nibbles along the
  // feathers; then forward and down to the chest for more; then the head comes up and the feathers fluff
  // out. The neck end (tip) moves out to the side, so the head stays outside the body.
  preen: {
    length: 3.2, fadeIn: 0.1, fadeOut: 0.3, mask: UPPER, face: 'squint',
    // Soft nibbles at the wing and the chest, then the fluff.
    events: [
      ...[0.45, 0.75, 1.05, 1.75, 2.0].map(at => ({ at, type: 'clack', amount: 0.15 })),
      { at: 2.55, type: 'ruffle', length: 0.4 },
    ],
    apply(P, t) {
      const wing = window4(0, 0.35, 1.25, 1.5, t);
      const chest = window4(1.4, 1.65, 2.3, 2.55, t);
      const fluff = window4(2.55, 2.62, 2.85, 3.0, t);
      const nib = Math.sin(TAU * 7 * t), stroke = Math.sin(TAU * 1.4 * t);
      const nibble = Math.max(wing, chest) * (wing > 0.9 || chest > 0.9 ? 1 : 0);
      // Wing: out to the left and back, the bill turned back and down onto the wing.
      P.tip.x += 0.34 * wing;
      P.tip.y -= 0.08 * wing;
      P.tip.z -= 0.28 * wing;
      P.headYaw = mix(P.headYaw, 2.5 + 0.12 * stroke, wing);
      P.headPitch = mix(P.headPitch, 0.55, wing);
      P.headRoll = mix(P.headRoll, -0.3, wing);
      P.yaw -= 0.2 * wing;
      P.roll -= 0.1 * wing;
      P.wingL = mix(P.wingL, 0.3 + 0.06 * stroke, wing);
      P.sweepL = 0.15 * wing;
      // Chest: the head forward and down, the bill turned back under it to the chest.
      P.tip.y -= 0.1 * chest;
      P.tip.z += 0.35 * chest;
      P.headPitch = mix(P.headPitch, 1.4 + 0.12 * stroke, chest);
      P.pitch = mix(P.pitch, 0.05, chest);
      P.jaw = 0.15 * Math.max(nib, 0) * nibble;
      P.headYaw += 0.06 * nib * nibble;
      // Fluff out.
      P.roll += 0.12 * Math.sin(TAU * 8 * t) * fluff;
      P.wingL += 0.25 * fluff;
      P.wingR += 0.25 * fluff;
      P.stretch *= 1 - 0.1 * fluff;
      blendFace(P, 'happy', smoothstep(2.85, 3.0, t));
      // The fluff: wider, with a tail wag.
      P.squash *= 1 - 0.12 * fluff;
      P.tail.x += 0.4 * Math.sin(TAU * 8 * t) * fluff;
    },
  },

  // Wing stretch: the left wing and the left leg stretch out and back together, then both wings go up
  // high over the back with the chest out, and fold with a shiver.
  wingStretch: {
    length: 2.8, fadeIn: 0.1, fadeOut: 0.3, mask: ALL, moveMask: UPPER, face: 'squint',
    events: [{ at: 0.05, type: 'ruffle', length: 0.3 }, { at: 1.35, type: 'ruffle', length: 0.3 }, { at: 2.35, type: 'ruffle', length: 0.35 }],
    apply(P, t) {
      const one = window4(0, 0.35, 0.95, 1.2, t);
      const both = window4(1.3, 1.6, 2.1, 2.4, t);
      const shiver = window4(2.35, 2.4, 2.6, 2.75, t);
      P.wingL = mix(P.wingL, 1.35, one);
      P.sweepL = mix(P.sweepL, -0.7, one);
      P.footL.set(mix(P.footL.x, 0.28, one), mix(P.footL.y, 0.12, one), mix(P.footL.z, -0.4, one));
      P.footR.x = mix(P.footR.x, -0.12, one);
      P.x -= 0.08 * one;
      P.roll += 0.12 * one;
      P.pitch = mix(P.pitch, 0.45, one);
      P.reach = 0.4 * one;
      P.headPitch = mix(P.headPitch, 0.2, one);
      P.wingL = mix(P.wingL, 1.8, both);
      P.wingR = mix(P.wingR, 1.8, both);
      P.sweepL = mix(P.sweepL, 0.15, both);
      P.sweepR = mix(P.sweepR, 0.15, both);
      P.pitch = mix(P.pitch, -0.15, both);
      P.stretch = mix(P.stretch, 1.15, both);
      P.headPitch = mix(P.headPitch, -0.45, both);
      P.jaw = 0.25 * window4(1.5, 1.7, 1.95, 2.1, t);
      P.roll += 0.06 * Math.sin(TAU * 9 * t) * shiver;
      blendFace(P, 'happy', both);
      blendFace(P, 'smug', smoothstep(2.6, 2.75, t));
      // The hands open out at the full stretch, the tail lifts, the body stretches tall.
      P.curlL += 0.6 * Math.max(one, both);
      P.curlR += 0.6 * both;
      P.tail.y += 0.4 * both;
      P.squash *= 1 + 0.1 * both;
    },
  },

  // Toss and gulp (src/gulp/). The game holds the head up to catch (its stance); these play over it.

  // The bill shuts on a falling item: its weight takes the head and the body down hard, the knees give,
  // then the bird comes back up past where it was, and settles.
  catch: {
    length: 0.7, fadeIn: 0.01, fadeOut: 0.15, mask: { root: 1, body: 1, neck: 1, jaw: 1, wings: 1, face: 1 }, moveMask: UPPER,
    events: [{ at: 0.01, type: 'clack', amount: 0.7 }],
    apply(P, t) {
      const give = window4(0, 0.06, 0.12, 0.35, t);
      const back = Math.sin(TAU * 2.2 * (t - 0.3)) * window4(0.3, 0.38, 0.5, 0.7, t);
      P.headPitch += 0.8 * give - 0.15 * back;
      P.neck = mix(P.neck, P.neck + 0.25, give);
      P.stretch *= 1 - 0.3 * give + 0.06 * back;
      P.bob -= 0.12 * give - 0.03 * back;
      P.pitch += 0.25 * give - 0.05 * back;
      P.wingL = P.wingR = P.wingL + 0.5 * give;
      blendFace(P, 'effort', give);
      P.squash *= 1 - 0.2 * give;
      P.tail.y += 0.45 * give;
    },
  },
  // A flick of the head: a dip, then a whip up. 'toss' at the top lets go of the item.
  toss: {
    length: 0.45, fadeIn: 0.02, fadeOut: 0.15, mask: UPPER, face: 'effort',
    events: [{ at: 0.13, type: 'toss' }, { at: 0.12, type: 'whoosh' }],
    apply(P, t) {
      const dip = window4(0, 0.06, 0.08, 0.13, t), whip = window4(0.08, 0.13, 0.2, 0.45, t);
      P.headPitch += 0.6 * dip - 0.8 * whip;
      P.stretch *= 1 - 0.2 * dip + 0.3 * whip;
      P.pitch += 0.12 * dip - 0.15 * whip;
      P.bob += -0.06 * dip + 0.06 * whip;
      P.jaw = Math.max(P.jaw, 0.9 * window4(0.12, 0.14, 0.22, 0.32, t));
      P.wingL = P.wingR = P.wingL + 0.6 * whip;
      P.tail.y += 0.4 * whip;
    },
  },
  // Swallow: the head goes back with the bill to the sky and the item goes in, the bill shuts, then
  // three hard gulps as the lump goes down the neck, and a happy shiver.
  gulp: {
    length: 1.25, fadeIn: 0.04, fadeOut: 0.2, mask: ALL, moveMask: UPPER, face: 'effort',
    events: [{ at: 0.24, type: 'clack', amount: 0.9 }, ...[0.4, 0.62, 0.84].map((at, beat) => ({ at, type: 'gulp', beat }))],
    apply(P, t) {
      const back = window4(0, 0.12, 0.85, 1.05, t);
      const beat = [0.4, 0.62, 0.84].reduce((m, at) => Math.max(m, window4(at - 0.04, at, at + 0.03, at + 0.12, t)), 0);
      P.headPitch = mix(P.headPitch, -1.9, back) + 0.2 * beat;
      P.stretch = mix(P.stretch, 1.25, back) * (1 - 0.22 * beat);
      P.pitch = mix(P.pitch, -0.18, back) + 0.08 * beat;
      P.bob -= 0.06 * beat;
      P.headRoll = 0.14 * Math.sin(TAU * 3 * t) * back;
      P.jaw = Math.max(P.jaw, 0.95 * window4(0, 0.06, 0.18, 0.24, t));
      P.wingL = P.wingR = P.wingL + 0.4 * beat;
      const done = window4(0.95, 1.02, 1.15, 1.25, t);
      P.roll += 0.08 * Math.sin(TAU * 9 * t) * done;
      blendFace(P, 'happy', done);
      P.squash *= 1 - 0.12 * beat;   // each gulp shakes the body down
      P.tail.x += 0.35 * Math.sin(TAU * 9 * t) * done;
    },
  },
  // An item lands on the head: the head is knocked down into the shoulders, the wings fly out, and the
  // eyes roll.
  bonk: {
    length: 1.2, fadeIn: 0.01, fadeOut: 0.25, mask: ALL, moveMask: UPPER, face: 'wide',
    events: [{ at: 0.01, type: 'thump', amount: 10 }, { at: 0.05, type: 'call', pitch: 1.35, gain: 0.5 }],
    apply(P, t) {
      const hit = window4(0, 0.03, 0.12, 0.45, t), daze = window4(0.2, 0.3, 0.95, 1.2, t);
      P.headPitch = mix(P.headPitch, 0.5, hit);
      P.stretch = mix(P.stretch, 0.65, hit);
      P.bob -= 0.08 * hit;
      P.jaw = Math.max(P.jaw, 0.35 * hit);
      P.wingL = mix(P.wingL, 0.9, hit);
      P.wingR = mix(P.wingR, 0.8, hit);
      P.headRoll = 0.25 * Math.sin(TAU * 1.6 * t) * daze;
      P.headYaw += 0.15 * Math.sin(TAU * 0.9 * t) * daze;
      P.look.set(0.7 * Math.cos(TAU * 2.4 * t) * daze, 0.6 * Math.sin(TAU * 2.4 * t) * daze);
      blendFace(P, 'dazed', daze);
      // Flattened by the hit, the tail and the hands fly up.
      P.squash *= 1 - 0.35 * hit;
      P.tail.y += 0.6 * hit;
      P.curlL += 0.6 * hit;
      P.curlR += 0.6 * hit;
    },
  },
  // A snap at nothing: the bill shuts on air, the head overshoots up, then a blank look about.
  whiff: {
    length: 0.75, fadeIn: 0.01, fadeOut: 0.2, mask: UPPER, face: 'wide',
    events: [{ at: 0.07, type: 'clack', amount: 1 }],
    apply(P, t) {
      const lunge = window4(0, 0.05, 0.1, 0.3, t), shrug = window4(0.3, 0.38, 0.5, 0.65, t);
      P.stretch *= 1 + 0.25 * lunge;
      P.headFwd += 0.1 * lunge;
      P.headPitch -= 0.25 * lunge;
      P.jaw = Math.max(P.jaw, 0.8 * window4(0, 0.03, 0.05, 0.07, t));
      P.wingL = P.wingR = P.wingL + 0.4 * shrug;
      P.headRoll = 0.25 * window4(0.25, 0.35, 0.6, 0.75, t);
      P.look.set(0.8 * Math.sin(TAU * 2 * t) * window4(0.2, 0.3, 0.55, 0.7, t), P.look.y);
    },
  },
  // After a big meal: the chest puffs out, a deep honk (the burp), then a smug look.
  burp: {
    length: 1.0, fadeIn: 0.05, fadeOut: 0.2, mask: UPPER, face: 'squint',
    events: [{ at: 0.32, type: 'call', pitch: 0.55, gain: 0.9 }],
    apply(P, t) {
      const puff = window4(0, 0.25, 0.4, 0.6, t), out = window4(0.3, 0.34, 0.45, 0.6, t);
      P.pitch -= 0.18 * puff;
      P.stretch *= 1 + 0.1 * puff;
      P.headPitch -= 0.3 * puff;
      P.jaw = Math.max(P.jaw, 0.5 * out);
      P.wingL = P.wingR = P.wingL + 0.25 * out;
      blendFace(P, 'smug', smoothstep(0.55, 0.7, t));
      P.squash *= 1 - 0.14 * puff + 0.1 * out;   // the belly puffs out, then the burp
    },
  },
  // Out of lives: a long wobble, then the bird topples back onto its bottom and lies there with its feet
  // in the air and its eyes rolling. Plays until stop().
  faint: {
    length: Infinity, fadeIn: 0.05, fadeOut: 0.5, mask: ALL, lock: true, cancelAfter: Infinity, face: 'dazed',
    events: [{ at: 0.05, type: 'call', pitch: 0.75, gain: 0.8 }, { at: 0.95, type: 'thump', amount: 16, dust: 'rump' }],
    apply(P, t) {
      const wobble = window4(0, 0.1, 0.6, 0.8, t) * Math.sin(TAU * 2.2 * t);
      const fall = smoothstep(0.6, 0.95, t), bounce = 0.04 * window4(0.95, 1.0, 1.05, 1.2, t);
      P.roll += 0.2 * wobble;
      P.headRoll = 0.4 * wobble;
      P.bob = mix(P.bob, -0.3, fall) + bounce;
      P.pitch = mix(P.pitch, -1.05, fall);
      // The neck goes back with the body and the head flops over to one side, on the ground.
      P.neckBody = smoothstep(0.55, 0.85, t);   // ahead of the fall, so the chest does not come up into the head
      P.tip.z -= 0.3 * window4(0.6, 0.8, 0.95, 1.15, t);   // the head back, away from the chest, as it tips
      P.tip.x += 0.42 * fall;
      P.tip.y -= 0.35 * fall;
      P.headRoll = mix(P.headRoll, 1.1, fall);
      P.headPitch = mix(P.headPitch, -0.2, fall);
      // The legs straight up in the air, out of the belly, the feet twitching.
      const twitch = 0.04 * Math.sin(TAU * 1.7 * t) * smoothstep(1.2, 1.5, t);
      P.footL.lerp(new Vector3(0.36, 0.72 + twitch, 0.32), fall);
      P.footR.lerp(new Vector3(-0.34, 0.68 - twitch, 0.36), fall);
      P.splay = mix(P.splay, 0.5, fall);
      P.wingL = mix(P.wingL, 0.9, fall);
      P.wingR = mix(P.wingR, 0.8, fall);
      P.jaw = 0.3 * fall;
      const roll = smoothstep(0.9, 1.2, t);
      P.look.set(0.8 * Math.cos(TAU * 1.5 * t) * roll, 0.7 * Math.sin(TAU * 1.5 * t) * roll);
      P.tail.y -= 0.3 * fall;
    },
  },
};

// Defaults, and the channels that each action blends (in either mask).
for (const def of Object.values(ACTIONS)) {
  def.moveMask ??= def.mask;
  def.channels = [...new Set([...Object.keys(def.mask), ...Object.keys(def.moveMask)])];
}
