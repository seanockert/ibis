// Empty beer stubbies (short golden amber glass bottles, no caps) set up as bowling pins: ten in a triangle,
// head pin toward +z. Light props, as the ball: the feet, the head and the ball knock them down, and
// they knock each other. A bottle that falls hard clinks (Slam, kind 'glass').
//
// Four instanced draws for all the bottles: the label (opaque, a colour on each vertex: toonMaterial
// tones), the glass inside (back faces, darker), the glass outside (front faces), and the outline.
// The glass is see-through, more at the middle and less at the edges, with a toon highlight. It writes
// GLASS.stencil where it draws, and the outline draws only outside that, so the outline round the back
// of a bottle doesn't show through its glass. The glass draws after everything opaque (transparent),
// and the ibis reads its stencil values before then, so they don't mix.
//
//   const pins = new Stubbies(physics, asset, [x, z], { ground: streetHeight(z) });
//   scene.add(pins.object);
//   pins.update();   // every frame, after physics.step(dt)
import {
  AlwaysStencilFunc, BackSide, Color, Float32BufferAttribute, FrontSide, InstancedMesh, LatheGeometry, Matrix4, NotEqualStencilFunc,
  Quaternion, ReplaceStencilOp, ShaderMaterial, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lightUniforms, TOON, TOON_VERTEX } from '../ibis/materials.js';
import { MODEL, outlineMaterial, Slam, smoothNormals, toonMaterial } from './props.js';

const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');
// lit, shade (line for the glass). The shades lean cool, as the other props.
// Golden amber glass and a plain yellow label and neck collar, after a classic Australian stubby.
const COLOURS = {
  glass: [srgb(0.91, 0.58, 0.17), srgb(0.58, 0.31, 0.21), srgb(0.24, 0.10, 0.05)],
  label: [srgb(0.99, 0.82, 0.16), srgb(0.76, 0.55, 0.32)],
};
// See-through glass. alpha: at the middle, and at the edges (seen side on). back: the colour of the
// inside, the far wall. gloss: N.H size of the highlight. stencil: above the ibis's values (1 to 5).
// glow: the middle of the glass, where it faces the eye, lights up a little, as light through it.
const GLASS = { alpha: [0.4, 0.9], back: 0.6, gloss: 0.955, glow: 0.3, stencil: 8 };

// About 1 tall, half the bird. mass in kg. spacing: between pins in a row.
export const STUBBY = {
  height: 1.0, radius: 0.2, mass: 1.0, friction: 0.4, restitution: 0.25, damping: 0.1,
  rows: 4, spacing: 0.84,
  slam: { spin: 3.0, keep: 0.5, tilt: 1.0, fast: 0.6, strong: 4, low: 0.2 },
};

// Glass outline [radius, height] from the bottom, in units of the radius and the height: a straight
// body, a round shoulder, a short neck, a lip and the open mouth (the lip turns in and down a little,
// the thickness of the glass).
const PROFILE = [[0, 0], [0.9, 0], [1, 0.03], [1, 0.58], [0.96, 0.63], [0.86, 0.68], [0.7, 0.72], [0.54, 0.76], [0.45, 0.8], [0.42, 0.85], [0.42, 0.92], [0.46, 0.94], [0.46, 0.96], [0.37, 0.96], [0.35, 0.91]];
const HULL = PROFILE.slice(0, 13);   // the solid: the mouth closed
// Label bands: [from, to] (units of the height), colour, and how far out of the glass (no flicker).
const BANDS = [[[0.16, 0.48], 'label', 1.015], [[0.79, 0.89], 'label', 1.03]];   // body, neck

export class Stubbies {
  constructor(physics, asset, [x, z], { heading = 0, ground = 0 } = {}) {
    const { height: H, radius: r, rows, spacing } = STUBBY;
    this.physics = physics;
    this.events = [];
    // Pins in rows away from the head pin, turned by heading.
    const cs = Math.cos(heading), sn = Math.sin(heading), spots = [];
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i <= row; i++) spots.push([(i - row / 2) * spacing, -row * spacing * Math.sqrt(3) / 2]);
    }
    // Physics hull round the glass, centred on the middle of the bottle.
    const hull = HULL.filter(([pr]) => pr > 0).flatMap(([pr, py]) =>
      Array.from({ length: 10 }, (_, k) => [pr * r * Math.cos(k * Math.PI / 5), (py - 0.5) * H, pr * r * Math.sin(k * Math.PI / 5)]).flat());
    this.bottles = spots.map(([lx, lz]) => {
      const id = physics.addHull(hull, {
        position: [x + lx * cs + lz * sn, ground + H / 2, z - lx * sn + lz * cs], light: true,
        mass: STUBBY.mass, friction: STUBBY.friction, restitution: STUBBY.restitution, damping: STUBBY.damping,
      });
      return { id, slam: new Slam('glass', [r, H / 2, r], STUBBY.slam) };
    });

    const glass = lathe(PROFILE, 0, 1, 1);
    const n = this.bottles.length, instanced = (geometry, material) => new InstancedMesh(geometry, material, n);
    const label = instanced(mergeGeometries(BANDS.map(([[a, b], colour, grow]) => tone(lathe(PROFILE, a, b, grow), COLOURS[colour]))),
      toonMaterial(COLOURS.label[0], COLOURS.label[1], asset.uniforms, { tones: true }));
    label.castShadow = label.receiveShadow = true;
    const inside = instanced(glass, glassMaterial(asset.uniforms, BackSide));
    const outside = instanced(glass, glassMaterial(asset.uniforms, FrontSide));
    outside.castShadow = true;   // a solid shadow: it reads better than a tinted one
    glass.setAttribute('_outline', smoothNormals(glass));
    const line = instanced(glass, Object.assign(outlineMaterial(COLOURS.glass[2], asset.uniforms), {
      transparent: true, stencilWrite: true, stencilRef: GLASS.stencil, stencilFunc: NotEqualStencilFunc,
    }));
    // Transparent: inside, then outside, then the outline.
    [inside, outside, line].forEach((mesh, i) => { mesh.renderOrder = 2 + i; });
    this.meshes = [label, inside, outside, line];
    for (const mesh of this.meshes) mesh.frustumCulled = false;   // the bottles spread out as they fall
    this.object = label;
    label.add(inside, outside, line);
    this.matrix = new Matrix4();
    this.update();
  }

  update() {
    this.events = [];
    const q = new Quaternion(), p = new Vector3(), one = new Vector3(1, 1, 1);
    this.bottles.forEach((b, i) => {
      const body = this.physics.body(b.id);
      this.matrix.compose(p.fromArray(body.position), q.fromArray(body.quaternion), one);
      for (const mesh of this.meshes) mesh.setMatrixAt(i, this.matrix);
      this.events.push(...b.slam.update(body));
    });
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

// See-through toon glass. side: BackSide for the inside (darker), FrontSide for the outside. Both write
// GLASS.stencil where they draw, for the outline.
function glassMaterial(shared, side) {
  const [lit, shade] = COLOURS.glass;
  const f = v => v.toFixed(3);
  return new ShaderMaterial({
    lights: true, transparent: true, depthWrite: false, side,
    stencilWrite: true, stencilRef: GLASS.stencil, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp,
    uniforms: { ...lightUniforms(), uSun: shared.uSun, uLit: { value: lit }, uShade: { value: shade } },
    vertexShader: /* glsl */`
      ${TOON_VERTEX}
      ${MODEL}
      varying vec3 vNormal, vWorld;
      void main() {
        mat4 m = model();
        vec4 world = m * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
        toonShadowCoord(world, vNormal);
      }`,
    fragmentShader: /* glsl */`
      ${TOON}
      uniform vec3 uSun, uLit, uShade;
      varying vec3 vNormal, vWorld;
      void main() {
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 v = normalize(cameraPosition - vWorld);
        float band = toonBand(n, uSun);
        vec3 col = mix(uShade, uLit, band);
        // Clear at the middle, thick at the edges, where the eye looks through more glass.
        float edge = 1.0 - abs(dot(n, v));
        float alpha = mix(${f(GLASS.alpha[0])}, ${f(GLASS.alpha[1])}, edge * edge);
        ${side === BackSide ? `col *= ${f(GLASS.back)};` : `
        float facing = 1.0 - edge;
        col = mix(col, min(uLit * 1.2, vec3(1.0)), ${f(GLASS.glow)} * facing * facing);
        float gloss = toonGloss(n, v, uSun, ${f(GLASS.gloss)}) * band;
        col = mix(col, vec3(1.0, 0.96, 0.88), gloss);
        alpha = max(alpha, gloss);`}
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

// Part of the glass outline from height a to b (units of the height), scaled out by grow, all round.
// Centred on the middle of the bottle, as the hull.
function lathe(profile, a, b, grow) {
  const { height: H, radius: r } = STUBBY;
  const at = y => {   // the outline radius at height y, straight between the points
    for (let i = 1; i < profile.length; i++) {
      const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
      if (y <= y1 && y1 > y0) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
    }
    return profile[profile.length - 1][0];
  };
  const points = a === 0 && b === 1
    ? profile.map(([pr, py]) => new Vector2(pr * r * grow, (py - 0.5) * H))
    : Array.from({ length: 6 }, (_, k) => { const y = a + (b - a) * k / 5; return new Vector2(at(y) * r * grow, (y - 0.5) * H); });
  return new LatheGeometry(points, 24);
}

// Lit and shade colours on every vertex, for one draw of many colours.
function tone(geometry, [lit, shade]) {
  const count = geometry.attributes.position.count;
  geometry.setAttribute('aLit', new Float32BufferAttribute(Array.from({ length: count }, () => [lit.r, lit.g, lit.b]).flat(), 3));
  geometry.setAttribute('aShade', new Float32BufferAttribute(Array.from({ length: count }, () => [shade.r, shade.g, shade.b]).flat(), 3));
  return geometry;
}
