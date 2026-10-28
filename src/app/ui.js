// The buttons. Free play: a joystick (input.js), a diamond of Threat, Squawk, Peck and Jump (bottom
// right; Jump acts while held; Squawk gives a squawk and a happy dance in turn), and the other one-shot
// actions in the top bar after Wet. Other views: one button for each move script.
//
//   const ui = new Ui({ play, anim, level, input, cycle, onMove });
//   ui.update();   // every frame: the Wet button follows the player's wet
import { MOVES } from '../moves.js';

// Icons: 24 by 24 SVG, filled shapes and lines (class s) with a little bow in the edges, so they look hand drawn.
const ICONS = {
  Jump: '<path d="M11.8 3 3 10.7 5.3 14l6.5-5 7 4.9 1.3-3.2z"/><path d="M11.8 12.5 6.5 17l1 4 4.3-4 4.7 4 1.3-3z"/>',
  Peck: '<path d="M5 13a7 7 0 0 0 6 6v2a9 9 0 0 1-8-8zm16 0a9 9 0 0 1-8 8v-2a7 7 0 0 0 6-6zM11 5a7 7 0 0 0-6 6H3a9 9 0 0 1 8-8zm2-2a9 9 0 0 1 8 8h-2a7 7 0 0 0-6-6zm3 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0"/>',
  Squawk: '<ellipse fill="currentColor" cx="8" cy="19" rx="5" ry="4"/><path d="M13 19.5 10.5 17V3.5l11 4-2 4-5.5-4z"/>',
  Threat: '<path d="m8 1.7 7.7.9L14.6 15H9.7z"/><circle cx="12" cy="20" r="3.1"/>',
};
const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const DIAMOND = [   // grid cell, move
  ['1 / 2', 'Threat'],
  ['2 / 1', 'Squawk'],
  ['2 / 3', 'Peck'],
  ['3 / 2', 'Jump'],
];
// Not in the free play row: the joystick and the diamond do them, or the bird does them itself (Shake
// head in the prod chain, Startle at the end of it, Happy from Squawk, Stumble when it runs into the bin or
// is prodded at a run).
const PAD = ['Idle', 'Walk', 'Run', 'Jump', 'Peck', 'Squawk', 'Threat', 'Turn', 'Prod', 'Shake head', 'Stumble',
  'Happy', 'Startle'];

export class Ui {
  // input: free play input, or null. cycle: DayCycle or null. onMove(i): a move button in the other views.
  constructor({ play, anim, level, input, cycle = null, onMove }) {
    this.level = level;
    const bird = level.player ?? level.ibises[0], bar = document.getElementById('bar');
    const topActions = document.createDocumentFragment();   // free play: the other actions, in the top bar after Wet
    if (play) {
      const acts = document.getElementById('acts');
      for (const [area, name] of DIAMOND) {
        const move = MOVES[MOVES.findIndex(m => m.name === name)];
        const b = document.createElement('button');
        b.style.gridArea = area;
        b.setAttribute('aria-label', name);
        b.title = name;
        b.innerHTML = icon(name);
        if (move.hold) hold(b, on => { if (on) input.free(); input.jump = on; });
        else b.addEventListener('pointerdown', () => move.press(bird.character));
        acts.appendChild(b);
      }
      acts.hidden = false;
      const stick = document.getElementById('stick');
      input.bindStick(stick);
      // The orbit controls listen for pointer moves on the whole document and do not check the pointer id.
      // Stop the moves of a finger on the joystick or a button there, or the camera jumps to that finger.
      for (const el of [stick, acts]) for (const ev of ['pointermove', 'pointerup']) el.addEventListener(ev, e => e.stopPropagation());
      bar.hidden = true;
    }
    this.buttons = [];
    for (const [i, move] of MOVES.entries()) {
      if (play && PAD.includes(move.name)) continue;
      const b = document.createElement('button');
      b.textContent = move.name;
      b.setAttribute('aria-pressed', String(i === anim - 1 && (move.loop || !play)));
      onPress(b, () => {
        if (play) { move.press(bird.character); return; }
        onMove(i);
        this.setPressed(i);
      });
      (play ? topActions : bar).appendChild(b);
      this.buttons[i] = b;
    }
    // Top bar: the time of day (tap or N: the next period), Wet (also washes the mud off), then in free
    // play the other actions.
    const wet = this.wet = document.createElement('button');
    wet.textContent = 'Wet';
    onPress(wet, () => level.setWet(!this.wetOn()));
    this.cycle = cycle;
    const time = this.time = document.createElement('button');
    time.hidden = !cycle;
    onPress(time, () => cycle.next());
    if (cycle) addEventListener('keydown', e => { if (e.code === 'KeyN' && !e.repeat) cycle.next(); });
    this.update();
    document.getElementById('weather').append(time, wet, topActions);
  }

  wetOn() {
    const bird = this.level.player ?? this.level.ibises[0];   // none in the fly view
    return !!bird && this.level.target(bird).wet > 0;
  }

  update() {
    const on = String(this.wetOn());
    if (this.wet.getAttribute('aria-pressed') !== on) this.wet.setAttribute('aria-pressed', on);
    const period = this.cycle?.period ?? 'day', label = period[0].toUpperCase() + period.slice(1);
    if (this.time.textContent !== label) this.time.textContent = label;
  }

  // i: the move button to show pressed, or -1 for none.
  setPressed(i) { this.buttons.forEach((x, j) => x?.setAttribute('aria-pressed', String(j === i))); }
}

// Acts at once on a touch or pen, and on a click from a mouse or a key. A touch gives no click (lockScreen()
// in screen.js stops it), but a pen can: skip a click just after a press.
function onPress(b, fn) {
  let pressed = -Infinity;
  b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { pressed = e.timeStamp; fn(); } });
  b.addEventListener('click', e => { if (e.timeStamp - pressed > 1000) fn(); });
}

// On while a pointer holds it.
function hold(b, set) {
  b.addEventListener('pointerdown', e => { b.setPointerCapture(e.pointerId); set(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
}

// ui=0 hides the buttons and the joystick, for tools/strip.mjs.
export function hideUi() {
  for (const el of document.querySelectorAll('.bar, .stick, .acts')) el.style.display = 'none';
}
