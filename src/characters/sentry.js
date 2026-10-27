// Sentry: the brain of the noisy miners. Each one guards a territory round a high perch near its home,
// as a guard dog guards a yard. It has four states:
// - watch: it sits on its perch and looks round.
// - alert: the player is within the alert distance of the perch. It turns to face the player, bobs,
//   flicks its wings and calls, faster as the player comes nearer.
// - attack: after at least SENTRY.warn seconds of alert, the player comes within SENTRY.attack, or the
//   patience runs out. On a perch it sits for SENTRY.spot seconds first. It takes off, circles over the player,
//   calls and dives at its head. One miner dives at a time.
// - back: the player is farther than the leave distance (SENTRY.leave, longer with noise) from the perch. It flies back to the perch and lands.
// Noise: each miner hears disruption within SENTRY.hear of its perch: the player runs (update()), a prop
// crashes, or the player squawks or hisses (hear()). Its noise (0 to 1) makes the alert distance longer
// (SENTRY.wary), the patience run out faster (SENTRY.hurry) and the agitation higher, then fades
// (SENTRY.quiet). The rules are fixed, so a player can learn them.
// Snap: a peck of the player while a miner flies near its head (prey(), with a white outline) is a snap
// at the miner (the 'snap' action). A miner near the head in the bite (bite()) is hurt: it tumbles away, takes
// the free perch nearest to it that is out of the player's range as its new home, flies there and
// lands. It does not go on alert or attack for SNAP.cool seconds.
// If the perch moves or tips (a bin), it finds another perch near its home. A '?' shows over the head
// in the alert, and a '!' for SENTRY.exclaim seconds as the attack starts (flier.mark). Random values
// come from hash() with the seed.
//
//   const sentry = new Sentry(seed);
//   sentry.add(flier, home, perches);            // home: [x, z]. The flier sits on its perch at once
//   sentry.update(player, dt, perches);          // every frame, before the fliers' update. Then
//                                                // sentry.events: 'alert' { flier } as one goes on alert,
//                                                // 'hurt' { flier } as a snap hurts one
//   sentry.bite();                               // the player's snap bites now ('bite' event)
//   sentry.prey();                               // the miner a peck snaps at now (outlined), or null
//   sentry.hear(at, loud);                       // a noise at a world point: loud, a kind of SENTRY.loud
import { Vector3 } from 'three';
import { clamp, hash } from '../ibis/motion/spring.js';

// home: the perch is the highest one this near the home (on the ground, world units); of perches at about
// the same height, the nearest. alert, attack, leave: distances from the perch to the player, on the
// ground, world units. calm: the player must go this much past alert before the miner calms down.
// patience: seconds in the alert zone before it attacks, with no noise. warn: the shortest alert before
// an attack, seconds, so the '?' always shows first. chip: seconds between alert calls, at the edge
// of the alert zone and at the attack distance. scold: seconds between calls in the air. wait: the
// pause between dives, seconds, shortest and longest. moved: it leaves a perch that moves this far.
// settle: agitation change per second. spot: seconds it sits on the perch with the '!' before it takes
// off to attack. exclaim: seconds the '!' shows as the attack starts.
// Noise. hear: the distance from the perch it hears noise in. loud: the noise that each kind adds (run:
// for each second of a run, at speed run or more; slam: a prop that falls or crashes, times its
// strength; call: a squawk or a hiss). quiet: noise lost per second. wary: the alert distance grows by
// this at full noise, and so does the leave distance. hurry: the patience runs out this many times faster at full noise, plus one.
export const SENTRY = {
  home: 4, alert: 9, attack: 5, leave: 13, calm: 1, patience: 5, warn: 1.2,
  chip: [3.5, 1.5], scold: [2.5, 4.5], wait: [1.2, 3], moved: 0.3, settle: 0.5, spot: 0.6, exclaim: 1.5,
  hear: 18, loud: { run: 0.35, slam: 0.8, call: 0.4 }, run: 1.6, quiet: 0.08, wary: 7, hurry: 2,
};

// Snap. range: a miner in the air is prey this near the head, where a snap now hits a dive (from about
// 1.4 to 3.5). reach: a miner whose body is this near the head in the bite is hurt. window: seconds the
// bite lasts from the 'bite' event. away: the new perch is at least this far from the player, on the
// ground. cool: seconds with no alert and no attack after a hurt. All distances world units.
export const SNAP = { range: 3.5, reach: 1.2, window: 0.2, away: 16, cool: 5 };

export class Sentry {
  constructor(seed = 0) {
    this.seed = seed;
    this.draws = 0;
    this.guards = [];   // { flier, home (Vector3), perch (the prop or spot), spot (where it is now), state, time, wait }
    this.wait = 0;      // seconds before the next dive
    this.next = 0;      // the guard that dives next
    this.head = new Vector3();
    this.events = [];   // this update: 'alert' { flier }, 'hurt' { flier }
    this.biting = 0;    // seconds left of the player's bite
  }

  random(min = 0, max = 1) { return min + (max - min) * hash(this.seed * 7919 + this.draws++); }

  // flier: Flier (src/miner/flier.js). home: [x, z]. perches: what it can sit on: each has perch() (a
  // world point, or null when it can't take a bird now) and optional face (a ground direction to land
  // along). It starts on its perch, or circles over its home when there is none.
  add(flier, home, perches) {
    const G = { flier, home: new Vector3(home[0], 0, home[1]), perch: null, spot: new Vector3(), state: 'back', time: 0, wait: 0, fuse: 0, noise: 0, cool: 0 };
    this.guards.push(G);
    flier.flight.centre.copy(G.home);
    if (!this.pick(G, perches)) return;
    flier.flight.settle(G.spot, G.perch.face ?? null);
    G.state = 'watch';
  }

  // The highest free perch near the home. Gives false when there is none.
  pick(G, perches) {
    const taken = new Set(this.guards.map(g => g.perch));
    let best = null;
    for (const perch of perches) {
      if (taken.has(perch)) continue;
      const at = perch.perch(), d = at && Math.hypot(at.x - G.home.x, at.z - G.home.z);
      if (!at || d > SENTRY.home) continue;
      if (!best || at.y > best.at.y + 0.05 || (at.y > best.at.y - 0.05 && d < best.d)) best = { perch, at, d };
    }
    G.perch = best?.perch ?? null;
    if (best) G.spot.copy(best.at);
    return best !== null;
  }

  // A noise at a world point (a crash, a squawk): loud is the noise it adds at the perch, within SENTRY.hear.
  hear(at, loud) {
    for (const G of this.guards) {
      if (Math.hypot(at.x - G.spot.x, at.z - G.spot.z) < SENTRY.hear) G.noise = Math.min(G.noise + loud, 1);
    }
  }

  // The player's snap bites now: for SNAP.window seconds, a miner near the head is hurt.
  bite() { this.biting = SNAP.window; }

  // The miner (Flier) that a peck of the player snaps at now, or null: the nearest one in the air within
  // SNAP.range of the head.
  prey() {
    let best = null, near = SNAP.range;
    for (const G of this.guards) {
      const f = G.flier.flight;
      if (f.perched || f.tumble) continue;
      const d = G.flier.centre().distanceTo(this.head);
      if (d < near) { best = G.flier; near = d; }
    }
    return best;
  }

  // player: the Ibis that the miners guard against, or null.
  update(player, dt, perches = []) {
    this.events.length = 0;
    if (!player) return;
    player.object.updateMatrixWorld();
    this.head.copy(player.rig.head).applyMatrix4(player.object.matrixWorld);
    const at = player.object.position, c = player.character.controller;
    if (Math.abs(c.speed) >= SENTRY.run && c.grounded) this.hear(at, SENTRY.loud.run * dt);
    for (const G of this.guards) {
      const f = G.flier.flight;
      G.time += dt;
      G.noise = Math.max(G.noise - SENTRY.quiet * dt, 0);
      G.cool = Math.max(G.cool - dt, 0);
      if (this.biting > 0 && !G.flier.flight.perched && !G.flier.flight.tumble && G.flier.centre().distanceTo(this.head) < SNAP.reach) this.hurt(G, at, perches);
      f.target.copy(this.head);
      // The perch moves or tips: leave it, and find another.
      if (G.perch) {
        const now = G.perch.perch();
        if (!now || now.distanceTo(G.spot) > SENTRY.moved) {
          G.perch = null;
          f.takeOff();
          if (G.state !== 'attack') this.go(G, 'back');
        } else G.spot.copy(now);
      }
      const d = Math.hypot(at.x - G.spot.x, at.z - G.spot.z);
      if (G.state === 'watch') this.watch(G, d, dt);
      else if (G.state === 'alert') this.alert(G, d, dt);
      else if (G.state === 'attack') this.attack(G, d, dt);
      else this.back(G, d, dt, perches);
      G.flier.mark = G.state === 'alert' ? '?' : G.state === 'attack' && G.time < SENTRY.exclaim ? '!' : null;
    }
    this.biting = Math.max(this.biting - dt, 0);
    this.dive(dt);
  }

  // A snap hurts G: it tumbles away and takes a new home on the free perch nearest to it that is at
  // least SNAP.away from the player (at). With none, a home that far, straight away from the player.
  hurt(G, at, perches) {
    const f = G.flier.flight, p = f.position;
    f.hurt(this.head);
    const taken = new Set(this.guards.map(g => g !== G && g.perch));
    let best = null;
    for (const perch of perches) {
      const spot = !taken.has(perch) && perch.perch();
      if (!spot || Math.hypot(spot.x - at.x, spot.z - at.z) < SNAP.away) continue;
      const d = Math.hypot(spot.x - p.x, spot.z - p.z);
      if (!best || d < best.d) best = { perch, spot, d };
    }
    if (best) {
      G.perch = best.perch;
      G.spot.copy(best.spot);
      G.home.set(best.spot.x, 0, best.spot.z);
    } else {
      G.perch = null;
      const away = new Vector3(p.x - at.x, 0, p.z - at.z);
      if (away.lengthSq() < 1e-6) away.set(1, 0, 0);
      G.home.set(at.x, 0, at.z).addScaledVector(away.normalize(), SNAP.away);
    }
    this.go(G, 'back');
    G.cool = SNAP.cool;
    G.noise = 0;
    this.events.push({ type: 'hurt', flier: G.flier });
  }

  go(G, state) {
    G.state = state;
    G.time = 0;
    G.wait = 0;
    G.fuse = 0;
    if (state === 'alert') this.events.push({ type: 'alert', flier: G.flier });
  }

  // The alert distance now: longer with noise.
  reach(G) { return SENTRY.alert + SENTRY.wary * G.noise; }

  // The distance where an attack ends now: longer with noise by the same amount, so a miner that noticed
  // the player from far does not turn back at once.
  far(G) { return SENTRY.leave + SENTRY.wary * G.noise; }

  // On the perch, calm: it looks round.
  watch(G, d, dt) {
    const f = G.flier.flight;
    f.watch = null;
    f.agitation = Math.max(f.agitation - SENTRY.settle * dt, 0);
    if (G.cool <= 0 && d < this.reach(G)) this.go(G, 'alert');
  }

  // On the perch, it faces the player and calls, faster and more agitated as the player comes nearer or
  // makes noise. Noise also runs the patience out faster.
  alert(G, d, dt) {
    const f = G.flier.flight;
    const near = Math.max(clamp((SENTRY.alert - d) / (SENTRY.alert - SENTRY.attack), 0, 1), G.noise);
    G.fuse += dt * (1 + SENTRY.hurry * G.noise);
    f.watch = this.head;
    f.agitation = Math.min(f.agitation + SENTRY.settle * dt, 0.4 + 0.6 * near);
    if ((G.wait -= dt) <= 0) {
      f.call('chip');
      G.wait = (SENTRY.chip[0] + (SENTRY.chip[1] - SENTRY.chip[0]) * near) * this.random(0.8, 1.2);
    }
    if (d > this.reach(G) + SENTRY.calm) this.go(G, 'watch');
    else if (G.time > SENTRY.warn && (d < SENTRY.attack || G.fuse > SENTRY.patience)) {
      f.call('scold');
      this.go(G, 'attack');
      G.wait = this.random(...SENTRY.scold);
    }
  }

  // It takes off after SENTRY.spot, then circles over the player and calls. dive() sends the dives.
  attack(G, d, dt) {
    const f = G.flier.flight;
    if (G.time > SENTRY.spot) f.takeOff();
    f.centre.set(this.head.x, 0, this.head.z);
    f.watch = this.head;
    f.agitation = 1;
    if ((G.wait -= dt) <= 0) {
      f.call('scold');
      G.wait = this.random(...SENTRY.scold);
    }
    if (d > this.far(G)) this.go(G, 'back');
  }

  // Back to the perch. It attacks again if the player comes within the attack distance.
  back(G, d, dt, perches) {
    const f = G.flier.flight;
    f.centre.copy(G.home);
    f.agitation = Math.max(f.agitation - SENTRY.settle * dt, 0);
    if (d < SENTRY.attack && !f.landed && G.cool <= 0) {
      f.takeOff();
      this.go(G, 'attack');
      return;
    }
    if (f.landed) { this.go(G, d < SENTRY.alert && G.cool <= 0 ? 'alert' : 'watch'); return; }
    if (!f.circling) return;
    if (!G.perch && !this.pick(G, perches)) return;
    f.land(G.spot, G.perch.face ?? null);
  }

  // One dive at a time: the next attacker in turn that circles, after a pause.
  dive(dt) {
    if (!this.guards.some(G => G.state === 'attack') || this.guards.some(G => G.flier.flight.diving)) return;
    if ((this.wait -= dt) > 0) return;
    for (let i = 0; i < this.guards.length; i++) {
      const G = this.guards[this.next++ % this.guards.length];
      if (G.state !== 'attack' || !G.flier.flight.circling) continue;
      G.flier.flight.dive();
      G.flier.flight.call('scold');
      G.wait = this.random(...SENTRY.scold);
      this.wait = this.random(...SENTRY.wait);
      return;
    }
  }
}
