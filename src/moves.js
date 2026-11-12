// Demo moves: the buttons of index.html and sdf.html, and the anim URL parameter (anim = index + 1).
// A move's script drives a Character as a player would: script() gives a function (c, t) to call each
// step, with t the time since the move started. Scripts loop, so a fixed t (anim=N&t=T) gives one pose,
// the same in both views.
import { Vector3 } from 'three';
import { ACTIONS } from './ibis/motion/actions.js';
import { Character } from './ibis/motion/character.js';

export const ARENA = 3;   // radius of the demo walk circle

// Walks round the circle: aims at a point a little ahead on it.
const circle = fast => () => c => {
  const p = c.position, a = Math.atan2(p.x, p.z) + 0.5;
  c.input.move.set(ARENA * Math.sin(a) - p.x, ARENA * Math.cos(a) - p.z).normalize();
  c.input.fast = fast;
};

// Calls fn at t = 0 and then once each period seconds.
const every = (period, fn) => () => {
  let n = -1;
  return (c, t) => {
    const k = Math.floor(t / period);
    if (k !== n) { fn(c, n < 0); n = k; }
  };
};

// Plays an action again each time it ends. The first one starts at full weight, so the pose at t is the
// clip pose at t.
const repeat = (name, gap = 0) => every(ACTIONS[name].length + gap, (c, first) => c.act(name, first ? { fadeIn: 0 } : undefined));

const turn = c => c.turnTo(c.heading + Math.PI);
const prod = c => c.prod(new Vector3(0.6, 1.2, 0.6));   // from the front left

// press(c): what the button does once in free play. Moves without press run their script.
const action = (name, label, group, gap = 0.4) => ({ name: label, group, press: c => c.act(name), script: repeat(name, gap) });

// Plays first, then second after delay seconds, each period seconds.
const pair = (first, second, delay, period) => () => {
  let n = -1, done = false;
  return (c, t) => {
    const k = Math.floor(t / period);
    if (k !== n) { c.act(first, n < 0 ? { fadeIn: 0 } : undefined); n = k; done = false; }
    if (!done && t - k * period >= delay) { c.act(second); done = true; }
  };
};

// Plays each [name, at] at its time (seconds), each period seconds.
const chain = (steps, period) => () => {
  let n = -1, next = 0;
  return (c, t) => {
    const k = Math.floor(t / period);
    if (k !== n) { n = k; next = 0; }
    while (next < steps.length && t - k * period >= steps[next][1]) {
      const [name, at] = steps[next++];
      c.act(name, k === 0 && at === 0 ? { fadeIn: 0 } : undefined);
    }
  };
};

// Groups of the moveset page (moves.html), in order.
export const GROUPS = ['Gameplay', 'Interactions', 'Reactions', 'Expressive'];

// Moves after the first FREE_PLAY have no control in free play yet: only the fixed views and moves.html.
export const MOVES = [
  { name: 'Idle', group: 'Gameplay', script: () => () => {} },
  { name: 'Walk', group: 'Gameplay', loop: true, script: circle(false) },
  action('peck', 'Peck', 'Interactions', 0),
  // Free play: the button gives a squawk and a happy dance in turn.
  { ...action('squawk', 'Squawk', 'Expressive', 0), press: (() => { let n = 0; return c => c.act(n++ % 2 ? 'happy' : 'squawk'); })() },
  { name: 'Run', group: 'Gameplay', loop: true, script: circle(true) },
  // Hold the jump for a second: jump, then flutter. In free play the button is held like a game button.
  { name: 'Jump', group: 'Gameplay', hold: true, script: () => (c, t) => { c.input.jump = t % 2.4 < 1.0; } },
  action('happy', 'Happy', 'Expressive'),
  action('headShake', 'Shake head', 'Expressive'),
  action('threat', 'Threat', 'Expressive'),
  action('startle', 'Startle', 'Reactions', 0.6),
  action('stumble', 'Stumble', 'Reactions', 0.6),
  action('shake', 'Shake', 'Reactions'),
  // Turn round on the spot: the eyes, then the head, then the body.
  { name: 'Turn', group: 'Gameplay', press: turn, script: every(2, turn) },
  // Prods: the bird gets more annoyed with each one.
  { name: 'Prod', group: 'Reactions', press: prod, script: every(1.3, prod) },
  action('lunge', 'Lunge jab', 'Gameplay', 0.5),
  // Under a fallen bin (physics.js sets duck in the game).
  { name: 'Duck', group: 'Gameplay', script: () => c => { c.controller.duck = true; } },
  action('snap', 'Snap', 'Gameplay'),
  { name: 'Pick up', group: 'Interactions', script: chain([['peck', 0], ['lift', 0.1], ['drop', 1.3]], 2.2) },
  action('fumble', 'Fumble', 'Interactions'),
  action('drop', 'Drop', 'Interactions'),
  { name: 'Aim and fling', group: 'Interactions', script: pair('aim', 'fling', 0.9, 1.9) },
  action('sideThrow', 'Side throw', 'Interactions'),
  action('tug', 'Tug', 'Interactions'),
  action('rummage', 'Rummage', 'Interactions'),
  action('catch', 'Catch', 'Interactions', 0.9),
  action('toss', 'Toss', 'Interactions'),
  { name: 'Gulp', group: 'Interactions', press: c => c.act('gulp'), script: chain([['catch', 0], ['gulp', 0.6]], 2.3) },
  action('flinch', 'Flinch', 'Reactions'),
  action('bonk', 'Bonk', 'Reactions'),
  action('whiff', 'Whiff', 'Reactions'),
  action('knockedOver', 'Knocked over', 'Reactions', 0.6),
  action('slip', 'Slip', 'Reactions', 0.6),
  // A jump with a long flutter, and a hard landing when it comes down.
  { name: 'Hard landing', group: 'Reactions', script: () => {
    let air = false;
    return (c, t) => {
      const u = t % 3.4;
      c.input.jump = u < 1.2;
      if (air && c.controller.grounded) c.act('hardLand');
      air = !c.controller.grounded;
    };
  } },
  // Out of lives in Toss and Gulp: it lies there until stop().
  // It gets up (stop()) before the next faint.
  { name: 'Faint', group: 'Reactions', script: () => {
    const play = every(4, (c, first) => c.act('faint', first ? { fadeIn: 0 } : undefined))();
    return (c, t) => { play(c, t); if (t % 4 >= 3.2) c.animator.stop(); };
  } },
  action('glare', 'Glare', 'Expressive'),
  action('burp', 'Burp', 'Expressive'),
  action('preen', 'Preen', 'Expressive'),
  action('wingStretch', 'Wing stretch', 'Expressive'),
];
export const FREE_PLAY = 14;

// Starts move i on a character: clears the input and gives the step function.
export function startMove(c, i) {
  Object.assign(c.input, { fast: false, jump: false });
  c.input.move.set(0, 0);
  return MOVES[i].script();
}

const FIXED_STEP = 1 / 60;

// Runs move i on character c for t seconds at 60 steps per second. step(dt) updates the character (and
// anything that follows it, such as effects) once per step.
export function playScript(c, i, t, step = dt => c.update(dt)) {
  const run = startMove(c, i);
  let time = 0;
  do {
    const dt = Math.max(Math.min(FIXED_STEP, t - time), 1e-4);
    run(c, time);
    step(dt);
    time += dt;
  } while (time < t - 1e-9);
}

// The character after move i has run for t seconds.
export function scriptedCharacter(i, t, seed = 0) {
  const c = new Character({ seed });
  playScript(c, i, t);
  return c;
}
