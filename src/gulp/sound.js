// Toss and gulp: the game's own sounds, made with the voices of IbisSound (src/ibis/sound.js). The bird's
// sounds (steps, clacks, honks, the toss whoosh) come from its character events through IbisSound.update().
export class GulpSound {
  constructor(sound) { this.s = sound; }

  get on() { return this.s && this.s.ctx.state === 'running' && this.s.camera; }

  voice(at, gain) { return this.on ? this.s.voice(at, gain) : null; }

  start() {
    const v = this.voice(this.s.camera.position.clone().setY(1), 0.4);
    if (!v) return;
    [520, 660, 780].forEach((f, i) => this.s.tone(v, { at: i * 0.07, length: 0.12, gain: 0.3, f0: f, f1: f, type: 'triangle' }));
  }

  // A catch: a soft pop, and a bright chime for a perfect one, higher with the multiplier.
  caught(at, perfect, mult) {
    const v = this.voice(at, 0.6);
    if (!v) return;
    this.s.tone(v, { length: 0.07, gain: 0.5, f0: 380, f1: 620 });
    if (!perfect) return;
    const f = 880 * 2 ** (Math.min(mult - 1, 7) / 12);
    this.s.tone(v, { at: 0.02, length: 0.18, gain: 0.22, f0: f, f1: f, type: 'triangle' });
    this.s.tone(v, { at: 0.06, length: 0.22, gain: 0.14, f0: f * 1.5, f1: f * 1.5, type: 'triangle' });
  }

  // One gulp: a low, wet glug, lower each beat.
  gulp(at, beat) {
    const v = this.voice(at, 0.8);
    if (!v) return;
    const f = 210 - 35 * beat;
    this.s.tone(v, { length: 0.14, gain: 0.8, f0: f, f1: f * 0.5 });
    this.s.burst(v, { length: 0.08, gain: 0.25, filter: ['lowpass', 700, 250, 1.5] });
  }

  // Swallowed: a rising ding, higher with the multiplier.
  swallowed(at, mult) {
    const v = this.voice(at, 0.5);
    if (!v) return;
    const f = 660 * 2 ** (Math.min(mult - 1, 7) / 12);
    this.s.tone(v, { length: 0.12, gain: 0.3, f0: f, f1: f, type: 'triangle' });
    this.s.tone(v, { at: 0.08, length: 0.25, gain: 0.3, f0: f * 1.335, f1: f * 1.335, type: 'triangle' });
  }

  // On the head: a hollow wooden bonk.
  bonk(at, amount = 1) {
    const v = this.voice(at, 0.9 * amount);
    if (!v) return;
    this.s.tone(v, { length: 0.16, gain: 0.8, f0: 420, f1: 230, type: 'triangle' });
    this.s.burst(v, { length: 0.05, gain: 0.5, filter: ['bandpass', 1300, 900, 3] });
  }

  splat(at) {
    const v = this.voice(at, 0.6);
    if (!v) return;
    this.s.burst(v, { length: 0.18, gain: 0.8, filter: ['lowpass', 1200, 200, 0.9] });
    this.s.tone(v, { length: 0.1, gain: 0.4, f0: 160, f1: 70 });
  }

  // Out of lives: three falling notes, like a let-down trombone.
  over(at) {
    const v = this.voice(at, 0.5);
    if (!v) return;
    [392, 370, 349, 262].forEach((f, i) => this.s.tone(v, { at: i * 0.28, length: i === 3 ? 0.7 : 0.26, gain: 0.25, f0: f, f1: i === 3 ? f * 0.94 : f, type: 'sawtooth' }));
  }
}
