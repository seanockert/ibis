// Combo: the rules of the Bin night combo toy (docs/game-findings.md, "Direction H"). Each crash, slide or
// clumsy fall is a link. A link refills the fuse; when the fuse burns out, the combo banks: the sum of
// its links times the number of links. A link repeated in one combo scores less. The run lasts
// COMBO.time seconds.
// Spills (spills.js) are the mess that builds the park: a tipped bin spills, a stomped cereal box
// spills, and a run onto a spill is a slide in the splits.
//
//   const combo = new Combo(level, { time, spills });   // spills: [{ at, radii, angle, kind }] at the start
//   combo.update(dt);   // every frame, after level.update()
//   combo.events        // this update: { type: 'link', link } | { type: 'bank', value, links } | { type: 'over' }
import { Quaternion, Vector3 } from 'three';
import { tiltAngle } from './physics.js';
import { Ball, Bin, Box, Cereal } from './props.js';
import { Spills } from './spills.js';
import { Stubbies } from './stubbies.js';

// fuse: seconds a link keeps the combo alive. air: the fuse burns at this rate in the air (none in a
// clumsy fall or a slide). repeat: points of the nth use of a link in one combo.
// fallen, up: tilt (radians) where a prop is down, and up again. group: seconds that stubby falls join
// into one link. slide: start (speed onto a spill for a slide), wobble (a slower step onto one stumbles),
// boost (speed times this), min (least slide speed), drag (slow down per second on a spill, and off),
// points (plus perUnit for each unit slid). hardLand: landing speed for a hard landing (a fall of about
// 2.3). airMail: a prop that falls this near a thrown prop, within life seconds of the throw, scores
// times factor. spill: of a bin (out: its middle from the bin's middle; wait: seconds after the fall)
// and a cereal box. crash: a slam of a prop that is already down, at most once each gap seconds.
export const COMBO = {
  time: 120, fuse: 3, air: 0.5,
  repeat: [1, 0.6, 0.35, 0.2, 0.1],
  fallen: 1.0, up: 0.5, group: 0.45,
  slide: { start: 1.6, wobble: 0.5, boost: 1.2, min: 3.4, drag: 0.6, off: 1.5, points: 100, perUnit: 60 },
  hardLand: 10.5,
  airMail: { near: 2.5, life: 3, factor: 2 },
  crash: { points: 50, gap: 1.0 },
  footy: { speed: 5, gap: 1.5, points: 100 },
  spill: { bin: { radii: [2.3, 1.5], out: 3.4, wait: 0.7 }, cereal: { radii: [0.9, 0.75] } },
};

// Link names and points.
const TRICK = {
  bin: ['Bin Tip', 400], box: ['Box Topple', 200], cereal: ['Cereal Topple', 120], stomp: ['Cereal Stomp', 150],
  stubby: ['Stubby', 60], stubbies: ['Stubbies', 60], strike: ['Strike!', 1000],
  stumble: ['Stacked It!', 150], knockedOver: ['Faceplant', 200], hardLand: ['Hard Landing', 200], flop: ['Belly Flop', 300],
  chuck: ['Chuck', 50], slide: ['Splits Slide', 100], crash: ['Crash', 50], footy: ['Footy Punt', 100],
};
const CLUMSY = new Set(['stumble', 'knockedOver', 'hardLand', 'slip', 'slide']);

export class Combo {
  constructor(level, { time = COMBO.time, spills = [] } = {}) {
    this.level = level;
    this.left = time;
    this.total = 0;
    this.best = 0;          // the best combo of the run
    this.combo = null;      // { links: [{ name, points, faded }], sum, fuse, uses: Map }
    this.events = [];
    this.over = false;
    this.slide = null;      // { speed, from: Vector3 }
    this.onSpill = false;
    this.stubbyRun = null;  // { n, t }: stubbies that fell close together
    this.bins = [];         // { id, t }: bins that fell; they spill when they come to rest
    this.spills = new Spills(level.scene, level.asset, level.ground.height);
    spills.forEach((s, i) => this.spills.add({ ...s, seed: 100 + i, grown: true }));
    // The props that can fall: one piece for each body.
    this.pieces = [];
    for (const prop of level.props) {
      const kind = prop instanceof Bin ? 'bin' : prop instanceof Box ? 'box' : prop instanceof Cereal ? 'cereal' : null;
      if (kind) this.pieces.push({ prop, kind, id: () => prop.id, down: false, crashAt: -9 });
      if (prop instanceof Stubbies) for (const b of prop.bottles) this.pieces.push({ prop, kind: 'stubby', id: () => b.id, down: false, crashAt: -9 });
    }
    this.balls = level.props.filter(p => p instanceof Ball).map(prop => ({ prop, at: -9 }));
    this.stubbies = this.pieces.filter(p => p.kind === 'stubby').length;
    this.action = null;
    this.time = 0;
  }

  get value() { return this.combo ? Math.round(this.combo.sum) * this.combo.links.length : 0; }

  update(dt) {
    this.events = [];
    this.time += dt;
    this.spills.update(dt);
    if (this.over) return;
    const { level } = this, player = level.player, c = player.character;
    this.left -= dt;
    this.watchProps(dt);
    this.watchBird(c, dt);
    // The fuse: it burns on the ground, slower in the air, and not in a fall or a slide.
    if (this.combo) {
      const clumsy = CLUMSY.has(c.action) || this.slide;
      this.combo.fuse -= dt * (clumsy ? 0 : c.controller.grounded ? 1 : COMBO.air);
      if (this.combo.fuse <= 0) this.bank();
    }
    if (this.left <= 0) {
      this.left = 0;
      if (this.slide) this.endSlide(c);
      this.bank();
      this.over = true;
      this.events.push({ type: 'over' });
      player.act('happy');
    }
  }

  // Props that fall over, slams, a stomped cereal box, a kicked footy.
  watchProps(dt) {
    const { level } = this, { physics } = level;
    const thrown = (level.fling?.thrown ?? []).filter(t => t.t < COMBO.airMail.life);
    for (const p of this.pieces) {
      const id = p.id(), body = physics.body(id);
      if (!body || physics.held(id)) continue;
      const tilt = tiltAngle(body.quaternion);
      if (p.down && tilt < COMBO.up) p.down = false;
      if (p.down || tilt < COMBO.fallen) continue;
      p.down = true;
      p.crashAt = this.time;
      // A fall near a prop that the bird threw: air mail.
      const at = new Vector3().fromArray(body.position);
      const mail = thrown.some(t => t.id !== id && physics.body(t.id) && at.distanceTo(new Vector3().fromArray(physics.body(t.id).position)) < COMBO.airMail.near);
      if (p.kind === 'stubby') {
        this.stubbyRun = { n: (this.stubbyRun?.n ?? 0) + 1, t: 0, mail: mail || this.stubbyRun?.mail };
        continue;
      }
      if (p.kind === 'bin') this.bins.push({ id, t: 0 });
      this.link(p.kind, { mail });
    }
    // Stubbies that fall close together are one link: all of them is a strike.
    if (this.stubbyRun && (this.stubbyRun.t += dt) > COMBO.group) {
      const { n, mail } = this.stubbyRun;
      this.stubbyRun = null;
      if (n >= this.stubbies) this.link('strike', { mail });
      else this.link(n > 1 ? 'stubbies' : 'stubby', { times: n, mail, label: n > 1 ? `Stubbies ×${n}` : null });
    }
    for (const b of this.bins) if ((b.t += dt) > COMBO.spill.bin.wait) this.spillBin(physics.body(b.id));
    this.bins = this.bins.filter(b => b.t <= COMBO.spill.bin.wait);
    for (const prop of level.props) for (const e of prop.events) {
      if (e.type === 'squash') {
        this.spills.add({ at: [e.centre.x, e.centre.z], radii: COMBO.spill.cereal.radii, angle: this.time * 2.3, kind: 'cereal' });
        this.link('stomp');
      }
      // A slam of a prop that was already down: a crash.
      if (e.type === 'slam' && e.kind !== 'glass') {
        const p = this.pieces.find(q => q.prop === prop);
        if (p && p.down && this.time - p.crashAt > COMBO.crash.gap) { p.crashAt = this.time; this.link('crash'); }
      }
    }
    for (const b of this.balls) {
      const body = physics.body(b.prop.id), v = body.motionProperties.linearVelocity;
      if (Math.hypot(...v) > COMBO.footy.speed && this.time - b.at > COMBO.footy.gap) { b.at = this.time; this.link('footy'); }
    }
  }

  // A bin on its side spills from its mouth.
  spillBin(body) {
    if (!body) return;
    const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(body.quaternion));
    up.y = 0;
    if (up.lengthSq() < 0.01) up.set(0, 0, 1);
    up.normalize();
    const S = COMBO.spill.bin, at = new Vector3().fromArray(body.position).addScaledVector(up, S.out);
    this.spills.add({ at: [at.x, at.z], radii: S.radii, angle: Math.atan2(up.x, up.z), kind: 'rubbish' });
  }

  // Slides, wobbles, falls, hard landings and throws.
  watchBird(c, dt) {
    const ctl = c.controller, p = c.position;
    const on = ctl.grounded && this.spills.at(p.x, p.z), entered = on && !this.onSpill;
    this.onSpill = on;
    const S = COMBO.slide;
    if (this.slide) {
      // Slide on in the splits along the heading, slower off the spill.
      const s = this.slide;
      s.speed -= (on ? S.drag : S.off) * dt;
      // A new spill on the way gives a push.
      if (entered) s.speed = Math.max(s.speed, S.min);
      c.drive = Math.max(s.speed, 0);
      if (s.speed <= 0.3 || c.action !== 'slide') this.endSlide(c);
    } else if (entered && !CLUMSY.has(c.action)) {
      const speed = Math.abs(ctl.speed);
      if (speed >= S.start) {
        c.act('slide');
        this.slide = { speed: Math.max(speed * S.boost, S.min), from: p.clone() };
        c.drive = this.slide.speed;
      } else if (speed >= S.wobble) c.act('stumble');
    }
    // A hard landing from high up; on a prop, a belly flop.
    for (const e of c.events) {
      if (e.type === 'land' && e.impact >= COMBO.hardLand && !CLUMSY.has(c.action)) {
        c.act('hardLand');
        const ground = this.level.ground.height(p.x, p.z);
        this.link(p.y - ground > 0.3 ? 'flop' : 'hardLand');
      }
      if (e.type === 'fling') this.link('chuck');
    }
    // A stumble (a trip at a run, a wobble on a spill) or a knock down: stacked it.
    if (c.action !== this.action && (c.action === 'stumble' || c.action === 'knockedOver')) this.link(c.action);
    this.action = c.action;
  }

  endSlide(c) {
    const far = Math.hypot(c.position.x - this.slide.from.x, c.position.z - this.slide.from.z);
    this.slide = null;
    c.drive = null;
    if (c.action === 'slide') c.animator.stop();
    this.link('slide', { extra: Math.round(far * COMBO.slide.perUnit), label: `Splits Slide ${far.toFixed(1)}m` });
  }

  // Adds a link to the combo, or starts one. times: the points times this. extra: points on top.
  link(kind, { times = 1, extra = 0, mail = false, label = null } = {}) {
    if (this.over) return;
    const [name, base] = TRICK[kind];
    const combo = this.combo ??= { links: [], sum: 0, fuse: 0, uses: new Map() };
    const uses = combo.uses.get(name) ?? 0;
    combo.uses.set(name, uses + 1);
    const k = COMBO.repeat[Math.min(uses, COMBO.repeat.length - 1)];
    const points = Math.round((base * times + extra) * k * (mail ? COMBO.airMail.factor : 1));
    const link = { name: (mail ? 'Air Mail ' : '') + (label ?? name), points, faded: k < 1 };
    combo.links.push(link);
    combo.sum += points;
    combo.fuse = COMBO.fuse;
    this.events.push({ type: 'link', link });
  }

  bank() {
    if (!this.combo) return;
    const value = this.value, links = this.combo.links.length;
    this.total += value;
    this.best = Math.max(this.best, value);
    this.combo = null;
    this.events.push({ type: 'bank', value, links });
  }
}
