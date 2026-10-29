// Bees on the clover (clover.js). Each flies from flower to flower, hovers, lands, and sometimes drifts
// over the patch or flies to another. They keep off flowers near a bird and scatter from one. Day only.
// One instanced draw of camera-facing quads. Shared insect code: insects.js.
//
//   const bees = new Bees([{ at, radius, count, flowers }], height);   // flowers: head tops; height(x, z): clover or ground
//   bees.update(dt, ibises, camera);
import { DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, Mesh, ShaderMaterial, Vector3 } from 'three';
import { hash, smoothstep } from '../ibis/motion/spring.js';
import { awayFrom, insect, INSECT, move, quads, rand, range, seek } from './insects.js';
import { LIGHT } from './lighting.js';
import { f, srgb } from './util.js';

// Units and seconds. arc, climb, high: flight height between heads, more on long flights. drift: hover over
// the patch, not on a flower. shy: no landing this near a bird. scatter: a bird this near sends the bee
// away and up, faster, for time. low: flight height over the clover. night: hidden above this LIGHT.night
// (dusk is 0.45). near, far: fade in and out distances from the camera (a gap, so no flicker at one
// distance). pull: the quad moves toward the camera, so grass does not hide it. size: half the quad.
export const BEES = {
  speed: 1.6, turn: 5, weave: 0.7, bob: 0.25,
  arc: 0.3, climb: 0.05, high: 0.9, hover: 0.1, rest: [0.3, 0.9], sit: [1.5, 4.5],
  drift: { chance: 0.3, height: [0.25, 0.6], time: [1.5, 4], circle: 0.12 },
  pick: 4, hop: 0.1, shy: 1.2,
  scatter: { radius: 1.1, above: 2.2, away: [1.8, 3.2], up: [0.5, 1.1], turn: 1.2, speed: 2.4, time: [2, 4] },
  low: 0.1, night: 0.1, near: 24, far: 30, fade: 0.6, pull: 0.6,
  size: 0.11,
};
const BODY = srgb(0.08, 0.07, 0.06);
const STRIPE = srgb(0.98, 0.76, 0.14);
const WING = srgb(0.80, 0.84, 0.90);
const want = new Vector3(), side = new Vector3(), goal = new Vector3(), right = new Vector3();   // scratch

export class Bees {
  constructor(patches, height) {
    this.height = height;
    let seed = 0;
    this.patches = patches.filter(p => p.flowers.length);
    this.bees = this.patches.flatMap((p, i) => Array.from({ length: Math.min(p.count, p.flowers.length) }, (_, k) => {
      const b = insect(++seed, { patch: i, flower: 0, head: new Vector3(1, 0, 0), state: 'sit', t: 0, scared: 0, show: -1, near: false, flip: 1 });
      b.flower = (Math.floor(hash(i * 13 + 5) * p.flowers.length) + 3 * k) % p.flowers.length;   // one bee to a flower
      b.pos.copy(b.goal.copy(p.flowers[b.flower]));
      b.timer = range(b, BEES.sit);
      return b;
    }));
    const g = quads(this.bees.length);
    this.at = new InstancedBufferAttribute(new Float32Array(this.bees.length * 4), 4).setUsage(DynamicDrawUsage);
    this.dir = new InstancedBufferAttribute(new Float32Array(this.bees.length * 4), 4).setUsage(DynamicDrawUsage);
    g.setAttribute('aBee', this.at);
    g.setAttribute('aDir', this.dir);
    g.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(this.bees.length).map((_, i) => hash(i * 37 + 11)), 1));
    this.material = beeMaterial();
    this.object = new Mesh(g, this.material);
    this.object.frustumCulled = false;
  }

  update(dt, birds, camera) {
    dt = Math.min(dt, 0.1);
    this.material.uniforms.uTime.value += dt;
    const a = this.at.array, d = this.dir.array, day = LIGHT.night.value <= BEES.night;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.bees.forEach((b, k) => {
      const far = b.pos.distanceTo(camera.position);
      if (b.show < 0) b.near = far < BEES.far;
      else if (far < BEES.near) b.near = true;
      else if (far > BEES.far) b.near = false;
      const on = day && b.near;
      b.show = b.show < 0 ? +on : Math.min(Math.max(b.show + (on ? 1 : -1) * dt / BEES.fade, 0), 1);   // first frame: at once
      if (day) this.step(b, dt, birds);
      // Facing on screen: changes only on a clear sideways flight, so it does not flip each frame.
      const across = b.head.dot(right);
      if (Math.abs(across) > 0.3 * b.head.length()) b.flip = Math.sign(across);
      b.pos.toArray(a, 4 * k);
      a[4 * k + 3] = b.show === 0 ? -1 : b.state === 'sit' ? 0 : 1;
      b.head.toArray(d, 4 * k);
      d[4 * k + 3] = b.show * b.flip;
    });
    this.at.needsUpdate = this.dir.needsUpdate = true;
  }

  // States: sit (on a head), fly (to the goal), hover (over it, then land on a flower or choose again).
  step(b, dt, birds) {
    const { speed, turn, weave, bob, arc, climb, high, hover, rest, sit, drift } = BEES;
    b.timer -= dt;
    b.t += dt;
    b.scared -= dt;
    if (b.scared <= 0) this.scatter(b, birds);
    if (b.state === 'sit') {
      if (b.timer > 0 && !shy(b.goal, birds)) return;
      this.choose(b, birds);
      b.vel.set(0, 0.8, 0);
    }
    const flower = b.flower >= 0, flat = Math.hypot(b.goal.x - b.pos.x, b.goal.z - b.pos.z);
    if (b.state === 'fly' && flat < 0.08) { b.state = 'hover'; b.timer = flower ? range(b, rest) : range(b, drift.time); }
    if (b.state === 'hover' && (flower ? shy(b.goal, birds) : b.timer <= 0)) this.choose(b, birds);
    const landing = flower && b.state === 'hover' && b.timer <= 0;
    goal.copy(b.goal);
    if (!flower && b.state === 'hover') goal.add(side.set(Math.cos(b.t * 1.3 + b.seed), 0.4 * Math.sin(b.t * 0.9), Math.sin(b.t * 1.3 + b.seed)).multiplyScalar(drift.circle));
    else if (flower && !landing) goal.y += hover + (b.state === 'fly' ? arc * smoothstep(0.1, 0.8, flat) + Math.min(climb * flat, high) : 0);
    if (landing && b.pos.distanceTo(goal) < 0.02) {
      b.state = 'sit';
      b.timer = range(b, sit);
      b.pos.copy(b.goal);
      b.vel.set(0, 0, 0);
      return;
    }
    seek(b, goal, (b.state === 'fly' ? speed : 0.4 * speed) * (b.scared > 0 ? BEES.scatter.speed : 1), 0.25, want);
    // Weave and bob, less near the goal, none when landing.
    const sway = landing ? 0 : Math.min(b.pos.distanceTo(goal) / 0.3, 1) * (b.state === 'fly' ? 1 : 0.4);
    want.add(side.set(-want.z, 0, want.x).normalize().multiplyScalar(weave * sway * Math.sin(b.t * 6.5 + b.seed)));
    want.y += bob * sway * Math.sin(b.t * 4.7 + 2 * b.seed);
    move(b, want, turn, dt);
    if (!landing) b.pos.y = Math.max(b.pos.y, this.height(b.pos.x, b.pos.z) + BEES.low);
    if (b.vel.lengthSq() > 0.04) b.head.copy(b.vel);
  }

  // A bird near: fly fast away and up.
  scatter(b, birds) {
    const { radius, above, away, up, turn, time } = BEES.scatter;
    const bird = birds.find(o => {
      const p = o.object.position;
      return Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < radius && b.pos.y - p.y < above;
    });
    if (!bird) return;
    awayFrom(b, b.pos, bird.object.position, turn, away, b.goal);
    b.goal.y = this.height(b.goal.x, b.goal.z) + range(b, up);
    b.flower = -1;
    b.state = 'fly';
    b.scared = range(b, time);
    if (b.vel.y < 0.5) b.vel.y = 0.5;
  }

  // Next goal: sometimes another patch; the nearest free flower of a few away from birds; or a drift point.
  choose(b, birds) {
    b.state = 'fly';
    if (this.patches.length > 1 && rand(b) < BEES.hop) b.patch = (b.patch + 1 + Math.floor(rand(b) * (this.patches.length - 1))) % this.patches.length;
    const p = this.patches[b.patch], flowers = p.flowers;
    let best = -1, near = Infinity;
    if (rand(b) >= BEES.drift.chance) {
      for (let i = 0; i < BEES.pick; i++) {
        const j = Math.floor(rand(b) * flowers.length), d = flowers[j].distanceToSquared(b.pos);
        const taken = this.bees.some(o => o.patch === b.patch && o.flower === j);
        if (!taken && d < near && !shy(flowers[j], birds)) { best = j; near = d; }
      }
    }
    b.flower = best;
    if (best >= 0) { b.goal.copy(flowers[best]); return; }
    for (let i = 0; i < 3; i++) {
      const a = rand(b) * 2 * Math.PI, r = 0.7 * p.radius * Math.sqrt(rand(b)), x = p.at[0] + Math.cos(a) * r, z = p.at[1] + Math.sin(a) * r;
      b.goal.set(x, this.height(x, z) + range(b, BEES.drift.height), z);
      if (!shy(b.goal, birds)) return;
    }
    b.goal.copy(b.pos);   // all near a bird: stay
  }
}

const shy = (p, birds) => birds.some(bird => Math.hypot(bird.object.position.x - p.x, bird.object.position.z - p.z) < BEES.shy);

function beeMaterial() {
  const { size } = BEES;
  return new ShaderMaterial({
    alphaToCoverage: true,
    side: DoubleSide,   // a bee facing left is a mirrored quad: front faces only hid it
    uniforms: { uTime: { value: 0 }, uNight: LIGHT.night, uBody: { value: BODY }, uStripe: { value: STRIPE }, uWing: { value: WING } },
    vertexShader: /* glsl */`
      attribute vec4 aBee;   // xyz, w: 1 air, 0 sitting, -1 hidden
      attribute vec4 aDir;   // xyz flight, w: fade, negative faces left
      attribute float aSeed;
      varying vec2 vUv;
      varying float vAir, vSeed, vShow;
      void main() {
        // Along the flight on screen, mirrored (not turned) to go left, at most 0.6 rad up or down.
        vec2 d = (viewMatrix * vec4(aDir.xyz, 0.0)).xy;
        float flip = aDir.w < 0.0 ? -1.0 : 1.0;
        float a = clamp(atan(d.y, abs(d.x) + 1e-4), -0.6, 0.6) * flip;
        vec2 p = mat2(cos(a), sin(a), -sin(a), cos(a)) * vec2(position.x * flip, position.y);
        vec4 view = viewMatrix * vec4(aBee.xyz, 1.0);
        view.xy += p * (aBee.w < 0.0 ? 0.0 : ${f(size)});
        view.y += aBee.w < 0.5 ? ${f(0.3 * size)} : 0.0;   // sitting: on top of the head
        view.z += ${f(BEES.pull)};
        gl_Position = projectionMatrix * view;
        vUv = position.xy;
        vAir = aBee.w;
        vSeed = aSeed;
        vShow = abs(aDir.w);
      }`,
    fragmentShader: /* glsl */`
      ${INSECT}
      uniform vec3 uStripe;
      varying vec2 vUv;
      varying float vAir, vSeed, vShow;
      void main() {
        // +x is the head: two black ovals, a yellow stripe, two wings over the back.
        float abdomen = ellipse(vUv, vec2(-0.2, -0.05), vec2(0.46, 0.33));
        float head = ellipse(vUv, vec2(0.4, 0.0), vec2(0.22, 0.21));
        float body = smoothstep(0.1, -0.1, min(abdomen, head)) * vShow;   // fade: coverage
        float stripe = step(abdomen, 0.0) * (1.0 - smoothstep(0.1, 0.14, abs(vUv.x + 0.2)));
        float wing = min(ellipse(vUv, vec2(-0.12, 0.42), vec2(0.3, 0.2)), ellipse(vUv, vec2(0.08, 0.46), vec2(0.24, 0.17)));
        float w = smoothstep(0.1, -0.1, wing) * (vAir > 0.5 ? flicker(0.45, 0.25, 90.0, vSeed) : 0.55) * (vShow - body);
        if (body + w < 0.01) discard;
        gl_FragColor = insectColour(mix(uBody, uStripe, stripe), body, w);
        #include <colorspace_fragment>
      }`,
  });
}
