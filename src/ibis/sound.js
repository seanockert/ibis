// Sounds for ibises and props, with Web Audio. They read each ibis's character events, as effects.js
// does, so the game only calls update().
//
//   const sound = new IbisSound();
//   sound.load('/sfx/honk.m4a');
//   sound.update(ibises, camera);   // every frame, after ibis.update(dt)
//   sound.slam(event, camera);      // a 'slam' event from a prop (props.js)
//   sound.squash(event, camera);    // a 'squash' event: a cereal box crushed flat
//   sound.splash(event, camera);    // a 'splash' event: a foot or a jump in the puddle (puddle.js)
//   sound.muted = true;
//
// The honk is a recording (public/sfx/honk.m4a: 0.375 s, AAC 32 kbps, about 6 KB), played at a
// different pitch each time. All other sounds are filtered noise and tones made here, with no files:
// steps (with a squelch when wet or muddy), scuffs, wing beats, landings, thumps, the threat hiss, bill
// clacks, puddle splashes and the bin and box slams. Each sound pans and fades with its place in the camera's view.
// Browsers start audio only after a user input, so a key or tap starts it. Until then, and while
// muted, the context is suspended: no sound plays or queues, and the audio thread does no work.
import { Vector3 } from 'three';
import { clamp, hash } from './motion/spring.js';

// Tuning. A level multiplies the volume of one sound: 1 is as made here, 0.5 is half, 0 is off.
export const SOUND = {
  volume: 0.8,          // all sounds
  near: 8,              // full volume nearer than this to the camera, then it falls as 1 / distance
  pan: 0.7,             // left and right spread
  maxVoices: 32,        // more sounds than this at one time are skipped
  limiter: { threshold: -6, ratio: 12 },   // dB, and the ratio above it: many sounds at one time don't clip
  levels: {
    step: 0.5,          // footsteps
    stamp: 0.5,         // the foot stamp in the angry head shake
    scuff: 0.8,         // a foot scrape, part of a step
    squelch: 0.9,       // wet or muddy feet, part of a step (at full wet or mud)
    flap: 1,            // wing beats
    land: 1,            // landings
    thump: 1,           // thumps in actions (a sit, a fall)
    call: 0.9,          // the honk
    hiss: 0.35,         // the threat hiss
    clack: 1,           // the bill snaps shut
    slam: { bin: 1, box: 1, cereal: 1, glass: 0.45 },   // props that fall or hit. glass: the stubbies
    squash: 0.8,        // a cereal box crushed flat
    splash: 0.9,        // a foot or a jump in the puddle
  },
  runSpeed: 1.4,        // steps are louder above this speed
  honkPitch: 0.06,      // the honk's pitch changes by up to this part each time
};
const L = SOUND.levels;

export class IbisSound {
  constructor() {
    this.ctx = new AudioContext();
    // A limiter, so many sounds at one time do not clip.
    this.master = this.ctx.createDynamicsCompressor();
    this.master.threshold.value = SOUND.limiter.threshold;
    this.master.ratio.value = SOUND.limiter.ratio;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(2);
    this.honk = null;
    this.voices = 0;
    this.n = 0;
    this.off = false;
    this.camera = null;
    this.at = new Vector3();
    this.p = new Vector3();
    // A touch counts as a user input only at its end (pointerup, touchend), not at pointerdown: iOS
    // ignores a resume() from a touch pointerdown. The listeners stay, because iOS can stop the context
    // again (a call, the app in the background), and only a new input starts it.
    const start = () => { if (!this.off && this.ctx.state !== 'running') this.ctx.resume(); };
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) addEventListener(type, start, { passive: true });
  }

  async load(url) {
    const data = await (await fetch(url)).arrayBuffer();
    this.honk = await this.ctx.decodeAudioData(data);
  }

  get muted() { return this.off; }
  set muted(m) {
    this.off = m;
    if (m) this.ctx.suspend();
    else this.ctx.resume();
  }

  update(ibises, camera) {
    if (this.ctx.state !== 'running') return;
    this.camera = camera;
    for (const ibis of ibises) {
      const c = ibis.character, ctrl = c.controller;
      if (!c.events.length) continue;
      const place = this.at.copy(ibis.object.position).setY(0.8);
      for (const e of c.events) {
        if (e.type === 'step') this.step(place, Math.abs(ctrl.speed), e.scuff, ibis, L.step);
        if (e.type === 'stamp') this.step(place, 3, false, ibis, L.stamp);
        if (e.type === 'land') this.thud(place, clamp(e.impact / 6, 0.3, 1), L.land);
        if (e.type === 'thump') this.thud(place, clamp((e.amount ?? 12) / 14, 0.3, 1), L.thump);
        if (e.type === 'flap') this.flap(place, e.amount, e.time);
        if (e.type === 'call') this.call(place, e.pitch ?? 1, e.gain ?? 1);
        if (e.type === 'hiss') this.hiss(place, e.length ?? 1);
        if (e.type === 'clack') this.clack(place, e.amount ?? 1);
      }
    }
  }

  // Slam, louder for a faster hit. Bin: a hollow plastic thump. Box: a dull, papery thud. Cereal: a
  // light card tap with a rattle of flakes.
  slam(e, camera) {
    if (this.ctx.state !== 'running' || !e.points.length) return;
    this.camera = camera;
    const strength = Math.max(...e.points.map(p => p.strength));
    const v = this.voice(this.at.copy(e.centre), (0.5 + 0.5 * strength) * (L.slam[e.kind] ?? L.slam.bin));
    if (!v) return;
    if (e.kind === 'glass') {
      // A clink: two bright partials that ring briefly, and a tick.
      const f = 2300 * this.vary(0.12);
      this.tone(v, { length: 0.25, gain: 0.22, f0: f, f1: f * 0.99 });
      this.tone(v, { length: 0.16, gain: 0.14, f0: f * 1.48, f1: f * 1.47 });
      this.burst(v, { length: 0.02, gain: 0.25, filter: ['highpass', 4000, 4000, 0.7] });
      return;
    }
    if (e.kind === 'cereal') {
      this.tone(v, { length: 0.07, gain: 0.3, f0: 260 * this.vary(0.15), f1: 150 });
      this.burst(v, { length: 0.06, gain: 0.5, filter: ['bandpass', 1200, 700, 1.0] });
      this.burst(v, { at: 0.02, length: 0.18, gain: 0.25, filter: ['highpass', 3500, 3000, 0.7] });
      return;
    }
    if (e.kind === 'box') {
      this.tone(v, { length: 0.14, gain: 0.5, f0: 140 * this.vary(0.15), f1: 70 });
      this.burst(v, { length: 0.16, gain: 0.8, filter: ['lowpass', 900, 300, 0.8] });
      this.burst(v, { length: 0.05, gain: 0.25, filter: ['bandpass', 2200, 1500, 1.2] });
      return;
    }
    this.tone(v, { length: 0.35, gain: 0.9, f0: 95 * this.vary(0.1), f1: 45 });
    this.burst(v, { length: 0.25, gain: 0.7, filter: ['bandpass', 380, 180, 2.5] });
    this.burst(v, { length: 0.08, gain: 0.4, filter: ['bandpass', 1400, 900, 1.5] });
  }

  // Cereal box crushed flat: a crumple of card and a crunch of flakes.
  squash(e, camera) {
    if (this.ctx.state !== 'running') return;
    this.camera = camera;
    const v = this.voice(this.at.copy(e.centre), L.squash);
    if (!v) return;
    this.tone(v, { length: 0.1, gain: 0.35, f0: 180 * this.vary(0.15), f1: 90 });
    for (let i = 0; i < 4; i++) this.burst(v, { at: i * 0.035 * this.vary(0.4), length: 0.05, gain: 0.45, filter: ['bandpass', 2600 * this.vary(0.3), 1800, 1.4] });
    this.burst(v, { length: 0.2, gain: 0.3, filter: ['lowpass', 1200, 400, 0.7] });
  }

  // Puddle splash: a low slosh, a plop, and drops that fall back. Louder and longer for a jump.
  splash(e, camera) {
    if (this.ctx.state !== 'running') return;
    this.camera = camera;
    const s = e.strength, v = this.voice(this.at.copy(e.at), L.splash * (0.35 + 0.65 * s));
    if (!v) return;
    const length = e.land ? 0.35 : 0.18;
    this.burst(v, { length, gain: 0.8, attack: 0.008, filter: ['lowpass', 1600 * this.vary(0.2), 300, 0.8] });
    this.burst(v, { length: 0.08, gain: 0.6, filter: ['bandpass', 650 * this.vary(0.2), 280, 3] });
    this.tone(v, { length: 0.07, gain: 0.3, f0: 420 * this.vary(0.15), f1: 170 });
    const drops = Math.round((e.land ? 4 : 1) + 3 * s);
    for (let i = 0; i < drops; i++) {
      this.burst(v, { at: 0.04 + length * this.rand(), length: 0.03, gain: 0.25, filter: ['bandpass', 2400 * this.vary(0.35), 1500, 4] });
    }
  }

  // ---- the sounds ----

  // A soft tap of the toes. A scuff scrapes. Wet or muddy feet squelch.
  step(place, speed, scuff, ibis, level) {
    const run = clamp((speed - SOUND.runSpeed) / 2, 0, 1);
    const v = this.voice(place, level * (0.25 + 0.25 * run));
    if (!v) return;
    this.burst(v, { length: 0.05, gain: 1, attack: 0.002, filter: ['bandpass', 1800 * this.vary(0.2), 1200, 1.2] });
    this.tone(v, { length: 0.04, gain: 0.5, f0: 190 * this.vary(0.15), f1: 90 });
    if (scuff) this.burst(v, { length: 0.16, gain: L.scuff, attack: 0.01, filter: ['lowpass', 3500, 700, 0.7] });
    const wet = Math.max(ibis.wet, ibis.mud);
    if (wet > 0.1) this.burst(v, { at: 0.01, length: 0.09, gain: L.squelch * wet, attack: 0.01, filter: ['bandpass', 500, 2200 * this.vary(0.2), 5] });
  }

  // A wing beat: a soft whoosh of feathers with a low push of air. A higher, faster beat is louder.
  flap(place, amount, time) {
    const rate = amount / Math.max(time, 0.02);
    if (rate < 2) return;
    const length = clamp(time, 0.06, 0.3);
    const v = this.voice(place, L.flap * clamp(rate / 10, 0.2, 1) * clamp(amount, 0.5, 1.2));
    if (!v) return;
    const f = 700 * this.vary(0.2);
    this.burst(v, { length, gain: 0.8, attack: length * 0.3, filter: ['bandpass', f, 2 * f, 0.9] });
    this.burst(v, { length: length * 0.8, gain: 0.6, attack: length * 0.2, filter: ['lowpass', 500, 250, 0.7] });
  }

  // Landing or a fall: a low thud with a puff of grit.
  thud(place, strength, level) {
    const v = this.voice(place, level * (0.3 + 0.5 * strength));
    if (!v) return;
    this.tone(v, { length: 0.18, gain: 1, f0: 120 * this.vary(0.1), f1: 45 });
    this.burst(v, { length: 0.12, gain: 0.6, filter: ['lowpass', 1200, 400, 0.7] });
    this.burst(v, { at: 0.02, length: 0.06, gain: 0.3, filter: ['bandpass', 2400, 1600, 1.5] });
  }

  // The recorded honk, at a different pitch each time.
  call(place, pitch, gain) {
    if (!this.honk) return;
    const v = this.voice(place, L.call * gain * this.vary(0.1));
    if (!v) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.honk;
    src.playbackRate.value = pitch * this.vary(SOUND.honkPitch);
    src.connect(v.node);
    this.end(v, src);
    src.start(v.t);
  }

  // Threat hiss, like a goose: high noise that shakes at 23 Hz, as the jaw does.
  hiss(place, length) {
    const v = this.voice(place, L.hiss);
    if (!v) return;
    const { ctx } = this;
    const shake = ctx.createGain();
    shake.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 23;
    const depth = ctx.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth).connect(shake.gain);
    shake.connect(v.node);
    this.burst(v, { length, gain: 1, attack: 0.05, hold: true, filter: ['bandpass', 4200, 3600, 0.8] }, shake);
    lfo.start(v.t);
    lfo.stop(v.t + length);
  }

  // The bill snaps shut: a short hard click.
  clack(place, amount) {
    const v = this.voice(place, L.clack * (0.15 + 0.35 * amount));
    if (!v) return;
    this.burst(v, { length: 0.025, gain: 1, attack: 0.001, filter: ['bandpass', 2600 * this.vary(0.15), 2600, 3] });
    this.tone(v, { length: 0.02, gain: 0.4, f0: 900, f1: 600, type: 'triangle' });
  }

  // ---- parts ----

  // A voice: gain and pan for a world place in the camera's view. Returns null when too many play.
  voice(place, gain) {
    if (this.voices >= SOUND.maxVoices) return null;
    const { ctx } = this;
    const p = this.p.copy(place).applyMatrix4(this.camera.matrixWorldInverse);
    const d = Math.max(p.length(), 0.1);
    const node = ctx.createGain();
    node.gain.value = SOUND.volume * gain * Math.min(1, SOUND.near / d);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(SOUND.pan * p.x / d * 1.5, -SOUND.pan, SOUND.pan);
    node.connect(pan).connect(this.master);
    this.voices++;
    return { node, pan, t: ctx.currentTime, sources: 0 };
  }

  // Noise through a filter that sweeps from f0 to f1, with a quick attack and a fall to silence.
  burst(v, { at = 0, length, gain, attack = 0.004, hold = false, filter: [type, f0, f1, q] }, to = v.node) {
    const { ctx } = this, t = v.t + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + length);
    const g = this.envelope(t, length, gain, attack, hold);
    src.connect(f).connect(g).connect(to);
    this.end(v, src);
    src.start(t, this.rand() * Math.max(this.noise.duration - length - 0.05, 0));
    src.stop(t + length + 0.02);
  }

  // A tone that slides from f0 to f1: the body of a thud or a tap.
  tone(v, { at = 0, length, gain, f0, f1, type = 'sine' }) {
    const { ctx } = this, t = v.t + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + length);
    osc.connect(this.envelope(t, length, gain, 0.003)).connect(v.node);
    this.end(v, osc);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  // Attack to gain, then an exponential fall to silence at length. hold: stay up, then a short fall.
  envelope(t, length, gain, attack, hold = false) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (hold) g.gain.setValueAtTime(gain, t + length * 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    return g;
  }

  // Disconnects the voice when its last source ends.
  end(v, src) {
    v.sources++;
    src.onended = () => {
      if (--v.sources > 0) return;
      v.node.disconnect();
      v.pan.disconnect();
      this.voices--;
    };
  }

  makeNoise(seconds) {
    const b = this.ctx.createBuffer(1, seconds * this.ctx.sampleRate, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 2 * hash(i) - 1;
    return b;
  }

  rand() { return hash(++this.n * 7919); }
  vary(k) { return 1 + k * (2 * this.rand() - 1); }
}
