// The buttons. Free play: a joystick (input.js), a diamond of Threat, Squawk, Peck and Jump (bottom
// right; Jump acts while held; Squawk gives a squawk and a happy dance in turn), and the other one-shot
// actions in the top bar after Wet. Other views: one button for each move script.
//
//   const ui = new Ui({ play, anim, level, input, onMove });
//   ui.update();   // every frame: the Wet button follows the player's wet
import { MOVES } from '../moves.js';

// Icons: 24 by 24 SVG, filled shapes and lines (class s) with a little bow in the edges, so they look hand drawn.
const ICONS = {
  Jump: '<path d="M7.7 5.1 3.4 9.4l2.3 3.2 6-4 7.4 4 1.5-3.2-9.2-7.7zM14.9 17.1H9.7l-.6 4.6h6.3z"/><path d="M14.9 15.4H9.7l.3-3.7 1.7-1.1 2.6.8z"/>',
  Peck: '<path d="M22 18.1C21 .6 8 3.1 2.5 3.1c0 2.5-.5 8-.5 10.5 3.5-.5 6.5 3 11.5 8C13 15.1 11 15.1 8 10.1c5 .5 10 1.5 14 8"/><circle cx="17.5" cy="19.1" r="3" />',
  Squawk: '<ellipse cx="8" cy="19" rx="5" ry="4"/><path d="M13 19.5 10.5 17V3.5l11 4-2 4-5.5-4z"/>',
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
  // input: free play input, or null. onMove(i): a move button in the other views.
  constructor({ play, anim, level, input, onMove }) {
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
      input.bindStick(document.getElementById('stick'));
      bar.hidden = true;
    }
    this.buttons = [];
    for (const [i, move] of MOVES.entries()) {
      if (play && PAD.includes(move.name)) continue;
      const b = document.createElement('button');
      b.textContent = move.name;
      b.setAttribute('aria-pressed', String(i === anim - 1 && (move.loop || !play)));
      b.onclick = () => {
        if (play) { move.press(bird.character); return; }
        onMove(i);
        this.setPressed(i);
      };
      (play ? topActions : bar).appendChild(b);
      this.buttons[i] = b;
    }
    // Top bar: the Wet toggle (the ibis gets wet over two seconds, and dry again; wet also washes the mud
    // off), then in free play the other actions. Mud comes from the puddle.
    const wet = this.wet = document.createElement('button');
    wet.textContent = 'Wet';
    wet.onclick = () => level.setWet(!this.wetOn());
    this.update();
    document.getElementById('weather').append(wet, topActions);
  }

  wetOn() { return this.level.target(this.level.player ?? this.level.ibises[0]).wet > 0; }

  update() {
    const on = String(this.wetOn());
    if (this.wet.getAttribute('aria-pressed') !== on) this.wet.setAttribute('aria-pressed', on);
  }

  // i: the move button to show pressed, or -1 for none.
  setPressed(i) { this.buttons.forEach((x, j) => x?.setAttribute('aria-pressed', String(j === i))); }
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
