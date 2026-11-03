// The challenge list of a toy level (level JSON "mission" with "challenges"): a short list at the top,
// each ticked off when done, and a hint. Kinds: 'hits' (miners knocked down with throws, need), 'far'
// (a hit from at least need units away), 'air' (a hit on a miner in the air), 'stubbies' (all stubbies
// tipped over). R: play again.
//
//   const list = new Challenges(level);
//   list.update();   // every frame, after level.update()
import { tiltAngle } from '../world/physics.js';

const HINTS = {
  empty: 'Peck a lemon (or a stubby) to pick it up. [E]',
  carry: 'Hold peck to aim, let go to fling. Hold longer to throw farther. [hold E]',
  aim: 'Turn to aim. The arc goes red when it will hit a miner.',
};

export class Challenges {
  constructor(level) {
    this.level = level;
    this.list = level.def.mission.challenges.map(c => ({ ...c, n: 0, done: false }));
    this.keys = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const el = document.getElementById('hud');
    el.hidden = false;
    el.querySelector('.goal').textContent = level.def.mission.goal;
    this.count = el.querySelector('.count');
    this.hint = el.querySelector('.hint');
    addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat) location.reload(); });
    this.stubbies = level.props.filter(p => p.bottles);
    this.draw();
  }

  update() {
    const { level } = this, c = level.player.character;
    for (const e of level.fling?.events ?? []) {
      for (const ch of this.list) {
        if (ch.done) continue;
        if (ch.kind === 'hits') ch.n++;
        if (ch.kind === 'far' && e.from >= ch.need) ch.n = 1;
        if (ch.kind === 'air' && e.air) ch.n = 1;
      }
    }
    const tipped = this.stubbies.flatMap(s => s.bottles).filter(b => tiltAngle(level.physics.body(b.id).quaternion) > 1).length;
    for (const ch of this.list) if (ch.kind === 'stubbies') ch.n = tipped;
    let changed = false;
    for (const ch of this.list) {
      const done = ch.n >= (ch.kind === 'hits' || ch.kind === 'stubbies' ? ch.need : 1);
      if (done !== ch.done) { ch.done = done; changed = true; if (done) level.player.act('happy'); }
    }
    if (changed || this.last !== this.list.map(x => x.n).join()) this.draw();
    this.say(c.aiming !== null ? 'aim' : c.controller.carry !== null ? 'carry' : 'empty');
  }

  draw() {
    this.last = this.list.map(x => x.n).join();
    this.count.textContent = this.list.map(ch => {
      const tally = ch.kind === 'hits' || ch.kind === 'stubbies' ? ` ${Math.min(ch.n, ch.need)}/${ch.need}` : '';
      return `${ch.done ? '✔' : '○'} ${ch.text}${tally}`;
    }).join('\n');
  }

  say(key) {
    if (this.said === key) return;
    this.said = key;
    this.hint.textContent = HINTS[key].replace(/ ?\[(.*)\]/, this.keys ? ' ($1)' : '');
  }
}
