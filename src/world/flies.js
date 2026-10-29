// Flies round the lid of a bin. Each fly darts from one point near the lid to the next, and sometimes
// lands on the lid for a few seconds. When a bird comes near or the bin moves, the flies scatter up and
// away, and stay away while the bird is near. After it goes, they come back one by one.
// One instanced draw of small quads that face the camera: a dark body and two pale wings that flicker.
// Only the swarms near the camera move and draw.
//
//   const flies = new Flies([{ prop: bin, count: 5 }], height);   // height(x, z): the ground
//   scene.add(flies.object);
//   flies.update(dt, ibises, camera);   // every frame, after the physics
//   flies.buzz                          // { amount, at, pitch }: the swarm the birds hear, for the sound
import { DynamicDrawUsage, InstancedBufferAttribute, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { hash } from '../ibis/motion/spring.js';
import { awayFrom, insect, INSECT, move, quads, rand, range, seek } from './insects.js';
import { LIGHT } from './lighting.js';
import { f, srgb } from './util.js';

// Distances in units (the bird is 2), times in seconds.
// lid: the points a fly goes to, round the middle of the top: horizontal distance and height above it.
// speed: flight speed. turn: how fast a fly turns to its new point (per second). next: seconds to the
// next point. jitter: a random shake of the flight, part of the speed.
// sit: the chance to land at each new point, and the seconds there. On an upright bin a fly lands on the
// lid. On a bin that is down, on the side that faces up, or on the ground beside it: ground is the
// distance out from its side. Not in front of the open end: the open lid lies there.
// scare: a bird nearer than radius (horizontal, to the middle of the top) or a bin that moves faster
// than bump scatters the flies. away and up: where each fly goes, from the top. back: seconds of calm
// before each fly comes back.
// far: no update or draw past this distance from the camera. size: half the quad (the body is about 0.4 of it).
// buzz: each fly in the air buzzes, full when it is nearer than near to the head of a bird, and off past far.
export const FLIES = {
  lid: { radius: [0.2, 0.85], height: [0.08, 0.75] },
  speed: 2.4, turn: 9, next: [0.2, 0.8], jitter: 1.2,
  sit: { chance: 0.2, time: [1, 4], ground: [0.15, 0.6] },
  scare: { radius: 2.6, bump: 0.4, away: [2.5, 4], up: [0.8, 2.2], speed: 5.5, back: [1.5, 5] },
  far: 30,
  size: 0.13,   // a cartoon fly, about five times the true size: smaller flies read as dust
  buzz: { near: 1, far: 6 },
};
const BODY = srgb(0.07, 0.07, 0.09);
const WING = srgb(0.72, 0.75, 0.82);
const LIFT = 0.5 * FLIES.size;   // a fly that sits is this far above the surface, so the surface does not cut its body
const HEAD = 1.5;                 // the height of a bird's head, for the buzz
const at = new Vector3(), up = new Vector3(), turn = new Quaternion(), back = new Quaternion(), want = new Vector3(), side = new Vector3(), local = new Vector3();   // scratch

export class Flies {
  // hosts: [{ prop, count }], each prop a Tub (props.js). height(x, z): the ground.
  constructor(hosts, height) {
    this.height = height;
    let seed = 0;
    this.swarms = hosts.map(({ prop, count }) => ({
      prop, top: new Vector3(), from: new Vector3(), calm: Infinity, on: false,
      flies: Array.from({ length: count }, () => fly(++seed)),
    }));
    const count = this.swarms.reduce((n, s) => n + s.flies.length, 0);
    const g = quads(count);
    this.at = new InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(DynamicDrawUsage);
    g.setAttribute('aFly', this.at);
    g.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(count).map((_, i) => hash(i * 31 + 7)), 1));
    this.material = flyMaterial();
    this.object = new Mesh(g, this.material);
    this.object.frustumCulled = false;
    this.buzz = { amount: 0, at: new Vector3(), pitch: 1 };
    for (const s of this.swarms) {
      this.top(s);
      for (const fl of s.flies) outside(s, fl.pos.copy(s.top).add(around(fl)));
    }
  }

  update(dt, birds, camera) {
    this.material.uniforms.uTime.value += dt;
    const a = this.at.array, { scare, buzz } = FLIES;
    let k = 0, loud = 0;
    for (const s of this.swarms) {
      s.on = this.top(s).distanceTo(camera.position) < FLIES.far;
      if (!s.on) {
        for (let i = 0; i < s.flies.length; i++, k++) a[4 * k + 3] = -1;
        continue;
      }
      // Scare: a bird near the top, or the bin moves (a push, a fall).
      const body = s.prop.physics.body(s.prop.id), mp = body.motionProperties;
      for (const bird of birds) {
        const p = bird.object.position;
        if (Math.hypot(p.x - s.top.x, p.z - s.top.z) < scare.radius) { s.calm = 0; s.from.copy(p); }
      }
      if (Math.hypot(...mp.linearVelocity) > scare.bump || Math.hypot(...mp.angularVelocity) > scare.bump) { s.calm = 0; s.from.copy(s.top); }
      else if (s.calm < Infinity) s.calm += dt;
      // The buzz: each fly in the air, louder near the head of a bird. Flies that scatter are far away,
      // so the buzz drops when a bird stays near.
      let amount = 0, fleeing = 0;
      for (const fl of s.flies) {
        this.step(s, fl, dt);
        fl.pos.toArray(a, 4 * k);
        a[4 * k++ + 3] = fl.state === 'sit' ? 0 : 1;
        if (fl.state === 'flee') fleeing++;
        if (fl.state === 'sit') continue;
        let d = Infinity;
        for (const bird of birds) { const p = bird.object.position; d = Math.min(d, Math.hypot(fl.pos.x - p.x, fl.pos.y - p.y - HEAD, fl.pos.z - p.z)); }
        amount += Math.min(Math.max((buzz.far - d) / (buzz.far - buzz.near), 0), 1) / s.flies.length;
      }
      if (amount > loud) {
        loud = amount;
        this.buzz.at.copy(s.top);
        this.buzz.pitch = 1 + 0.1 * fleeing / s.flies.length;
      }
    }
    this.buzz.amount = loud;
    this.at.needsUpdate = true;
  }

  // The middle of the top of the bin, world: on its side, the open end.
  top(s) {
    const body = s.prop.physics.body(s.prop.id);
    turn.fromArray(body.quaternion);
    back.copy(turn).invert();
    return s.top.set(0, s.prop.half[1] + s.prop.cap, 0).applyQuaternion(turn).add(at.fromArray(body.position));
  }

  // One fly: a new point when it gets there or its time runs out, then a turn toward the point.
  step(s, fl, dt) {
    const { scare, sit } = FLIES;
    const scared = s.calm < fl.back;
    if (scared && fl.state !== 'flee') { fl.state = 'flee'; fl.timer = 0; }
    if (!scared && fl.state === 'flee') { fl.state = 'fly'; fl.timer = 0; }
    fl.timer -= dt;
    if (fl.state === 'sit') {
      // On the bin it moves with the bin, and takes off when its time runs out or its side turns away from up.
      spotAt(fl, fl.pos);
      if (fl.timer > 0 && (!fl.face || side.copy(fl.face).applyQuaternion(turn).y > 0.8)) return;
      fl.state = 'fly';
      fl.timer = 0;
      fl.vel.set(0, 1, 0);
    }
    if (fl.state === 'land' && fl.pos.distanceToSquared(spotAt(fl, fl.goal)) < 0.03 * 0.03) {
      fl.state = 'sit';
      fl.timer = range(fl, sit.time);
      return;
    }
    if (fl.timer <= 0 && fl.state !== 'land') {
      fl.timer = range(fl, FLIES.next);
      if (fl.state === 'flee') {
        // Away from the bird (or from the bin when it moves), a little to one side, and up.
        awayFrom(fl, s.top, s.from, 0.8, scare.away, fl.goal).y = s.top.y + range(fl, scare.up);
        outside(s, fl.goal);
      } else if (rand(fl) < sit.chance && this.spot(s, fl)) {
        fl.state = 'land';
        fl.timer = 3;   // a land that takes longer gives up
      } else outside(s, fl.goal.copy(s.top).add(around(fl)));
    }
    if (fl.state === 'land') {
      spotAt(fl, fl.goal);
      if (fl.timer <= 0) { fl.state = 'fly'; fl.timer = 0; }
    }
    // Turn toward the point, slower as it comes near, with a small random shake.
    const speed = seek(fl, fl.goal, fl.state === 'flee' ? scare.speed : FLIES.speed, 0.3, want);
    want.x += FLIES.jitter * speed * (rand(fl) - 0.5);
    want.y += FLIES.jitter * speed * (rand(fl) - 0.5);
    want.z += FLIES.jitter * speed * (rand(fl) - 0.5);
    move(fl, want, FLIES.turn, dt);
    outside(s, fl.pos, fl.vel);
    fl.pos.y = Math.max(fl.pos.y, this.height(fl.pos.x, fl.pos.z) + LIFT);
  }

  // A place to land: fl.spot, and fl.face, the side of the bin it is on (bin space), or null on the
  // ground. False when there is none: the lid of an upright bin is open.
  spot(s, fl) {
    // The side of the bin that faces up: the axis of the bin's space nearest to world up.
    side.set(0, 1, 0).applyQuaternion(back);
    const i = [0, 1, 2].reduce((m, j) => (Math.abs(side.getComponent(j)) > Math.abs(side.getComponent(m)) ? j : m), 0);
    const sign = Math.sign(side.getComponent(i)), half = s.prop.half;
    if (i === 1 && sign > 0 && !s.prop.perch()) return false;
    if (i === 1 && sign > 0 || rand(fl) < 0.5) {
      // On that side, in the bin's space: the lid is cap above the top of the tub.
      fl.face = new Vector3().setComponent(i, sign);
      for (let j = 0; j < 3; j++) fl.spot.setComponent(j, half[j] * 0.7 * (2 * rand(fl) - 1));
      fl.spot.setComponent(i, sign * (half[i] + (i === 1 && sign > 0 ? s.prop.cap : 0) + LIFT));
      return true;
    }
    // On the ground beside the bin, world: along its length (its y, flat), out past its widest half.
    side.set(0, 1, 0).applyQuaternion(turn).setY(0).normalize();
    const along = half[1] * 0.7 * (2 * rand(fl) - 1), out = (rand(fl) < 0.5 ? -1 : 1) * (Math.max(half[0], half[2]) + range(fl, FLIES.sit.ground));
    fl.face = null;
    fl.spot.set(at.x + side.x * along - side.z * out, 0, at.z + side.z * along + side.x * out);
    fl.spot.y = this.height(fl.spot.x, fl.spot.z) + LIFT;
    return true;
  }
}

// Keeps a world point p out of the bin (the box of the tub and the lid), by a little less than LIFT, so a
// fly that sits on it stays put. A point inside goes out through the nearest side. vel: the fly's
// velocity, which loses its part into that side, so the fly slides round the bin. Uses turn, back and at
// from top().
function outside(s, p, vel = null) {
  const m = 0.8 * LIFT, [hx, hy, hz] = s.prop.half;
  const lo = [-hx - m, -hy - m, -hz - m], hi = [hx + m, hy + s.prop.cap + m, hz + m];
  local.copy(p).sub(at).applyQuaternion(back);
  let axis = -1, sign = 0, depth = Infinity;
  for (let i = 0; i < 3; i++) {
    const v = local.getComponent(i), a = v - lo[i], b = hi[i] - v;
    if (a <= 0 || b <= 0) return p;
    if (a < depth) { depth = a; axis = i; sign = -1; }
    if (b < depth) { depth = b; axis = i; sign = 1; }
  }
  local.setComponent(axis, sign > 0 ? hi[axis] : lo[axis]);
  p.copy(local).applyQuaternion(turn).add(at);
  if (vel) {
    local.copy(vel).applyQuaternion(back);
    if (local.getComponent(axis) * sign < 0) vel.copy(local.setComponent(axis, 0)).applyQuaternion(turn);
  }
  return p;
}

// The world place of a fly's spot, in out: on the bin it moves with the bin (turn and at from top()).
function spotAt(fl, out) {
  return fl.face ? out.copy(fl.spot).applyQuaternion(turn).add(at) : out.copy(fl.spot);
}

function fly(seed) {
  const fl = insect(seed, { spot: new Vector3(), face: null });
  fl.back = range(fl, FLIES.scare.back);
  return fl;
}

// A point round the middle of the top, from it.
function around(fl) {
  const { radius, height } = FLIES.lid, angle = rand(fl) * 2 * Math.PI, r = range(fl, radius);
  return up.set(Math.cos(angle) * r, range(fl, height), Math.sin(angle) * r);
}

function flyMaterial() {
  return new ShaderMaterial({
    alphaToCoverage: true,   // soft wings with the multisampled target in grade.js, no sorting
    uniforms: { uTime: { value: 0 }, uNight: LIGHT.night, uBody: { value: BODY }, uWing: { value: WING } },
    vertexShader: /* glsl */`
      attribute vec4 aFly;   // xyz world, w: 1 in the air, 0 sitting, -1 hidden
      attribute float aSeed;
      varying vec2 vUv;
      varying float vAir, vSeed;
      void main() {
        vec4 view = viewMatrix * vec4(aFly.xyz, 1.0);
        view.xy += position.xy * (aFly.w < 0.0 ? 0.0 : ${f(FLIES.size)});
        gl_Position = projectionMatrix * view;
        vUv = position.xy;
        vAir = aFly.w;
        vSeed = aSeed;
      }`,
    fragmentShader: /* glsl */`
      ${INSECT}
      varying vec2 vUv;
      varying float vAir, vSeed;
      void main() {
        float body = ellipse(vUv, vec2(0.0), vec2(0.36, 0.42));
        // Wings in the air: up and out to each side, and they flicker. A fly that sits shows only its body:
        // folded wings below it looked like a shadow.
        float wing = ellipse(vec2(abs(vUv.x), vUv.y), vec2(0.5, 0.3), vec2(0.5, 0.3));
        float a = smoothstep(0.1, -0.1, body);
        float w = vAir > 0.5 ? smoothstep(0.1, -0.1, wing) * flicker(0.4, 0.3, 95.0, vSeed) * (1.0 - a) : 0.0;
        if (a + w < 0.01) discard;
        gl_FragColor = insectColour(uBody, a, w);
        #include <colorspace_fragment>
      }`,
  });
}
