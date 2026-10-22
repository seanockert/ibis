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
const action = (name, label, gap = 0.4) => ({ name: label, press: c => c.act(name), script: repeat(name, gap) });

export const MOVES = [
  { name: 'Idle', script: () => () => {} },
  { name: 'Walk', loop: true, script: circle(false) },
  action('peck', 'Peck', 0),
  action('squawk', 'Squawk', 0),
  action('flap', 'Flap', 0),
  { name: 'Run', loop: true, script: circle(true) },
  // Hold the jump for a second: jump, then flutter. In free play the button is held like a game button.
  { name: 'Jump', hold: true, script: () => (c, t) => { c.input.jump = t % 2.4 < 1.0; } },
  action('happy', 'Happy'),
  action('headShake', 'Shake head'),
  action('threat', 'Threat'),
  action('startle', 'Startle', 0.6),
  action('stumble', 'Stumble', 0.6),
  action('shake', 'Shake'),
  // Turn round on the spot: the eyes, then the head, then the body.
  { name: 'Turn', press: turn, script: every(2, turn) },
  // Prods: the bird gets more annoyed with each one.
  { name: 'Prod', press: prod, script: every(1.3, prod) },
];

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
