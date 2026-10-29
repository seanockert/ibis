// Background sounds: cicadas and a far lawnmower by day, crickets and frogs at night. See docs/effects-sound.md.
//
//   const ambience = new Ambience(sound, { cicadas: [[x, z], ...], mower: [x, z], frogs: [x, z] });
//   ambience.update(camera);   // every frame
import { Vector3 } from 'three';
import { clamp, smoothstep } from '../ibis/motion/spring.js';
import { SOUND } from '../ibis/sound.js';
import { LIGHT } from './lighting.js';

// Tuning, seconds and Hz. Each field is described in docs/effects-sound.md.
export const AMBIENCE = {
  cicada: { hz: 4300, q: 5, pulse: 110, rise: [2, 5], hold: [5, 14], fall: [2, 4], gap: [4, 18], heat: 0.6, high: 6 },
  mower: { hz: 52, tone: 450, gap: [40, 100], time: [15, 30], fade: 4, sweep: [5, 9], wander: 0.04 },
  cricket: { count: 3, far: [5, 9], hz: [4200, 4800], pulses: [3, 4], every: [0.45, 0.8], bout: [8, 30], rest: [3, 12] },
  frog: { count: 2, hz: [520, 700], calls: [3, 7], every: [0.18, 0.3], gap: [3, 10] },
};
const L = SOUND.levels;
const AHEAD = 0.1;   // seconds: each sound is set up this far before it starts

export class Ambience {
  // sound: an IbisSound. cicadas: [x, z] of each tree. mower: [x, z] of the lawn. frogs: [x, z] of the puddle.
  constructor(sound, { cicadas = [], mower = null, frogs = null } = {}) {
    this.sound = sound;
    const r = () => sound.rand(), range = v => this.range(v);
    const C = AMBIENCE.cricket;
    this.cicadas = cicadas.map(([x, z]) => ({ at: new Vector3(x, AMBIENCE.cicada.high, z), next: range(AMBIENCE.cicada.gap) }));
    this.mower = mower && { at: new Vector3(mower[0], 0.5, mower[1]), next: range(AMBIENCE.mower.gap) / 2 };
    this.crickets = Array.from({ length: C.count }, (_, i) => {
      const angle = (i + 0.5 * r()) / C.count * 2 * Math.PI, d = range(C.far);
      return { off: new Vector3(Math.cos(angle) * d, 0.2, Math.sin(angle) * d), hz: range(C.hz), every: range(C.every), next: 0, end: 0 };
    });
    this.frogs = frogs ? Array.from({ length: AMBIENCE.frog.count }, (_, i) => (
      { at: new Vector3(frogs[0] + (i - 0.5) * 1.5, 0.1, frogs[1] + 0.6 * (r() - 0.5)), hz: range(AMBIENCE.frog.hz), next: range(AMBIENCE.frog.gap) }
    )) : [];
    this.place = new Vector3();
  }

  // A random value from a to b.
  range([a, b]) { return a + (b - a) * this.sound.rand(); }

  update(camera) {
    const { sound } = this;
    if (sound.ctx.state !== 'running') return;
    sound.camera = camera;
    const t = sound.ctx.currentTime, night = LIGHT.night.value, range = v => this.range(v);
    const day = (1 - night) * (1 - AMBIENCE.cicada.heat * Math.max(LIGHT.dusk.value, LIGHT.morning.value));
    const crickets = smoothstep(0.3, 0.8, night), frogs = smoothstep(0.4, 0.9, night);
    // A sound that was due while the audio was stopped starts from now.
    const due = s => {
      if (s.next < t - 1) s.next = t + AHEAD;
      return s.next < t + AHEAD;
    };
    for (const c of this.cicadas) {
      if (!due(c)) continue;
      const C = AMBIENCE.cicada, rise = range(C.rise), hold = range(C.hold), fall = range(C.fall);
      if (day > 0.05) this.cicada(c.at, Math.max(c.next, t), rise, hold, fall, day);
      c.next = Math.max(c.next, t) + rise + hold + fall + range(C.gap);
    }
    if (this.mower && due(this.mower)) {
      const M = AMBIENCE.mower, length = range(M.time);
      if (1 - night > 0.9) this.lawnmower(this.mower.at, Math.max(this.mower.next, t), length);
      this.mower.next = Math.max(this.mower.next, t) + length + range(M.gap);
    }
    for (const c of this.crickets) {
      if (!due(c)) continue;
      const C = AMBIENCE.cricket;
      // A new bout, or a rest.
      if (c.next >= c.end) {
        const start = Math.max(c.next, t) + range(C.rest);
        Object.assign(c, { next: start, end: start + range(C.bout) });
        continue;
      }
      if (crickets > 0.05) this.chirp(this.place.copy(camera.position).add(c.off), Math.max(c.next, t), c.hz, crickets);
      c.next = Math.max(c.next, t) + c.every * sound.vary(0.05);
    }
    for (const f of this.frogs) {
      if (!due(f)) continue;
      const F = AMBIENCE.frog, calls = Math.round(range(F.calls)), every = range(F.every);
      if (frogs > 0.05) this.croak(f.at, Math.max(f.next, t), f.hz, calls, every, frogs);
      f.next = Math.max(f.next, t) + calls * every + range(F.gap);
    }
  }

  // ---- the sounds ----

  // A cicada phrase: a band of noise, pulsed fast, that swells up, holds and fades.
  cicada(place, start, rise, hold, fall, weight) {
    const { sound } = this, { ctx } = sound, C = AMBIENCE.cicada;
    const v = this.voice(place, L.cicada * weight * sound.vary(0.2), start);
    if (!v) return;
    const end = start + rise + hold + fall;
    const src = ctx.createBufferSource();
    src.buffer = sound.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = C.hz * sound.vary(0.08);
    band.Q.value = C.q;
    // The pulse: the gain swings from 0 to 1 at the pulse rate.
    const { gain: pulse, lfo } = sound.wobble(C.pulse * sound.vary(0.1), 1);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(1, start + rise);
    env.gain.setValueAtTime(1, start + rise + hold);
    env.gain.linearRampToValueAtTime(0, end);
    src.connect(band).connect(pulse).connect(env).connect(v.node);
    for (const s of [src, lfo]) {
      sound.end(v, s);
      s.start(start);
      s.stop(end + 0.05);
    }
  }

  // A lawnmower far off: an engine tone and a noise rumble, through a low-pass.
  lawnmower(place, start, length) {
    const { sound } = this, { ctx } = sound, M = AMBIENCE.mower;
    const v = this.voice(place, L.mower, start);
    if (!v) return;
    const end = start + length, hz = M.hz * sound.vary(0.05);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = M.tone;
    const { gain: swing, lfo: sweep } = sound.wobble(1 / this.range(M.sweep), 0.7);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(1, start + M.fade);
    env.gain.setValueAtTime(1, end - M.fade);
    env.gain.linearRampToValueAtTime(0, end);
    low.connect(swing).connect(env).connect(v.node);
    const load = ctx.createOscillator(), wander = ctx.createGain();
    load.frequency.value = 0.13 * sound.vary(0.3);
    wander.gain.value = hz * M.wander;
    load.connect(wander);
    const sources = [sweep, load];
    for (const [type, f, gain] of [['sawtooth', hz, 1], ['square', hz * 2.006, 0.35]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      wander.connect(osc.frequency);
      g.gain.value = gain;
      osc.connect(g).connect(low);
      sources.push(osc);
    }
    const rumble = ctx.createBufferSource(), rf = ctx.createBiquadFilter(), rg = ctx.createGain();
    rumble.buffer = sound.noise;
    rumble.loop = true;
    rf.type = 'lowpass';
    rf.frequency.value = 250;
    rg.gain.value = 0.5;
    rumble.connect(rf).connect(rg).connect(low);
    sources.push(rumble);
    for (const s of sources) {
      sound.end(v, s);
      s.start(start);
      s.stop(end + 0.05);
    }
  }

  // A cricket chirp: a few short pulses of one high tone.
  chirp(place, start, hz, weight) {
    const { sound } = this, { ctx } = sound, C = AMBIENCE.cricket;
    const v = this.voice(place, L.cricket * weight, start);
    if (!v) return;
    const osc = ctx.createOscillator(), g = ctx.createGain(), pulses = Math.round(this.range(C.pulses));
    osc.frequency.value = hz;
    g.gain.setValueAtTime(0, start);
    for (let k = 0; k < pulses; k++) {
      const at = start + k * 0.035;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + 0.004);
      g.gain.linearRampToValueAtTime(0, at + 0.02);
    }
    osc.connect(g).connect(v.node);
    sound.end(v, osc);
    osc.start(start);
    osc.stop(start + pulses * 0.035 + 0.02);
  }

  // A frog call: a run of short, hollow toks.
  croak(place, start, hz, calls, every, weight) {
    const { sound } = this;
    const v = this.voice(place, L.frog * weight, start);
    if (!v) return;
    for (let k = 0; k < calls; k++) {
      const at = k * every * sound.vary(0.1), f = hz * sound.vary(0.04);
      sound.tone(v, { at, length: 0.06, gain: 0.8, f0: f, f1: f * 0.75 });
      sound.burst(v, { at, length: 0.03, gain: 0.25, attack: 0.002, filter: ['bandpass', f * 2.2, f * 1.6, 3] });
    }
  }

  // A voice of the IbisSound at a place, that starts at start (ctx time).
  voice(place, gain, start) {
    const v = this.sound.voice(place, clamp(gain, 0, 1));
    if (v) v.t = start;
    return v;
  }
}
