// The view of the combo toy (level JSON "mission" with "combo"; rules in src/world/combo.js): the clock
// and the total at the top, the fuse bar, the combo value and its links over the bird, a pop for each
// bank, a hint at the start, and the end panel. R: play again.
//
//   const hud = new ComboHud(level, camera);
//   hud.update(dt);   // every frame, after level.update()
import { Vector3 } from 'three';
import { COMBO, Combo } from '../world/combo.js';

const OVER = 2.9;        // the combo shows this high over the bird's root
const SHOW_LINKS = 5;    // the last links shown
const HINT_TIME = 10;    // seconds the start hint shows
const BEST_KEY = 'ibis.combo.best';
const fmt = n => n.toLocaleString('en-AU');

export class ComboHud {
  constructor(level, camera) {
    this.level = level;
    this.camera = camera;
    this.combo = new Combo(level, level.def.mission.combo);
    window.demo && (window.demo.combo = this.combo);
    const el = this.el = document.getElementById('combo');
    el.hidden = false;
    this.clock = el.querySelector('.clock .time');
    this.total = el.querySelector('.clock .total');
    this.run = el.querySelector('.run');
    this.fuse = el.querySelector('.fuse i');
    this.value = el.querySelector('.value');
    this.links = el.querySelector('.links');
    this.pops = el.querySelector('.pops');
    this.hint = el.querySelector('.hint');
    this.hint.textContent = level.def.mission.goal;
    this.win = document.getElementById('win');
    addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat) location.reload(); });
    this.win.querySelector('button').addEventListener('click', () => location.reload());
    this.at = new Vector3();
  }

  update(dt) {
    const { combo } = this;
    combo.update(dt);
    for (const e of combo.events) {
      if (e.type === 'link') this.drawLinks();
      if (e.type === 'bank') this.pop(e);
      if (e.type === 'over') this.end();
    }
    const s = Math.ceil(combo.left);
    this.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.clock.classList.toggle('low', s <= 10);
    this.total.textContent = fmt(combo.total);
    if (combo.time > HINT_TIME) this.hint.hidden = true;
    // Over the bird: the fuse and the combo.
    const c = combo.combo;
    this.run.hidden = !c;
    if (!c) return;
    const p = this.level.player.object.position;
    this.at.set(p.x, p.y + OVER, p.z).project(this.camera);
    this.run.style.transform = `translate(${(this.at.x * 0.5 + 0.5) * innerWidth}px, ${(-this.at.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    const k = Math.max(c.fuse, 0) / COMBO.fuse;
    this.fuse.style.transform = `scaleX(${k})`;
    this.fuse.classList.toggle('short', k < 0.35);
    this.value.textContent = `${fmt(Math.round(c.sum))} × ${c.links.length}`;
  }

  drawLinks() {
    const c = this.combo.combo;
    if (!c) return;
    const shown = c.links.slice(-SHOW_LINKS);
    this.links.replaceChildren(...(c.links.length > SHOW_LINKS ? ['… + '] : []), ...shown.flatMap((l, i) => {
      const span = document.createElement('span');
      span.textContent = `${l.name} ${l.points}`;
      if (l.faded) span.className = 'faded';
      if (i === shown.length - 1) span.classList.add('new');
      return i ? [' + ', span] : [span];
    }));
  }

  // A banked combo: a pop under the total.
  pop({ value, links }) {
    if (!value) return;
    const div = document.createElement('div');
    div.className = links >= 6 ? 'pop big' : 'pop';
    div.textContent = `+${fmt(value)}${links > 1 ? `  (${links} links)` : ''}`;
    this.pops.prepend(div);
    setTimeout(() => div.remove(), 2200);
  }

  end() {
    const { combo } = this, best = Math.max(+localStorage.getItem(BEST_KEY) || 0, combo.total);
    const record = combo.total > 0 && combo.total >= best;
    localStorage.setItem(BEST_KEY, best);
    this.win.querySelector('h2').textContent = record ? 'New best!' : 'Time!';
    this.win.querySelector('p').innerHTML = `Score <b>${fmt(combo.total)}</b><br>Best combo ${fmt(combo.best)}<br>Best score ${fmt(best)}`;
    this.win.hidden = false;
    this.run.hidden = true;
  }
}
