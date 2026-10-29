// Street lamps: a steel pole that curves over into an arm, a round head over the gutter. At night each
// near lamp fills a slot of LIGHT (lighting.js): a pool of light with a shadow from one atlas tile.
//
//   const lamps = new Lamps(asset, physics, [{ at: [x, z], reach: -1 }], { ground });   // reach: arm direction along z
//   lamps.update(camera);                  // every frame
//   lamps.renderShadows(renderer, scene);  // before the frame
//
// Cost: poles, arms and heads are one toon draw and one outline; lenses, halos and beams one draw each.
// One shadow tile a frame: the nearest lamp on even frames, the others in turn on odd ones.
import {
  AdditiveBlending, BufferGeometry, CatmullRomCurve3, CylinderGeometry, DepthTexture, Float32BufferAttribute,
  Group, Mesh, MeshDepthMaterial, PerspectiveCamera, ShaderMaterial, SphereGeometry, TubeGeometry, Vector3,
  WebGLRenderTarget,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash } from '../ibis/motion/spring.js';
import { LIGHT, MAX_LAMPS } from './lighting.js';
import { toonParts } from './props.js';
import { f, srgb } from './util.js';

// Units (1 is about 35 cm): 13 tall (4.5 m). head, lens: half sizes along the arm, up, across.
// pool: radius on the ground of the light and of its bright middle. on: LIGHT.power range where they come on.
export const LAMP = {
  pole: [10.4, 0.2, 0.12], base: [0.9, 0.25],
  arm: { radius: 0.11, points: [[0, 0], [0, 1.1], [0.35, 1.85], [1.2, 2.3], [2.4, 2.45], [3.0, 2.4]] },
  head: [0.9, 0.4, 0.46], tilt: 0.12,
  lens: [0.68, 0.2, 0.36],
  pool: [10, 6.5],
  tile: 1024,       // shadow atlas tile, pixels (2 by 2 tiles)
  near: 60,         // lamps farther from the camera get no slot
  solid: 0.32,
  on: [0.1, 0.6], warm: 0.3,
};
export const CASTER_LAYER = 6;   // meshes with castShadow, for the lamp shadows
const COLOURS = {
  steel: [srgb(0.80, 0.82, 0.82), srgb(0.55, 0.56, 0.68), srgb(0.27, 0.27, 0.34)],
  head: [srgb(0.86, 0.87, 0.86), srgb(0.60, 0.61, 0.72), srgb(0.27, 0.27, 0.34)],
};
const GLASS = srgb(0.80, 0.84, 0.88);
const GLOW = srgb(1.0, 0.93, 0.74);
const HALO = { size: 2.6, strength: 0.55 };
const BEAM = { strength: 0.07 };

export class Lamps {
  constructor(asset, physics = null, list = [], { ground, tile = LAMP.tile }) {
    this.object = new Group();
    this.lamps = list.map(({ at: [x, z], reach }, i) => {
      const foot = new Vector3(x, ground.height(x, z), z);
      const { head, lens } = headAt(foot, reach);
      if (physics) {
        const r = LAMP.solid, h = LAMP.pole[0];
        physics.addTerrain(Array.from({ length: 8 }, (_, k) => k / 8 * Math.PI * 2)
          .flatMap(a => [0, h].flatMap(y => [x + Math.cos(a) * r, foot.y + y, z + Math.sin(a) * r])));
      }
      const start = LAMP.on[0] + (LAMP.on[1] - LAMP.on[0] - LAMP.warm) * hash(31 + i);   // each comes on in turn
      return { foot, head, lens, start, on: 0, slot: -1 };
    });
    this.slots = Array.from({ length: MAX_LAMPS }, () => ({ lamp: null, fresh: false }));
    this.next = this.frame = 0;
    if (!this.lamps.length) return;

    const h = this.lamps[0].lens.y - this.lamps[0].foot.y, angle = Math.atan(LAMP.pool[0] / h);
    LIGHT.lampCone.value.set(Math.cos(angle), Math.cos(Math.atan(LAMP.pool[1] / h)));
    this.camera = new PerspectiveCamera(2 * angle * 180 / Math.PI + 4, 1, 0.3, h + 1.5);
    this.camera.up.set(0, 0, 1);
    this.camera.layers.set(CASTER_LAYER);
    const size = 2 * tile;
    this.atlas = new WebGLRenderTarget(size, size, { depthTexture: new DepthTexture(size, size) });
    this.atlas.scissorTest = true;
    this.tile = tile;
    this.depth = new MeshDepthMaterial();
    LIGHT.lampShadow.value = this.atlas.depthTexture;

    this.object.add(...toonParts(this.lamps.flatMap(({ foot, head }, i) => parts(foot, head, list[i].reach)), asset.uniforms));
    this.on = { value: new Float32Array(this.lamps.length) };
    const n = this.lamps.length;
    const lenses = new Mesh(indexed(this.lamps.map(({ lens }, i) => lensGeometry(lens, list[i].reach))), lensMaterial(n, this.on));
    const halos = new Mesh(haloGeometry(this.lamps.map(l => l.lens)), haloMaterial(n, this.on));
    const beams = new Mesh(indexed(this.lamps.map(({ lens, foot }) => beamGeometry(lens, foot))), beamMaterial(n, this.on));
    halos.renderOrder = beams.renderOrder = 3;   // after the sky
    for (const m of [lenses, halos, beams]) m.frustumCulled = false;
    this.object.add(lenses, halos, beams);
  }

  // Lamps on, and the nearest lit ones in the slots.
  update(camera) {
    const power = LIGHT.power.value, eye = camera.position;
    this.lamps.forEach((lamp, i) => {
      const t = Math.min(Math.max((power - lamp.start) / LAMP.warm, 0), 1);
      lamp.on = t * t * (3 - 2 * t);
      lamp.far = Math.hypot(lamp.foot.x - eye.x, lamp.foot.z - eye.z);
      this.on.value[i] = lamp.on;
    });
    const want = this.lamps.filter(l => l.on > 0 && l.far < LAMP.near).sort((a, b) => a.far - b.far).slice(0, MAX_LAMPS);
    for (const s of this.slots) if (s.lamp && !want.includes(s.lamp)) { s.lamp.slot = -1; s.lamp = null; }
    for (const lamp of want) {
      if (lamp.slot >= 0) continue;
      const i = this.slots.findIndex(s => !s.lamp);
      Object.assign(this.slots[i], { lamp, fresh: false });
      lamp.slot = i;
    }
    this.slots.forEach((s, i) => {
      const v = LIGHT.lamps.value[i];
      if (s.lamp && s.fresh) v.set(s.lamp.lens.x, s.lamp.lens.y, s.lamp.lens.z, s.lamp.on);
      else v.w = 0;
    });
    this.nearest = want[0] ?? null;
  }

  // New slots now, then one tile a frame.
  renderShadows(renderer, scene) {
    const used = this.slots.filter(s => s.lamp);
    if (!used.length) return;
    let todo = used.filter(s => !s.fresh);
    if (todo.length) scene.traverse(o => { if (o.isMesh && o.castShadow) o.layers.enable(CASTER_LAYER); });
    else {
      const near = used.find(s => s.lamp === this.nearest), others = used.filter(s => s !== near);
      todo = [this.frame++ % 2 === 0 || !others.length ? near : others[this.next++ % others.length]];
    }
    const saved = { target: renderer.getRenderTarget(), override: scene.overrideMaterial, auto: renderer.shadowMap.autoUpdate, background: scene.background };
    Object.assign(scene, { overrideMaterial: this.depth, background: null });
    renderer.shadowMap.autoUpdate = false;
    for (const s of todo) this.renderTile(renderer, scene, s);
    Object.assign(scene, { overrideMaterial: saved.override, background: saved.background });
    renderer.shadowMap.autoUpdate = saved.auto;
    renderer.setRenderTarget(saved.target);
    for (const s of todo) {
      const { lens, on } = s.lamp;
      LIGHT.lamps.value[this.slots.indexOf(s)].set(lens.x, lens.y, lens.z, on);
    }
  }

  renderTile(renderer, scene, slot) {
    const i = this.slots.indexOf(slot), t = this.tile, x = (i % 2) * t, y = Math.floor(i / 2) * t;
    const { lens, foot } = slot.lamp, cam = this.camera;
    cam.position.copy(lens).y -= 0.1;
    cam.lookAt(lens.x, foot.y, lens.z);
    cam.updateMatrixWorld();
    this.atlas.viewport.set(x, y, t, t);
    this.atlas.scissor.set(x, y, t, t);
    renderer.setRenderTarget(this.atlas);
    renderer.clear();
    renderer.render(scene, cam);
    // World to the tile: x, y in the tile's quarter of [0, 1], depth in [0, 1].
    LIGHT.lampMatrix.value[i].set(0.25, 0, 0, 0.25 + (i % 2) * 0.5, 0, 0.25, 0, 0.25 + Math.floor(i / 2) * 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    slot.fresh = true;
  }
}

function headAt(foot, reach) {
  const [ax, ay] = LAMP.arm.points.at(-1);
  const head = foot.clone().add(new Vector3(0, LAMP.pole[0] + ay - 0.05, (ax + LAMP.head[0] * 0.55) * reach));
  const lens = head.clone();
  lens.y -= LAMP.head[1] + LAMP.lens[1] * 0.5;   // half the bowl below the bulb
  return { head, lens };
}

function parts(foot, head, reach) {
  const [h, r0, r1] = LAMP.pole, [bh, br] = LAMP.base, [hx, hy, hz] = LAMP.head;
  const pole = new CylinderGeometry(r1, r0, h, 12, 1, true).translate(foot.x, foot.y + h / 2, foot.z);
  const base = new CylinderGeometry(br * 0.9, br, bh, 12).translate(foot.x, foot.y + bh / 2, foot.z);
  const curve = new CatmullRomCurve3(LAMP.arm.points.map(([out, up]) => new Vector3(foot.x, foot.y + h + up, foot.z + out * reach)));
  const arm = new TubeGeometry(curve, 28, LAMP.arm.radius, 10, false);
  const cap = new SphereGeometry(r1 * 1.05, 12, 6).translate(foot.x, foot.y + h, foot.z);
  const bulb = new SphereGeometry(1, 24, 14).scale(hz, hy, hx).rotateX(-LAMP.tilt * reach).translate(head.x, head.y, head.z);
  return [[pole, COLOURS.steel], [base, COLOURS.steel], [arm, COLOURS.steel], [cap, COLOURS.steel], [bulb, COLOURS.head]];
}

function lensGeometry(lens, reach) {
  const [lx, ly, lz] = LAMP.lens;
  return new SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(lz, ly, lx)
    .rotateX(-LAMP.tilt * reach).translate(lens.x, lens.y + ly, lens.z);
}

function beamGeometry(lens, foot) {
  const h = lens.y - foot.y;
  return new CylinderGeometry(LAMP.lens[0] * 0.5, LAMP.pool[1] * 0.75, h, 32, 1, true).translate(lens.x, foot.y + h / 2, lens.z);
}

// One geometry, with aLamp: the index of each part.
function indexed(list) {
  return mergeGeometries(list.map((g, i) => {
    const out = g.index ? g.toNonIndexed() : g, keep = new BufferGeometry();
    for (const a of ['position', 'normal', 'uv']) keep.setAttribute(a, out.attributes[a]);
    keep.setAttribute('aLamp', new Float32BufferAttribute(new Float32Array(out.attributes.position.count).fill(i), 1));
    return keep;
  }));
}

// A quad for each lamp, turned to the camera in the shader.
function haloGeometry(centres) {
  const pos = [], centre = [], lamp = [], index = [];
  centres.forEach((c, i) => {
    const n = pos.length / 3;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(x, y, 0); centre.push(c.x, c.y, c.z); lamp.push(i); }
    index.push(n, n + 1, n + 2, n, n + 2, n + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aCentre', new Float32BufferAttribute(centre, 3));
  g.setAttribute('aLamp', new Float32BufferAttribute(lamp, 1));
  g.setIndex(index);
  return g;
}

const ON = n => /* glsl */`
  uniform float uOn[${n}];
  attribute float aLamp;
  float lampOn() { return uOn[int(aLamp + 0.5)]; }
`;

// Unlit: frosted by day, warm glow at night.
function lensMaterial(n, on) {
  return new ShaderMaterial({
    uniforms: { uOn: on, uGlass: { value: GLASS }, uGlow: { value: GLOW } },
    vertexShader: /* glsl */`
      ${ON(n)}
      varying float vOn, vUp;
      void main() {
        vOn = lampOn();
        vUp = normal.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uGlass, uGlow;
      varying float vOn, vUp;
      void main() {
        gl_FragColor = vec4(mix(uGlass * mix(0.78, 1.0, step(-0.6, vUp)), uGlow, vOn), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

const ADDITIVE = { transparent: true, depthWrite: false, blending: AdditiveBlending };

function haloMaterial(n, on) {
  return new ShaderMaterial({
    ...ADDITIVE,
    uniforms: { uOn: on, uGlow: { value: GLOW } },
    vertexShader: /* glsl */`
      ${ON(n)}
      attribute vec3 aCentre;
      varying vec2 vUv;
      varying float vOn;
      void main() {
        vOn = lampOn();
        vUv = position.xy;
        vec4 view = viewMatrix * vec4(aCentre, 1.0);
        view.xy += position.xy * ${f(HALO.size)};
        view.z += 1.2;   // in front of the head
        gl_Position = vOn > 0.0 ? projectionMatrix * view : vec4(0.0);   // off: no pixels
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uGlow;
      varying vec2 vUv;
      varying float vOn;
      void main() {
        float r = length(vUv);
        float a = (1.0 - smoothstep(0.0, 1.0, r)) * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.35, r)));
        gl_FragColor = vec4(uGlow * a * vOn * ${f(HALO.strength)}, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Faint cone: bright at the top and facing the camera.
function beamMaterial(n, on) {
  return new ShaderMaterial({
    ...ADDITIVE,
    uniforms: { uOn: on, uGlow: { value: GLOW } },
    vertexShader: /* glsl */`
      ${ON(n)}
      varying float vOn, vUp;
      varying vec3 vNormal, vWorld;
      void main() {
        vOn = lampOn();
        vUp = uv.y;
        vNormal = normal;
        vWorld = position;
        gl_Position = vOn > 0.0 ? projectionMatrix * viewMatrix * vec4(position, 1.0) : vec4(0.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uGlow;
      varying float vOn, vUp;
      varying vec3 vNormal, vWorld;
      void main() {
        float face = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
        gl_FragColor = vec4(uGlow * face * face * smoothstep(0.0, 0.9, vUp) * vOn * ${f(BEAM.strength)}, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
