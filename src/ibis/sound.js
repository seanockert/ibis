// Sounds for ibises and props, with Web Audio. They read each ibis's character events, as effects.js
// does, so the game only calls update().
//
//   const sound = new IbisSound();
//   sound.load('/sfx/honk.m4a');
//   sound.update(ibises, camera);   // every frame, after ibis.update(dt)
//   sound.slam(event, camera);      // a 'slam' event from a prop (props.js)
//   sound.muted = true;
//
// The honk is a recording (public/sfx/honk.m4a: 0.375 s, AAC 32 kbps, about 6 KB), played at a
// different pitch each time. All other sounds are filtered noise and tones made here, with no files:
// steps (with a squelch when wet or muddy), scuffs, wing beats, landings, thumps, the threat hiss, bill
// clacks and the bin slam. Each sound pans and fades with its place in the camera's view.
// Browsers start audio only after a user input, so a key or tap starts it. Until then, and while
// muted, the context is suspended: no sound plays or queues, and the audio thread does no work.
import { Vector3 } from 'three';
import { clamp, hash } from './motion/spring.js';

const VOLUME = 0.8;
const NEAR = 8;          // full volume nearer than this to the camera, then it falls as 1 / distance
const PAN = 0.7;         // left and right spread
const MAX_VOICES = 32;   // more sounds than this at one time are skipped
const RUN_SPEED = 1.4;   // steps are louder above this speed

export class IbisSound {
  constructor() {
    this.ctx = new AudioContext();
    // A limiter, so many sounds at one time do not clip.
    this.master = this.ctx.createDynamicsCompressor();
    this.master.threshold.value = -6;
    this.master.ratio.value = 12;
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
        if (e.type === 'step') this.step(place, Math.abs(ctrl.speed), e.scuff, ibis);
        if (e.type === 'stamp') this.step(place, 3, false, ibis);
        if (e.type === 'land') this.thud(place, clamp(e.impact / 6, 0.3, 1));
        if (e.type === 'thump') this.thud(place, clamp((e.amount ?? 12) / 14, 0.3, 1));
        if (e.type === 'flap') this.flap(place, e.amount, e.time);
        if (e.type === 'call') this.call(place, e.pitch ?? 1, e.gain ?? 1);
        if (e.type === 'hiss') this.hiss(place, e.length ?? 1);
        if (e.type === 'clack') this.clack(place, e.amount ?? 1);
      }
    }
  }

  // Bin slam: a hollow plastic thump, louder for a faster hit.
  slam(e, camera) {
    if (this.ctx.state !== 'running' || !e.points.length) return;
    this.camera = camera;
    const strength = Math.max(...e.points.map(p => p.strength));
    const v = this.voice(this.at.copy(e.centre), 0.5 + 0.5 * strength);
    if (!v) return;
    this.tone(v, { length: 0.35, gain: 0.9, f0: 95 * this.vary(0.1), f1: 45 });
    this.burst(v, { length: 0.25, gain: 0.7, filter: ['bandpass', 380, 180, 2.5] });
    this.burst(v, { length: 0.08, gain: 0.4, filter: ['bandpass', 1400, 900, 1.5] });
  }

  // ---- the sounds ----

  // A soft tap of the toes. A scuff scrapes. Wet or muddy feet squelch.
  step(place, speed, scuff, ibis) {
    const run = clamp((speed - RUN_SPEED) / 2, 0, 1);
    const v = this.voice(place, 0.25 + 0.25 * run);
    if (!v) return;
    this.burst(v, { length: 0.05, gain: 1, attack: 0.002, filter: ['bandpass', 1800 * this.vary(0.2), 1200, 1.2] });
    this.tone(v, { length: 0.04, gain: 0.5, f0: 190 * this.vary(0.15), f1: 90 });
    if (scuff) this.burst(v, { length: 0.16, gain: 0.8, attack: 0.01, filter: ['lowpass', 3500, 700, 0.7] });
    const wet = Math.max(ibis.wet, ibis.mud);
    if (wet > 0.1) this.burst(v, { at: 0.01, length: 0.09, gain: 0.9 * wet, attack: 0.01, filter: ['bandpass', 500, 2200 * this.vary(0.2), 5] });
  }

  // A wing beat: a soft whoosh of feathers with a low push of air. A higher, faster beat is louder.
  flap(place, amount, time) {
    const rate = amount / Math.max(time, 0.02);
    if (rate < 2) return;
    const length = clamp(time, 0.06, 0.3);
    const v = this.voice(place, clamp(rate / 10, 0.2, 1) * clamp(amount, 0.5, 1.2));
    if (!v) return;
    const f = 700 * this.vary(0.2);
    this.burst(v, { length, gain: 0.8, attack: length * 0.3, filter: ['bandpass', f, 2 * f, 0.9] });
    this.burst(v, { length: length * 0.8, gain: 0.6, attack: length * 0.2, filter: ['lowpass', 500, 250, 0.7] });
  }

  // Landing or a fall: a low thud with a puff of grit.
  thud(place, strength) {
    const v = this.voice(place, 0.3 + 0.5 * strength);
    if (!v) return;
    this.tone(v, { length: 0.18, gain: 1, f0: 120 * this.vary(0.1), f1: 45 });
    this.burst(v, { length: 0.12, gain: 0.6, filter: ['lowpass', 1200, 400, 0.7] });
    this.burst(v, { at: 0.02, length: 0.06, gain: 0.3, filter: ['bandpass', 2400, 1600, 1.5] });
  }

  // The recorded honk, at a different pitch each time.
  call(place, pitch, gain) {
    if (!this.honk) return;
    const v = this.voice(place, 0.9 * gain * this.vary(0.1));
    if (!v) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.honk;
    src.playbackRate.value = pitch * this.vary(0.06);
    src.connect(v.node);
    this.end(v, src);
    src.start(v.t);
  }

  // Threat hiss, like a goose: high noise that shakes at 23 Hz, as the jaw does.
  hiss(place, length) {
    const v = this.voice(place, 0.35);
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
    const v = this.voice(place, 0.15 + 0.35 * amount);
    if (!v) return;
    this.burst(v, { length: 0.025, gain: 1, attack: 0.001, filter: ['bandpass', 2600 * this.vary(0.15), 2600, 3] });
    this.tone(v, { length: 0.02, gain: 0.4, f0: 900, f1: 600, type: 'triangle' });
  }

  // ---- parts ----

  // A voice: gain and pan for a world place in the camera's view. Returns null when too many play.
  voice(place, gain) {
    if (this.voices >= MAX_VOICES) return null;
    const { ctx } = this;
    const p = this.p.copy(place).applyMatrix4(this.camera.matrixWorldInverse);
    const d = Math.max(p.length(), 0.1);
    const node = ctx.createGain();
    node.gain.value = VOLUME * gain * Math.min(1, NEAR / d);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(PAN * p.x / d * 1.5, -PAN, PAN);
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
