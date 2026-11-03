// The mission view of a level with a mission (level JSON "mission"): the goal, the loot count and one
// hint at the top, markers over the loot and the nest, and the win banner. The goal: mission.need loot
// props (fairy bread) at rest in the nest.
//
//   const hud = level.def.mission ? new Hud(level, asset) : null;
//   hud?.update(dt);   // every frame, after level.update()
//   R: play again (reloads the page).
import { marker } from '../world/backyard.js';

// Hints, by the state of the player. Keys in brackets show only with a keyboard.
const HINTS = {
  start: 'Peck a box or a bin to hide in it. [E]',
  inside: 'Miners only notice rubbish that moves while they look at it. Move when the fan is away. Freeze when it\'s on you. Peck to hop out.',
  seen: 'Spotted! Hide in a box and keep still.',
  carry: 'Got one! Hide in a box with it, and take it to your nest.',
  carryInside: 'Sneak it home. Peck to hop out at the nest, then peck again to drop it.',
};
const MARK = { over: 1.0, bob: 0.15, rate: 2.2, spin: 1.5 };   // marker height over the point, bob, Hz, spin

export class Hud {
  constructor(level, asset) {
    this.level = level;
    this.mission = level.def.mission;
    this.loot = level.props.filter(p => p.loot);
    this.nest = level.props.find(p => p.nest);
    this.need = Math.min(this.mission.need ?? this.loot.length, this.loot.length);
    this.time = 0;
    this.won = false;
    this.keys = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const el = this.el = document.getElementById('hud');
    el.hidden = false;
    el.querySelector('.goal').textContent = this.mission.goal;
    this.count = el.querySelector('.count');
    this.hint = el.querySelector('.hint');
    this.win = document.getElementById('win');
    this.win.querySelector('h2').textContent = this.mission.win ?? 'Done!';
    addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat) location.reload(); });
    this.win.querySelector('button').addEventListener('click', () => location.reload());
    this.markers = this.loot.map(() => marker(asset));
    this.nestMarker = marker(asset);
    level.scene.add(...this.markers, this.nestMarker);
  }

  update(dt) {
    const { level, nest } = this, player = level.player, c = player.character;
    this.time += dt;
    const held = level.physics.birds.find(b => b.ibis === player)?.held ?? null;
    const home = this.loot.filter(l => l.id !== held && nest.holds(l.position()));
    // Markers: over each loot not home and not held, and over the nest while the bird carries one.
    const bob = MARK.bob * Math.sin(this.time * MARK.rate * Math.PI * 2);
    this.loot.forEach((l, i) => {
      const m = this.markers[i], on = !this.won && l.id !== held && !home.includes(l);
      m.visible = on;
      if (on) { m.position.copy(l.position()).setY(l.position().y + MARK.over + bob); m.rotation.y = this.time * MARK.spin; }
    });
    this.nestMarker.visible = !this.won && held !== null && this.loot.some(l => l.id === held);
    this.nestMarker.position.copy(nest.at).setY(nest.at.y + MARK.over + 0.6 + bob);
    this.nestMarker.rotation.y = this.time * MARK.spin;
    if (this.won) return;
    this.count.textContent = `Fairy bread: ${home.length} / ${this.need}`;
    const carry = held !== null && this.loot.some(l => l.id === held);
    const seen = level.sentry?.guards.some(G => G.state === 'attack');
    this.say(seen && !c.inside ? 'seen' : carry ? (c.inside ? 'carryInside' : 'carry') : c.inside ? 'inside' : 'start');
    if (home.length >= this.need) {
      this.won = true;
      player.act('happy');
      const s = Math.round(this.time);
      this.win.querySelector('.time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.win.hidden = false;
      this.el.hidden = true;
    }
  }

  say(key) {
    if (this.said === key) return;
    this.said = key;
    this.hint.textContent = HINTS[key].replace(/ ?\[(.*)\]/, this.keys ? ' ($1)' : '');
  }
}
