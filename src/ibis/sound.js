// Sounds for ibises and props, with Web Audio. They read each ibis's character events, as effects.js
// does, so the game only calls update().
//
//   const sound = new IbisSound();
//   sound.load('honk', '/sfx/honk.m4a');   // also 'chip' and 'scold', the noisy miner's calls
//   sound.under = (x, z) => 'grass';       // what a foot is on (set by the level): a step on grass is softer
//   sound.update(ibises, camera);   // every frame, after ibis.update(dt)
//   sound.slam(event, camera);      // a 'slam' event from a prop (props.js)
//   sound.squash(event, camera);    // a 'squash' event: a cereal box crushed flat
//   sound.splash(event, camera);    // a 'splash' event: a foot or a jump in mud (level.js)
//   sound.minerCall(event, camera); // a 'call' event of a flying noisy miner (src/miner/flight.js)
//   sound.rustle(tufts.rustle, camera);       // every frame: the grass that moves (tufts.js)
//   sound.buzz(flies.buzz, camera);           // every frame: the flies round a bin (flies.js)
//   sound.spray(sprinkler.spray, camera);     // every frame: the sprinkler (sprinkler.js)
//   sound.muted = true;
//
// The honk is a recording (public/sfx/honk.m4a: 0.375 s, AAC 32 kbps, about 6 KB), played at a
// different pitch each time. The noisy miner's calls are recordings too: public/sfx/miner-chip.m4a
// (0.6 s, a burst of four alarm chips, for the alert) and public/sfx/miner-scold.m4a (0.8 s, three harsh
// scold notes, for the attack). All other sounds are filtered noise and tones made here, with no files:
// steps (softer on grass, with a squelch when wet or muddy), scuffs, the grass rustle, wing beats, landings, thumps, the threat hiss, bill
// clacks, the bill's snap on a prop it picks up, mud splashes, the bin and box slams, the flies' buzz, the sprinkler's hiss and the tap's squeak. Each sound pans and fades with its place in the camera's view.
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
    chip: 0.4,          // the noisy miner's alert call
    scold: 0.5,         // the noisy miner's attack call
    yelp: 0.9,          // a hurt noisy miner: the chip, high and fast
    hiss: 0.35,         // the threat hiss
    clack: 1,           // the bill snaps shut
    pick: 0.8,          // the bill takes hold of a prop (a peck picks it up)
    turn: 0.6,          // the bill turns a tap handle
    creak: 0.45,        // the gate hinge
    slam: { bin: 1, box: 1, cereal: 1, glass: 0.45 },   // props that fall or hit. glass: the stubbies
    squash: 0.8,        // a cereal box crushed flat
    splash: 0.6,        // a foot or a jump in mud
    rustle: 0.25,       // grass that moves round a bird: a quiet support, under the other sounds
    grassStep: 0.5,     // a step on grass, part of a step
    buzz: 0.04,         // flies round a bin: faint, it plays all the time near a bin
    // Background (ambience.js): keep it under the buzz. Measured levels in docs/effects-sound.md.
    cicada: 0.3,        // a phrase of cicadas in a gum tree
    mower: 0.05,        // a lawnmower far off
    cricket: 0.025,     // a cricket chirp, round the listener
    frog: 0.06,         // a frog call at the mud
    spray: 0.05,        // the sprinkler's hiss
  },
  runSpeed: 1.4,        // steps are louder above this speed
  honkPitch: 0.06,      // the honk's pitch changes by up to this part each time
  minerPitch: 0.1,      // the same for the noisy miner's calls: more change, so the calls repeat less
  minerGap: 0.7,        // seconds: a miner call this soon after the last one (of any miner) is skipped
  minerTone: 3200,      // Hz: a lowpass on the miner's calls takes off the harsh top
  yelpPitch: 1.5,       // the yelp's playback rate
  // Grass moving (tufts.js rustle.amount): silent to from (short tufts stay below it), loudest at full.
  // gap: seconds from one brush of the rustle to the next, at from and at full; span: seconds of a brush.
  // tone: an extra low-pass, Hz, on all of it: a high end grates when it repeats. stop: seconds to fade
  // out when the grass stops.
  rustle: { from: 3, full: 40, gap: [1.2, 0.7], span: 0.5, tone: 1300, stop: 0.03 },
  grassStep: { tone: 1100 },   // the extra low-pass on a step on grass, Hz
  // Sounds that play while heard (loop()): seconds for the gain and pan to follow, and of silence before one stops.
  loop: { follow: 0.4, idle: 2.5 },
  // Flies (flies.js buzz): wing tones, Hz (a few flies, a little out of tune), the vibrato (Hz, part of the
  // pitch), the swell as flies go near and far (Hz, part of the gain: near 1, the buzz almost stops at the
  // low of each swell), a band-pass (Hz, Q) and a low-pass (Hz).
  buzz: { tones: [190, 204, 223], vibrato: [7, 0.04], swell: [0.35, 0.9], band: [420, 0.7], tone: 800 },
  // Sprinkler (sprinkler.js spray): a band-pass (Hz, Q) on noise, a swell (Hz, part of the gain) and a low-pass (Hz).
  spray: { band: [2400, 0.5], swell: [0.3, 0.4], tone: 4000 },
};

// Mud slosh: lumps of low noise, each [start (s), filter from (Hz), filter to (Hz), gain].
const SLOSH = {
  step: [[0, 320, 750, 0.5], [0.07, 650, 280, 0.4], [0.15, 350, 520, 0.22]],
  land: [[0, 400, 900, 0.6], [0.06, 800, 300, 0.5], [0.14, 380, 650, 0.4], [0.23, 550, 260, 0.25]],
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
    this.samples = {};   // recordings by name
    this.rustleAt = -Infinity;   // ctx time of the last grass rustle (SOUND.rustle.gap)
    this.rustling = [];          // voices of the grass rustles that play
    this.loops = new Map();      // sounds that play while they are heard (loop()): the buzz, the spray
    this.under = null;           // (x, z) => what a foot is on there, or null: set by the level
    this.minerAt = -Infinity;   // ctx time of the last miner call (SOUND.minerGap)
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

  async load(name, url) {
    const data = await (await fetch(url)).arrayBuffer();
    this.samples[name] = await this.ctx.decodeAudioData(data);
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
        if (e.type === 'pick') this.pick(place, e.hold);
        if (e.type === 'turn') this.squeak(place);
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

  // Rusty gate hinge: short rough pulses that drift in pitch (stick and slip), and grit.
  creak(e, camera) {
    if (this.ctx.state !== 'running') return;
    this.camera = camera;
    const s = e.strength, v = this.voice(this.at.copy(e.at), (0.4 + 0.6 * s) * L.creak);
    if (!v) return;
    const length = 0.45 - 0.2 * s, base = (620 + 260 * s) * this.vary(0.12), rise = 1 + 0.25 * this.vary(1) * (this.vary(1) > 1 ? 1 : -1);
    for (let t = 0, k = 0; t < length; k++) {
      const u = t / length, f = base * (1 + (rise - 1) * u) * (1 + 0.04 * Math.sin(k * 2.3));
      this.tone(v, { at: t, length: 0.035, gain: 0.22 * Math.sin(Math.PI * Math.min(u * 1.5, 1)) + 0.05, f0: f, f1: f * 0.97, type: 'sawtooth' });
      t += 0.022 * this.vary(0.35);
    }
    this.burst(v, { length, gain: 0.08, hold: true, filter: ['bandpass', 2600, 2200, 3] });
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

  // Mud splash: a slosh of soft lumps of low noise, each with a slow filter sweep (water that moves
  // round the foot), then a low squelch. A jump has more lumps and a few dull drops. No tones and no
  // fast attacks: they made a step sound sharp.
  splash(e, camera) {
    if (this.ctx.state !== 'running') return;
    this.camera = camera;
    const s = e.strength, v = this.voice(this.at.copy(e.at), L.splash * (e.land ? 0.5 + 0.5 * s : 0.25 + 0.3 * s));
    if (!v) return;
    const lumps = e.land ? SLOSH.land : SLOSH.step;
    for (const [at, f0, f1, gain] of lumps) {
      this.burst(v, { at: at * this.vary(0.2), length: 0.16, gain, attack: 0.045, filter: ['lowpass', f0 * this.vary(0.15), f1, 1.4] });
    }
    // Squelch: the foot pulls out of the mud.
    const at = lumps[lumps.length - 1][0] + 0.05;
    this.burst(v, { at, length: 0.14, gain: 0.35, attack: 0.05, filter: ['bandpass', 220 * this.vary(0.15), 450, 2.5] });
    if (!e.land) return;
    for (let i = 0; i < 2 + 2 * s; i++) {
      this.burst(v, { at: 0.1 + 0.3 * this.rand(), length: 0.05, gain: 0.08, attack: 0.015, filter: ['lowpass', 900 * this.vary(0.3), 500, 1] });
    }
  }

  // Grass rustle: brushes of grass past the bird. A brush is a few short lumps of low noise spread over
  // span, so it has a texture but no hiss. While a bird pushes grass, the next brush starts a gap after
  // the last; the gap is shorter and the brush louder for grass that moves faster. When no bird pushes
  // grass (it left the grass, or stands still), the brushes that play fade out at once.
  rustle(r, camera) {
    if (this.ctx.state !== 'running') return;
    const { from, full, gap, span, tone, stop } = SOUND.rustle, k = clamp((r.amount - from) / (full - from), 0, 1);
    const t = this.ctx.currentTime;
    this.rustling = this.rustling.filter(v => v.sources > 0);
    if (k <= 0) {
      for (const v of this.rustling) v.node.gain.setTargetAtTime(0, t, stop);
      this.rustling = [];
      return;
    }
    if (t < this.rustleAt + gap[0] + (gap[1] - gap[0]) * k) return;
    this.rustleAt = t;
    this.camera = camera;
    const v = this.voice(r.at, L.rustle * (0.4 + 0.6 * k) * this.vary(0.15));
    if (!v) return;
    const soft = this.soften(v, tone), count = 4 + Math.floor(this.rand() * 3);
    for (let i = 0; i < count; i++) {
      const length = 0.08 + 0.08 * this.rand();
      this.burst(v, { at: span * (i + 0.6 * this.rand()) / count, length, gain: 0.6 + 0.4 * this.rand(), attack: length * 0.4, filter: ['lowpass', 1100 * this.vary(0.25), 600, 0.7] }, soft);
    }
    this.rustling.push(v);
  }

  // Flies' buzz: a few triangle tones a little out of tune, with a fast vibrato and a slow, deep swell, so
  // it comes and goes, through a band-pass and a low-pass. Saw tones were harsh near a bin. b.amount sets
  // its gain (0 is silent), b.pitch its pitch (higher when the flies scatter), b.at its pan.
  buzz(b, camera) {
    if (this.ctx.state !== 'running') return;
    const B = SOUND.buzz;
    const loop = this.loop('buzz', SOUND.volume * L.buzz * b.amount, b.at, camera, node => {
      const { ctx } = this, band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      [band.frequency.value, band.Q.value] = B.band;
      band.connect(this.soften({ node }, B.tone));
      // The swell: a slow change of gain, as flies pass near and far.
      const { gain: swell, lfo } = this.wobble(...B.swell);
      swell.connect(band);
      const sources = [lfo];
      const tones = B.tones.map((hz, i) => {
        const osc = ctx.createOscillator(), vib = ctx.createOscillator(), amount = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = hz;
        vib.frequency.value = B.vibrato[0] * (1 + 0.13 * i);
        amount.gain.value = hz * B.vibrato[1];
        vib.connect(amount).connect(osc.frequency);
        osc.connect(swell);
        sources.push(osc, vib);
        return osc;
      });
      return { sources, tones };
    });
    loop?.tones.forEach((osc, i) => osc.frequency.setTargetAtTime(B.tones[i] * b.pitch, this.ctx.currentTime, SOUND.loop.follow));
  }

  // Sprinkler spray: a soft hiss of noise that swells a little as the spray sweeps. s.amount: 1 while it
  // sprays, s.at its place. Its gain falls with the distance to the camera, as a voice.
  spray(s, camera, key = 'spray') {
    if (this.ctx.state !== 'running') return;
    const P = SOUND.spray, d = Math.max(this.p.copy(s.at).applyMatrix4(camera.matrixWorldInverse).length(), 0.1);
    this.loop(key, SOUND.volume * L.spray * s.amount * Math.min(1, SOUND.near / d), s.at, camera, node => {
      const { ctx } = this, src = ctx.createBufferSource(), band = ctx.createBiquadFilter();
      src.buffer = this.noise;
      src.loop = true;
      band.type = 'bandpass';
      [band.frequency.value, band.Q.value] = P.band;
      const { gain: swell, lfo } = this.wobble(...P.swell);
      src.connect(band).connect(swell).connect(this.soften({ node }, P.tone));
      return { sources: [src, lfo] };
    });
  }

  // A sound that plays while its gain is above 0: one voice under key, made by build(node) the first time
  // it is heard. build connects its nodes into node and returns { sources, ... }. The gain and the pan
  // follow over SOUND.loop.follow seconds. After SOUND.loop.idle seconds at 0 it stops, so its sources do
  // no work. Returns the loop while it plays, else null.
  loop(key, gain, at, camera, build) {
    const { ctx } = this, t = ctx.currentTime, idle = SOUND.loop;
    let loop = this.loops.get(key);
    if (gain <= 0) {
      if (!loop) return null;
      loop.quiet ??= t;
      if (t - loop.quiet > idle.idle) {
        for (const src of loop.sources) src.stop();
        loop.node.disconnect();
        loop.pan.disconnect();
        this.loops.delete(key);
        return null;
      }
    } else if (loop) loop.quiet = null;
    if (!loop) {
      const node = ctx.createGain(), pan = ctx.createStereoPanner();
      node.gain.value = 0;
      node.connect(pan).connect(this.master);
      loop = { node, pan, quiet: null, ...build(node) };
      for (const src of loop.sources) src.start();
      this.loops.set(key, loop);
    }
    this.camera = camera;
    const p = this.p.copy(at).applyMatrix4(camera.matrixWorldInverse), d = Math.max(p.length(), 0.1);
    loop.node.gain.setTargetAtTime(gain, t, idle.follow);
    loop.pan.pan.setTargetAtTime(clamp(SOUND.pan * p.x / d * 1.5, -SOUND.pan, SOUND.pan), t, idle.follow);
    return loop;
  }

  // A noisy miner's call: e.kind is 'chip' or 'scold', a recording at a different pitch each time, or
  // 'yelp' (hurt): the chip, high and fast. A yelp always plays.
  minerCall(e, camera) {
    const yelp = e.kind === 'yelp';
    if (this.ctx.state !== 'running' || (!yelp && this.ctx.currentTime - this.minerAt < SOUND.minerGap)) return;
    this.minerAt = this.ctx.currentTime;
    this.camera = camera;
    const rate = (yelp ? SOUND.yelpPitch : 1) * this.vary(SOUND.minerPitch);
    this.sample(this.samples[yelp ? 'chip' : e.kind], this.at.copy(e.at), L[e.kind] * this.vary(0.1), rate, SOUND.minerTone);
  }

  // ---- the sounds ----

  // A soft pat of a padded foot: low, muffled noise with a slow attack and a dull body. No high click.
  // A scuff scrapes. On grass: softer, a muffled pat with a few small crackles and a faint body, all low.
  // Wet or muddy feet squelch.
  step(place, speed, scuff, ibis, level) {
    const run = clamp((speed - SOUND.runSpeed) / 2, 0, 1);
    const v = this.voice(place, level * (0.25 + 0.25 * run));
    if (!v) return;
    if (this.under?.(place.x, place.z) === 'grass') {
      const soft = this.soften(v, SOUND.grassStep.tone);
      this.burst(v, { length: 0.09, gain: L.grassStep, attack: 0.015, filter: ['lowpass', 900 * this.vary(0.2), 300, 0.7] }, soft);
      for (let i = 0; i < 3; i++) {
        this.burst(v, { at: 0.005 + 0.05 * this.rand(), length: 0.025, gain: 0.35 * L.grassStep, attack: 0.004, filter: ['bandpass', 800 * this.vary(0.25), 600, 1.5] }, soft);
      }
      this.tone(v, { length: 0.06, gain: 0.2, f0: 120 * this.vary(0.15), f1: 60 });
    } else {
      this.burst(v, { length: 0.07, gain: 1, attack: 0.008, filter: ['lowpass', 600 * this.vary(0.2), 220, 0.7] });
      this.tone(v, { length: 0.06, gain: 0.45, f0: 120 * this.vary(0.15), f1: 60 });
      if (scuff) this.burst(v, { length: 0.16, gain: L.scuff, attack: 0.01, filter: ['lowpass', 3500, 700, 0.7] });
    }
    const wet = Math.max(ibis.wet, ibis.mud);
    if (wet > 0.1) this.burst(v, { at: 0.01, length: 0.09, gain: L.squelch * wet, attack: 0.02, filter: ['bandpass', 400, 1100 * this.vary(0.2), 3] });
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
    this.sample(this.samples.honk, place, L.call * gain * this.vary(0.1), pitch * this.vary(SOUND.honkPitch));
  }

  // A recording at a place, at a gain and a playback rate. Nothing until it has loaded.
  // lowpass: a cut-off in Hz, or 0 for none.
  sample(buffer, place, gain, rate, lowpass = 0) {
    if (!buffer) return;
    const v = this.voice(place, gain);
    if (!v) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    if (lowpass) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      src.connect(f).connect(v.node);
    } else src.connect(v.node);
    this.end(v, src);
    src.start(v.t);
  }

  // Threat hiss, like a goose: high noise that shakes at 23 Hz, as the jaw does.
  hiss(place, length) {
    const v = this.voice(place, L.hiss);
    if (!v) return;
    const { gain: shake, lfo } = this.wobble(23, 0.6);
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

  // The bill takes hold of a prop: a soft, muffled snap, lower than a clack. A stubby (hold 'round')
  // adds a faint tick of glass.
  pick(place, hold) {
    const v = this.voice(place, L.pick * 0.4);
    if (!v) return;
    this.burst(v, { length: 0.045, gain: 1, attack: 0.003, filter: ['bandpass', 1500 * this.vary(0.15), 700, 2] });
    this.tone(v, { length: 0.05, gain: 0.35, f0: 320 * this.vary(0.1), f1: 160 });
    if (hold === 'round') this.tone(v, { at: 0.005, length: 0.06, gain: 0.06, f0: 3200 * this.vary(0.1), f1: 3150 });
  }

  // A tap handle turned by the bill: a short metal squeak and a click.
  squeak(place) {
    const v = this.voice(place, L.turn);
    if (!v) return;
    const f = 1100 * this.vary(0.1);
    this.tone(v, { length: 0.14, gain: 0.25, f0: f, f1: f * 1.35, type: 'triangle' });
    this.burst(v, { at: 0.12, length: 0.03, gain: 0.5, attack: 0.002, filter: ['bandpass', 2400 * this.vary(0.15), 1800, 2] });
  }

  // ---- parts ----

  // A low-pass into the voice, flat to the cut-off at hz: bursts through it (burst(..., to)) lose their
  // high end twice as fast, with their own filter.
  soften(v, hz) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = hz;
    f.Q.value = -3;   // dB for a low-pass: no bump at the cut-off
    f.connect(v.node);
    return f;
  }

  // A gain that swings between 1 - depth and 1, rate times a second. The caller starts and stops the lfo.
  wobble(rate, depth) {
    const { ctx } = this, gain = ctx.createGain(), lfo = ctx.createOscillator(), amount = ctx.createGain();
    gain.gain.value = 1 - depth / 2;
    amount.gain.value = depth / 2;
    lfo.frequency.value = rate;
    lfo.connect(amount).connect(gain.gain);
    return { gain, lfo };
  }

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
