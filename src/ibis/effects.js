// Comic effects for ibises, in world space: dust puffs, footprints and anger lines. They read each
// ibis's character events and state, so the game only calls update().
//
//   const fx = new IbisEffects(asset);
//   scene.add(fx.object);
//   fx.update(dt, ibises, camera);   // every frame, after ibis.update(dt)
//
// Dust: behind the feet when running, on a skid, on a hard landing, and from action events with a dust
// field (the startle sit, the stumble). It is mud brown when the bird is muddy. Footprints: where each
// foot lands, in the colour of the feet (dusty, wet or muddy), fading away slowly. Anger lines: sharp
// strokes round the head while an action with anger plays (head shake, glare, threat): three short
// bars in an arc, like a comic.
import {
  BackSide, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, LessDepth,
  Matrix4, Mesh, MeshBasicMaterial, Quaternion, ShaderMaterial, Vector3,
} from 'three';
import { Spring, clamp, hash, smoothstep } from './motion/spring.js';
import { NOISE } from './materials.js';
import { toeDir, toeLength } from './rig.js';

const MAX_PUFFS = 96;
// Light warm cream dust: the warm shade and line still part it from the white feathers.
const DUST_LIT = new Color().setRGB(0.99, 0.97, 0.92, 'srgb');
const DUST_SHADE = new Color().setRGB(0.88, 0.83, 0.76, 'srgb');
const DUST_LINE = new Color().setRGB(0.70, 0.63, 0.57, 'srgb');
// Dust off muddy feet: lighter than the mud on the bird, so it still reads as dust.
const MUD_DUST_LIT = new Color().setRGB(0.68, 0.54, 0.40, 'srgb');
const MUD_DUST_SHADE = new Color().setRGB(0.50, 0.38, 0.28, 'srgb');
const MUD_DUST_LINE = new Color().setRGB(0.33, 0.24, 0.18, 'srgb');
const DUST_TIME = 0.6;   // all puffs: life times this, drift and drag faster to match, so they go as far
const INK = new Color().setRGB(0.15, 0.16, 0.22, 'srgb');

const RUN_DUST_SPEED = 1.4;   // steps make dust above this speed
const SKID_DECEL = -6;        // a speed change per second below this, at a run, is a skid
const SKID_SPEED = 1.2;
const SKID_EVERY = 0.05;      // seconds between skid puffs

// Footprints. The colour and strength come from the feet: dusty, wet or muddy. A ground material can
// replace printStyle() later, with a style for each surface.
const MAX_PRINTS = 64;        // for each foot
const PRINT_HOLD = 2.5;       // seconds at full strength
const PRINT_FADE = 3.5;       // seconds to fade away
const PRINT_DUST = [new Color().setRGB(0.80, 0.76, 0.70, 'srgb'), 0.45];
const PRINT_WET = [new Color().setRGB(0.62, 0.60, 0.63, 'srgb'), 0.6];
const PRINT_MUD = [new Color().setRGB(0.42, 0.31, 0.22, 'srgb'), 0.85];

// Anger lines: angles (radians, 0 is to the right of the head on screen) round the top of the head.
const ANGER_ANGLES = [0.65, 1.35, 2.05];
const ANGER_INNER = 0.38, ANGER_OUTER = 0.6, ANGER_WIDTH = 0.045;

// Two-band toon shading, as on the ibis, for an instanced mesh. The hull pass draws the back faces
// pushed out, in the line colour. aFade (per puff) dissolves it, as smoke does in toon games: first the
// outline thins away, then the puff breaks up in a noise pattern. The inside draws in the shade colour,
// so the holes look like broken cloud, not a hollow shell. aSeed gives each puff its own pattern.
const OUTLINE_GONE = 0.3;   // part of the dissolve in which the outline thins away

function puffMaterial(sun, hull) {
  return new ShaderMaterial({
    side: hull ? BackSide : DoubleSide,
    uniforms: {
      uSun: { value: sun }, uLit: { value: DUST_LIT }, uShade: { value: DUST_SHADE }, uLine: { value: DUST_LINE },
      uMudLit: { value: MUD_DUST_LIT }, uMudShade: { value: MUD_DUST_SHADE }, uMudLine: { value: MUD_DUST_LINE },
    },
    vertexShader: /* glsl */`
      attribute float aFade, aSeed, aMud;
      varying vec3 vNormal, vLocal;
      varying float vFade, vSeed, vMud;
      void main() {
        float push = ${hull ? `0.16 * (1.0 - clamp(aFade / ${OUTLINE_GONE}, 0.0, 1.0))` : '0.0'};
        vec3 p = position * (1.0 + push);
        vLocal = position;
        vFade = aFade;
        vSeed = aSeed;
        vMud = aMud;
        vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uLit, uShade, uLine, uMudLit, uMudShade, uMudLine;
      varying vec3 vNormal, vLocal;
      varying float vFade, vSeed, vMud;
      ${NOISE}
      void main() {
        ${hull ? `
        if (vFade >= ${OUTLINE_GONE}) discard;
        gl_FragColor = vec4(mix(uLine, uMudLine, vMud), 1.0);` : `
        float holes = (vFade - ${OUTLINE_GONE}) / (1.0 - ${OUTLINE_GONE});
        if (noise3(vLocal * 2.6 + vSeed * 17.0) < holes) discard;
        float band = gl_FrontFacing ? smoothstep(0.0, 0.05, dot(normalize(vNormal), uSun)) : 0.0;
        gl_FragColor = vec4(mix(mix(uShade, uMudShade, vMud), mix(uLit, uMudLit, vMud), band), 1.0);`}
        #include <colorspace_fragment>
      }`,
  });
}

// A footprint, flat on the ground in foot space, as wide as the foot in model.glsl: the pad, three toes
// forward and one back along the rig's toes (toeDir). Each toe tapers from the ankle to the middle and
// on to a rounded tip, with the widths of the SDF toe.
const TOE_WIDTHS = { forward: [0.058, 0.046, 0.018], back: [0.052, 0.036, 0.02] };   // half widths: base, middle, tip
const PAD_R = 0.07;

function printGeometry(side) {
  const pos = [], index = [];
  const quad = (a, b, c, d) => { const n = pos.length / 3; pos.push(...a, ...b, ...c, ...d); index.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  const disc = (cx, cz, r, k = 10) => {
    const n = pos.length / 3;
    pos.push(cx, 0, cz);
    for (let j = 0; j <= k; j++) { const a = j / k * Math.PI * 2; pos.push(cx + Math.sin(a) * r, 0, cz + Math.cos(a) * r); }
    for (let j = 1; j <= k; j++) index.push(n, n + j, n + j + 1);
  };
  for (let i = 0; i < 4; i++) {
    const dir = toeDir(side, i), len = toeLength(i);
    const [w0, w1, w2] = i === 3 ? TOE_WIDTHS.back : TOE_WIDTHS.forward;
    const across = new Vector3(dir.z, 0, -dir.x);
    const at = (t, w) => dir.clone().multiplyScalar(t).addScaledVector(across, w).toArray();
    quad(at(0, -w0), at(0, w0), at(len * 0.5, w1), at(len * 0.5, -w1));
    quad(at(len * 0.5, -w1), at(len * 0.5, w1), at(len, w2), at(len, -w2));
    const tip = dir.clone().multiplyScalar(len);
    disc(tip.x, tip.z, w2, 6);
  }
  disc(0, 0, PAD_R);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

// Prints: flat colour with a strength for each print (aPrint: rgb, alpha), blended over the ground.
// The parts of a print overlap. They write depth, so where they overlap the colour blends once, not
// twice: the ground writes no depth, and the prints sit below every part of the bird.
function printMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: true, depthFunc: LessDepth, side: DoubleSide,
    vertexShader: /* glsl */`
      attribute vec4 aPrint;
      varying vec4 vPrint;
      void main() {
        vPrint = aPrint;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec4 vPrint;
      void main() {
        gl_FragColor = vPrint;
        #include <colorspace_fragment>
      }`,
  });
}

// A comic stroke: a bar from the inner radius out, a little narrower at the outer end.
function strokeGeometry() {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, -0.5, 0, 0, 0.5, 0, 1, 0.42, 0, 1, -0.42, 0], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

export class IbisEffects {
  constructor(asset) {
    this.object = new Group();
    const geometry = new IcosahedronGeometry(1, 2);
    this.fade = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
    this.seeds = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
    this.muds = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
    this.mudNow = 0;   // mud on the feet of the ibis that makes puffs now (see spawn)
    geometry.setAttribute('aFade', this.fade);
    geometry.setAttribute('aSeed', this.seeds);
    geometry.setAttribute('aMud', this.muds);
    this.puffMesh = new InstancedMesh(geometry, puffMaterial(asset.sun, false), MAX_PUFFS);
    this.hullMesh = new InstancedMesh(geometry, puffMaterial(asset.sun, true), MAX_PUFFS);
    for (const m of [this.puffMesh, this.hullMesh]) { m.count = 0; m.frustumCulled = false; }
    this.object.add(this.hullMesh, this.puffMesh);
    this.puffs = [];   // { pos, vel, size, age, life, seed }
    this.seed = 0;
    this.stroke = strokeGeometry();
    this.ink = new MeshBasicMaterial({ color: INK, side: DoubleSide, depthTest: false });
    this.anger = new Map();   // ibis -> { group, strokes, pop }
    this.skidClock = new Map();
    // Footprints: one instanced mesh for each foot, as the left and right prints are mirrored.
    this.prints = [1, -1].map(side => {
      const geometry = printGeometry(side);
      const color = new InstancedBufferAttribute(new Float32Array(MAX_PRINTS * 4), 4);
      geometry.setAttribute('aPrint', color);
      const mesh = new InstancedMesh(geometry, printMaterial(), MAX_PRINTS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = -0.5;   // after the ground, before the birds
      this.object.add(mesh);
      return { mesh, color, list: [] };   // list: { matrix, rgb, alpha, age }
    });
    this.time = 0;
  }

  rand() { return hash(this.seed++ * 2654435761 >>> 0); }

  // A puff at a world point. dir is the drift direction on the ground (unit or zero).
  puff(pos, dir, { size = 0.1, speed = 0.6, up = 0.5, life = 0.45 } = {}) {
    if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
    const jitter = () => this.rand() - 0.5;
    const vel = new Vector3(dir.x * speed + jitter() * 0.4, up * (0.7 + 0.6 * this.rand()), dir.z * speed + jitter() * 0.4)
      .divideScalar(DUST_TIME);
    this.puffs.push({ pos: pos.clone().add(new Vector3(jitter() * 0.06, 0.02, jitter() * 0.06)), vel, size: size * (0.75 + 0.5 * this.rand()), age: 0, life: life * DUST_TIME, seed: this.rand(), mud: this.mudNow });
  }

  // A small cloud: puffs in a short row back along dir, from big to small.
  cloud(pos, dir, options, n = 2) {
    for (let i = 0; i < n; i++) {
      const side = new Vector3(-dir.z, 0, dir.x).multiplyScalar((this.rand() - 0.5) * 0.1);
      this.puff(pos.clone().addScaledVector(dir, i * 0.07).add(side), dir, { ...options, size: (options.size ?? 0.1) * (1 - 0.2 * i) });
    }
  }

  // Dust out from points on the ground, away from centre, as a heavy thing lands (a bin that falls
  // over). points: [{ at, strength }], strength about 0 to 1 (the speed of the hit there).
  burst(points, centre) {
    this.mudNow = 0;
    for (const { at, strength } of points) {
      const dir = new Vector3(at.x - centre.x, 0, at.z - centre.z).normalize();
      this.puff(at, dir, { size: 0.1 + 0.12 * strength, speed: 0.6 + 1.8 * strength, up: 0.25 + 0.2 * strength, life: 0.45 + 0.25 * strength });
    }
  }

  update(dt, ibises, camera) {
    this.time += dt;
    for (const ibis of ibises) { this.spawn(ibis, dt); this.angerLines(ibis, dt, camera); }
    this.puffs = this.puffs.filter(p => (p.age += dt) < p.life);
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3();
    this.puffs.forEach((p, i) => {
      p.vel.multiplyScalar(Math.exp(-4 / DUST_TIME * dt));
      p.vel.y -= 0.3 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const u = p.age / p.life;
      // Starts small and keeps growing (fast, then slower) while it dissolves away.
      const r = p.size * (0.25 + 1.05 * (1 - (1 - u) ** 2.5));
      this.fade.setX(i, smoothstep(0.35, 1, u));
      this.seeds.setX(i, p.seed);
      this.muds.setX(i, p.mud);
      m.compose(p.pos, q, s.set(r, 0.8 * r, r));   // a little flat: dust, not balls
      this.puffMesh.setMatrixAt(i, m);
      this.hullMesh.setMatrixAt(i, m);
    });
    for (const mesh of [this.puffMesh, this.hullMesh]) { mesh.count = this.puffs.length; mesh.instanceMatrix.needsUpdate = true; }
    this.fade.needsUpdate = this.seeds.needsUpdate = this.muds.needsUpdate = true;
    for (const p of this.prints) {
      p.list = p.list.filter(f => (f.age += dt) < PRINT_HOLD + PRINT_FADE);
      p.list.forEach((f, i) => {
        p.mesh.setMatrixAt(i, f.matrix);
        const k = 1 - smoothstep(PRINT_HOLD, PRINT_HOLD + PRINT_FADE, f.age);
        p.color.setXYZW(i, f.rgb.r, f.rgb.g, f.rgb.b, f.alpha * k);
      });
      p.mesh.count = p.list.length;
      p.mesh.instanceMatrix.needsUpdate = p.color.needsUpdate = true;
    }
  }

  spawn(ibis, dt) {
    const c = ibis.character, ctrl = c.controller, R = ibis.rig;
    if (!R) return;
    ibis.object.updateMatrixWorld();
    this.mudNow = ibis.mud;   // puffs off muddy feet are mud brown
    // Dust starts on what the feet stand on: the ground, or the top of a prop (controller.floor).
    const world = v => v.clone().setY(ctrl.floor).applyMatrix4(ibis.object.matrixWorld);
    const back = new Vector3(0, 0, -1).transformDirection(ibis.object.matrixWorld).setY(0).normalize();
    const feet = () => world(R.footL).add(world(R.footR)).multiplyScalar(0.5);
    for (const e of c.events) {
      if (e.type === 'step') this.footprint(ibis, e.foot);
      if (e.type === 'land') { this.footprint(ibis, 'L'); this.footprint(ibis, 'R'); }
      // Run: a small puff kicks up behind the heel as each foot pushes off. It stays where it was made,
      // so the puffs trail behind the bird.
      if (e.type === 'liftOff' && ctrl.speed > RUN_DUST_SPEED) {
        const heel = world(e.foot === 'L' ? R.footL : R.footR).addScaledVector(back, 0.14);
        this.cloud(heel, back, { size: 0.12 + 0.05 * (ctrl.speed - RUN_DUST_SPEED), speed: 0.35, up: 0.25, life: 0.6 }, 3);
      }
      if (e.type === 'land' && e.impact > 2.5) {
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2, dir = new Vector3(Math.sin(a), 0, Math.cos(a));
          this.puff(feet().addScaledVector(dir, 0.15), dir, { size: 0.13, speed: 1.5, up: 0.3, life: 0.5 });
        }
      }
      if (e.dust === 'rump') {
        // A big burst behind and round the bottom, as the bird sits down hard.
        const rump = world(R.pelvis).addScaledVector(back, 0.25);
        for (let i = 0; i < 12; i++) {
          const a = (i / 11 - 0.5) * 3.8;
          const dir = back.clone().applyAxisAngle(new Vector3(0, 1, 0), a);
          this.puff(rump.clone().addScaledVector(dir, 0.18), dir, { size: 0.15, speed: 2.2, up: 0.6, life: 0.7 });
        }
      }
      if (e.dust === 'feet') this.cloud(feet(), back, { size: 0.12, speed: 0.4 }, 4);
    }
    // Skid: a hard stop or reverse at speed throws dust off the feet.
    const clock = (this.skidClock.get(ibis) ?? 0) + dt;
    if (ctrl.grounded && ctrl.accel < SKID_DECEL && Math.abs(ctrl.speed) > SKID_SPEED && clock > SKID_EVERY) {
      this.skidClock.set(ibis, 0);
      this.puff(world(this.rand() < 0.5 ? R.footL : R.footR), back.clone().negate(), { size: 0.09, speed: 0.5, up: 0.3 });
    } else this.skidClock.set(ibis, clock);
  }

  // Colour and strength of a print from the state of the feet. Mud wins over wet, wet over dust.
  printStyle(ibis) {
    const rgb = PRINT_DUST[0].clone().lerp(PRINT_WET[0], ibis.wet).lerp(PRINT_MUD[0], ibis.mud);
    const alpha = Math.max(PRINT_DUST[1] + (PRINT_WET[1] - PRINT_DUST[1]) * ibis.wet, PRINT_MUD[1] * ibis.mud);
    return { rgb, alpha };
  }

  // A print where the foot is, turned as the foot is (body heading, foot turn and toe splay).
  footprint(ibis, foot) {
    if (ibis.character.position.y > 0.05) return;   // on top of a prop: prints go on the ground only
    const R = ibis.rig, side = foot === 'L' ? 1 : -1;
    const at = R['foot' + foot].clone().setY(0).applyMatrix4(ibis.object.matrixWorld).setY(0.003);
    const fwd = new Vector3(0, 0, 1).transformDirection(ibis.object.matrixWorld);
    const yaw = Math.atan2(fwd.x, fwd.z) + R['footYaw' + foot] + side * R.splay + (this.rand() - 0.5) * 0.08;
    const p = this.prints[side > 0 ? 0 : 1];
    if (p.list.length >= MAX_PRINTS) p.list.shift();
    const matrix = new Matrix4().makeRotationY(yaw).setPosition(at).scale(new Vector3().setScalar(ibis.object.scale.x));
    p.list.push({ matrix, ...this.printStyle(ibis), age: 0 });
  }

  // Bars in an arc over the head, turned to the camera. They pop in with an overshoot and quiver.
  angerLines(ibis, dt, camera) {
    let a = this.anger.get(ibis);
    if (!a) {
      const group = new Group();
      const strokes = ANGER_ANGLES.map(() => { const m = new Mesh(this.stroke, this.ink); m.renderOrder = 3; group.add(m); return m; });
      a = { group, strokes, pop: new Spring(0, 3.5, 0.45) };
      this.object.add(group);
      this.anger.set(ibis, a);
    }
    const target = ibis.character.animator.anger > 0.3 ? 1 : 0;
    const pop = dt > 0 ? a.pop.update(dt, target) : (a.pop.value = target);
    a.group.visible = pop > 0.02;
    if (!a.group.visible || !ibis.rig) return;
    const head = ibis.rig.head.clone().applyMatrix4(ibis.object.matrixWorld);
    const toCamera = camera.position.clone().sub(head).normalize();
    a.group.position.copy(head).addScaledVector(toCamera, 0.3);
    a.group.quaternion.copy(camera.quaternion);
    a.group.scale.setScalar(Math.max(pop, 0) * ibis.object.scale.x);
    a.strokes.forEach((m, i) => {
      const angle = ANGER_ANGLES[i];
      const quiver = 0.85 + 0.3 * Math.abs(Math.sin(this.time * 17 + i * 1.9));
      const inner = ANGER_INNER + 0.03 * Math.sin(this.time * 23 + i);
      m.position.set(Math.cos(angle) * inner, Math.sin(angle) * inner, 0);
      m.rotation.set(0, 0, angle);
      m.scale.set((ANGER_OUTER - ANGER_INNER) * quiver, ANGER_WIDTH * clamp(quiver, 0.9, 1.2), 1);
    });
  }
}
