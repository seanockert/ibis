// Wind for the plants (plants.js): each vertex moves along the wind by its sway weight (aSway: 0 at the
// foot, more up the tree), in a slow sway and gusts that cross the street in waves, and the crowns flutter:
// a small quick wobble, out of step from clump to clump, more in a gust. The same function in
// the toon, outline and shadow depth shaders, so the outlines and the shadows move with the leaves.
//
//   material: defines WIND, uniforms { uWindTime: windTime }, WIND_SWAY in the vertex shader, sway(p)
//   windTime.value += dt;   // every frame (Plants.update())
//
// sway(p) takes a world position. The plant meshes are in world space (identity model matrix), so the
// shaders call it on the object position.
import { MeshDepthMaterial } from 'three';
import { f } from './util.js';

// dir: as TUFTS.wind (tufts.js). sway: the move at weight 1, units; lean: part of it that is a steady
// lean with the wind. height: a vertex this high above the foot has weight 1 (weight grows as height to
// the power 1.5, so a shrub hardly moves). speed: of the slow sway and of the gust waves, radians a
// second. wave: gust crests for each unit along dir. flutter: the wobble at weight 1 (its weight is the
// square root of the sway weight, so a shrub top flutters too), units; with its speeds on x, y and z,
// radians a second, and its change along the plant, radians a unit (about one step for each clump).
export const WIND = {
  dir: [0.8, 0.6], sway: 0.4, lean: 0.35, height: 10, speed: [0.9, 1.3], wave: 0.04,
  flutter: { size: 0.08, speed: [2.3, 3.1, 2.7], scale: 0.8 },
};
export const windTime = { value: 0 };

// Sway weight of a point height units above the foot of its plant.
export const swayWeight = height => (Math.max(height, 0) / WIND.height) ** 1.5;
// The most that sway() moves a point height units above the foot of its plant, units.
export const swayReach = height => WIND.sway * swayWeight(height) + WIND.flutter.size * 1.5 * Math.min(Math.sqrt(swayWeight(height)), 1);

const [dx, dz] = (() => { const l = Math.hypot(...WIND.dir); return WIND.dir.map(v => v / l); })();
export const WIND_SWAY = /* glsl */`
uniform float uWindTime;
attribute float aSway;
vec3 sway(vec3 p) {
  const vec2 dir = vec2(${f(dx)}, ${f(dz)});
  float gust = 0.5 + 0.5 * sin(dot(p.xz, dir) * ${f(WIND.wave * 2 * Math.PI)} - uWindTime * ${f(WIND.speed[1])});
  float rock = sin(uWindTime * ${f(WIND.speed[0])} + dot(p.xz, vec2(0.37, 0.23)));
  float move = ${f(WIND.sway)} * aSway * (${f(WIND.lean)} + (1.0 - ${f(WIND.lean)}) * (0.6 * gust + 0.4 * rock));
  vec3 phase = uWindTime * vec3(${WIND.flutter.speed.map(f).join(', ')}) + p.zxy * ${f(WIND.flutter.scale)};
  vec3 flutter = sin(phase) * vec3(1.0, 0.5, 1.0) * ${f(WIND.flutter.size)} * min(sqrt(aSway), 1.0) * (0.4 + 0.6 * gust);
  return p + vec3(dir.x, 0.0, dir.y) * move + flutter;
}
`;

// The shadow depth of a swaying mesh (mesh.customDepthMaterial). One for all plants.
let depth = null;
export function windDepthMaterial() {
  if (depth) return depth;
  depth = new MeshDepthMaterial();   // as the default of WebGLShadowMap
  depth.onBeforeCompile = shader => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = WIND_SWAY + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = sway(transformed);');
  };
  return depth;
}
