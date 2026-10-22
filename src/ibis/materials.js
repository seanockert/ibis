// Toon materials for the ibis mesh: the body, the outline hull and the material lines.
// Line widths are in character units, set to match the SDF view at its default camera, with a floor in
// pixels so far away lines don't vanish.
import { BackSide, Color, Matrix4, Quaternion, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import { MAT } from './materialIds.js';
import { BIND_RIG, HEAD_SCALE, rigUniforms } from './rig.js';
import library from '../sdf/library.glsl?raw';
import model from '../sdf/model.glsl?raw';

const SHARED = /* glsl */`
uniform vec3 uSun;            // toward the sun, world space
uniform float uViewHeight;    // viewport height in pixels
const float BAND_SPLIT = 0.12;     // N.L threshold between the lit and the shadow band
const float BAND_SOFT = 0.015;     // softness of the band edge
const float LINE_INNER = 0.01;     // material lines
const float CONTOUR_LIT = 0.01;    // outline on the lit side
const float CONTOUR_SHADE = 0.023; // outline on the shadow side
const float LINE_MIN_PX = 1.0;

`;

const NOISE = /* glsl */`
// Smooth value noise, 0 to 1.
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

// Vertex shader only: the fragment shader has no projectionMatrix.
const PROJECT = /* glsl */`
${NOISE}
// Line width scale that swells and thins slowly along a line, like a brush. p is the bind position, so
// the pattern stays on the body as it moves.
float stroke(vec3 p) { return 0.65 + 0.7 * noise3(p * 7.0); }
// Pixels per character unit at clip w.
float pixelsPerUnit(float w) { return uViewHeight * projectionMatrix[1][1] / (2.0 * w); }
// NDC per pixel on each axis.
vec2 ndcPerPixel() { return 2.0 / (uViewHeight * vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0)); }
`;

// Eye space of a vertex from its bind position: the same frame as eyeSpace() in model.glsl, with the
// side (sign of x) in w. Eyes and lids move with the head only, so the bind position is enough.
const EYE_SPACE = /* glsl */`
uniform mat4 uHeadInv;   // bind pose: character space to head space
vec4 eyeSpace(vec3 p) {
    vec3 h = (uHeadInv * vec4(p, 1.0)).xyz;
    return vec4(abs(h.x) - 0.095, h.y - 0.04, h.z, sign(h.x));
}
`;
const headInv = new Matrix4().compose(BIND_RIG.head, new Quaternion().setFromRotationMatrix(BIND_RIG.headRot), new Vector3().setScalar(HEAD_SCALE)).invert();

const EYE = /* glsl */`
uniform vec2 uLook;    // pupil offset
uniform float uBlink;  // 1 = happy closed eyes
uniform vec4 uExpr;    // top lid (less than 0 wide open), lid tilt (more than 0 angry), lower lid, pupil size
// Lid: positive where the lid shows. Same as lidCover() in model.glsl.
float lidCut(vec4 eye) {
    float top = mix(mix(0.115, -0.13, uExpr.x), -0.13, uBlink) - 0.6 * uExpr.y * eye.z;
    float cut = eye.y - top;
    if (uExpr.z > 0.0) cut = max(cut, mix(-0.2, 0.1, uExpr.z) - eye.y);
    return cut;
}
// Lid: negative on the happy crease at blink 1.
float crease(vec4 eye) { return abs(eye.y - (0.01 - 5.0 * eye.z * eye.z)) - 0.012; }
`;

// Eye: positive inside the pupil. Big pupils look forward along the bill. Needs model.glsl.
const PUPIL = /* glsl */`
float pupil(vec4 eye) {
    vec3 lookDir = normalize(vec3(0.55 + uLook.x * eye.w * 0.4, 0.12 + uLook.y * 0.4, 0.83));
    return dot(normalize(eye.xyz / EYE_R), lookDir) - (1.0 - 0.14 * uExpr.w * uExpr.w);
}
`;

// Material and part group ids as ints. model.glsl has the MAT_* names as floats.
const ids = Object.entries(MAT).map(([k, v]) => `const int ID_${k} = ${v};`).join('\n') + `
const int GROUP_TORSO = 0;
const int GROUP_JAW = 1;
const int GROUP_WINGS = 2;
const int GROUP_SCARF = 4;`;

function paletteArrays(palette) {
  const lit = [], shade = [], line = [];
  for (let id = 0; id <= MAT.LID; id++) {
    const c = palette[id] || palette[MAT.WHITE];
    lit.push(new Color().setRGB(...c.lit, 'srgb'));
    shade.push(new Color().setRGB(...c.shade, 'srgb'));
    line.push(new Color().setRGB(...c.line, 'srgb'));
  }
  return { lit, shade, line };
}

// Mud colours, sRGB: lit and shade bands.
const MUD_LIT = new Color().setRGB(0.50, 0.37, 0.25, 'srgb');
const MUD_SHADE = new Color().setRGB(0.32, 0.23, 0.17, 'srgb');

// Mud and wet. Both use the bind position, so the pattern stays on the body as it moves.
const WEATHER = /* glsl */`
uniform float uMud;   // 0 clean, 1 mud up to the belly
uniform float uWet;   // 0 dry, 1 soaked
uniform vec3 uMudLit, uMudShade;
// 1 where there is mud. Solid below a rough line that rises with uMud, and splashes above the line that
// get fewer and smaller with height.
float mudMask(vec3 p) {
    float line = 0.05 + 0.80 * uMud + 0.20 * (noise3(p * 3.5) - 0.5) + 0.06 * (noise3(p * 13.0) - 0.5);
    float above = p.y - line;
    float solid = 1.0 - smoothstep(-0.004, 0.004, above);
    float reach = 0.10 + 0.40 * uMud;
    float density = clamp(1.0 - above / reach, 0.0, 1.0) * step(0.0, above);
    float spot = noise3(p * 12.0 + 7.3) * 0.65 + noise3(p * 31.0) * 0.35;
    float splash = smoothstep(0.0, 0.02, spot - mix(0.92, 0.58, density));
    return uMud > 0.0 ? max(solid, splash) : 0.0;
}
// Mud and wet on the base colour. band: 0 shade to 1 lit. n and v: unit normal and view direction, world.
vec3 weather(vec3 col, vec3 p, float band, vec3 n, vec3 v) {
    float mud = mudMask(p);
    // Uneven: soft light and dark, and darker patches of wet mud.
    vec3 mudCol = mix(uMudShade, uMudLit, band) * mix(0.8, 1.1, noise3(p * 9.0));
    mudCol *= 1.0 - 0.25 * smoothstep(0.62, 0.64, noise3(p * 6.0 + 3.1));
    col = mix(col, mudCol, mud);
    if (uWet <= 0.0) return col;
    // Wet feathers go darker, with darker streaks that run down.
    float streak = smoothstep(0.55, 0.75, noise3(vec3(p.x * 40.0, p.y * 3.0, p.z * 40.0)));
    col *= mix(1.0, 0.68 - 0.12 * streak, uWet);
    // A hard, broken highlight in the lit band.
    float spec = smoothstep(0.94, 0.955, dot(n, normalize(uSun + v))) * step(0.4, noise3(p * 14.0));
    return mix(col, vec3(1.0), 0.4 * spec * band * uWet);
}
`;

const SKIN_VERTEX = /* glsl */`
    #include <skinbase_vertex>
    vec3 objectNormal = normal;
    #include <skinnormal_vertex>
    vec3 transformed = position;
    #include <skinning_vertex>
    vec3 worldNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

// Two-band cel shading with lit and shade colours per material. Eyes draw the pupil and lids cut at
// the lid line, both with a line on the edge. Where a wing sinks into the body, both draw a line on the
// true intersection: the body tests the wing SDF and the wing tests the body SDF, from model.glsl with
// the current rig in the g* uniforms (see setRig).
export function bodyMaterial(palette, shared) {
  const { lit, shade, line } = paletteArrays(palette);
  const rig = Object.fromEntries(Object.entries(rigUniforms(BIND_RIG)).map(([k, v]) => [k, { value: v }]));
  return new ShaderMaterial({
    name: 'ibis-body',
    uniforms: {
      ...shared, ...rig, iFrame: { value: 0 }, uHeadInv: { value: headInv },
      uLit: { value: lit }, uShade: { value: shade }, uLine: { value: line }, uLook: { value: new Vector2() }, uBlink: { value: 0 }, uExpr: { value: new Vector4(0, 0, 0, 1) },
      uMud: { value: 0 }, uWet: { value: 0 }, uMudLit: { value: MUD_LIT }, uMudShade: { value: MUD_SHADE },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <skinning_pars_vertex>
      ${SHARED}
      ${PROJECT}
      ${EYE_SPACE}
      attribute float _mat;
      attribute float _group;
      attribute float _edge;   // eyes: distance to the skull
      varying vec3 vNormal;
      varying vec3 vPos;       // character space
      varying vec3 vBind;      // bind position, character space
      varying vec3 vToCamera;  // character space, unit
      varying vec3 vRotX, vRotY, vRotZ;   // character space to world space rotation
      varying float vMat;
      varying float vGroup;
      varying vec4 vEye;
      varying float vEdge;
      varying float vPixels;
      void main() {
        ${SKIN_VERTEX}
        vNormal = worldNormal;
        vPos = transformed;
        vBind = position;
        vToCamera = normalize((inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - transformed);
        vRotX = normalize(modelMatrix[0].xyz);
        vRotY = normalize(modelMatrix[1].xyz);
        vRotZ = normalize(modelMatrix[2].xyz);
        vMat = _mat;
        vGroup = _group;
        vEye = eyeSpace(position);
        vEdge = _edge;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        vPixels = pixelsPerUnit(gl_Position.w);
      }`,
    fragmentShader: /* glsl */`
      uniform int iFrame;   // read by the library
      ${library}
      ${model}
      ${ids}
      ${SHARED}
      ${NOISE}
      ${WEATHER}
      ${EYE}
      ${PUPIL}
      uniform vec3 uLit[${MAT.LID + 1}], uShade[${MAT.LID + 1}], uLine[${MAT.LID + 1}];
      // A part that lies over the torso: the distance to its solid stand-in and its material at p.
      // PART_SCARF is the scarf as baked, without the head carve.
      const int PART_SCARF = 0, PART_WINGS = 1;
      vec2 over(vec3 p, int part) {
        if (part == PART_WINGS) { vec2 l = wingL(p), r = wingR(p); return l.x < r.x ? l : r; }
        vec3 q = bodySpace(p);
        float solid;
        float id = scarfUncarved(q, body(q), solid).y;
        return vec2(solid, id);
      }
      varying vec3 vNormal;
      varying vec3 vPos;
      varying vec3 vBind;
      varying vec3 vToCamera;
      varying vec3 vRotX, vRotY, vRotZ;
      varying float vMat;
      varying float vGroup;
      varying vec4 vEye;
      varying float vEdge;
      varying float vPixels;
      // 1 within halfPx pixels of the zero line of f.
      float lineMask(float f, float halfPx) {
        float px = abs(f) / max(length(vec2(dFdx(f), dFdy(f))), 1e-6);
        return 1.0 - smoothstep(halfPx - 0.5, halfPx + 0.5, px);
      }
      // A part over the torso: a line where the view ray passes close to the part on its way here, as
      // the contour in the SDF view. March toward the camera, up to far, and keep the nearest miss of
      // the part's solid stand-in. Steps are short near the part, so the miss is accurate. Where the
      // part stands well off the torso (CONTOUR_RISE in the SDF view), the line widens to the contour
      // width, wider on the shadow side.
      void overLine(int part, float far, inout float edge, inout vec3 edgeCol) {
        // rise: the most the ray clears the torso and the part between here and the miss.
        float t = 0.0, miss = 1e9, rise = 0.0, clear = 0.0;
        vec3 at = vPos;
        for (int i = 0; i < 48; i++) {
          vec3 x = vPos + vToCamera * t;
          vec3 q = bodySpace(x);
          float d = over(x, part).x;
          clear = max(clear, min(min(body(q), tail(q)), d));
          if (d < miss) { miss = d; at = x; rise = clear; }
          t += max(d, 0.004);
          if (t > far) break;
        }
        float px = 1.0 / vPixels;   // one pixel in character units
        if (miss > CONTOUR_SHADE + px) return;
        // A wide normal sample, so sharp edges don't make the width jump.
        const float E = 0.03;
        vec3 g = vec3(over(at + vec3(E, 0, 0), part).x - over(at - vec3(E, 0, 0), part).x,
                      over(at + vec3(0, E, 0), part).x - over(at - vec3(0, E, 0), part).x,
                      over(at + vec3(0, 0, E), part).x - over(at - vec3(0, 0, E), part).x);
        vec3 n = normalize(mat3(vRotX, vRotY, vRotZ) * g);
        float contour = mix(CONTOUR_SHADE, CONTOUR_LIT, smoothstep(-0.3, 0.6, dot(n, uSun)));
        float w = max(mix(LINE_INNER, contour, smoothstep(0.035, 0.07, rise)), px);
        // The wing line tapers away where the wing grows out of the body.
        if (part == PART_WINGS) w *= wingSeam(at);
        // Mesh error can put the torso just inside a wing, where the march starts with miss < 0. Without
        // abs, that gives a line where wingSeam removes it.
        float e = 1.0 - smoothstep(w - px, w, part == PART_WINGS ? abs(miss) : miss);
        if (e > edge) { edge = e; edgeCol = uLine[int(over(at, part).y + 0.5)]; }
      }
      void main() {
        int id = int(vMat + 0.5);
        vec3 lit = uLit[id], shade = uShade[id];
        float edge = 0.0;
        vec3 edgeCol = uLine[id];
        float halfPx = 0.5 * max(LINE_INNER * vPixels, LINE_MIN_PX);
        if (id == ID_EYE) {
          float k = pupil(vEye);
          if (k > 0.0) { lit = uLit[ID_PUPIL]; shade = uShade[ID_PUPIL]; }
          edge = max(lineMask(k, halfPx), lineMask(vEdge, halfPx));
          edgeCol = uLine[ID_PUPIL];
        } else if (id == ID_LID) {
          float cut = lidCut(vEye);
          if (cut < 0.0) discard;
          // Only where the eye shows below the lid, as in the SDF view.
          edge = lineMask(cut, halfPx * 2.0) * step(0.04, vEye.x);
          if (uBlink > 0.9 && crease(vEye) < 0.0 && vEye.x > 0.04) { lit = uLit[ID_PUPIL]; shade = uShade[ID_PUPIL]; }
        } else {
          int group = int(vGroup + 0.5);
          float d = group == GROUP_TORSO ? min(wingL(vPos).x, wingR(vPos).x)
                  : group == GROUP_WINGS ? body(bodySpace(vPos)) : 1e9;
          // At zero width the mask is still half on at the zero line, so the width goes half a pixel
          // below zero.
          if (d < 1.0) edge = lineMask(d, (halfPx + 0.5) * wingSeam(vPos) - 0.5);
          if (group == GROUP_TORSO) {
            if (over(vPos, PART_SCARF).x < 1.2) overLine(PART_SCARF, 1.2, edge, edgeCol);
            if (d < 0.35) overLine(PART_WINGS, 0.6, edge, edgeCol);
          }
        }
        float band = smoothstep(BAND_SPLIT - BAND_SOFT, BAND_SPLIT + BAND_SOFT, dot(normalize(vNormal), uSun));
        vec3 col = mix(shade, lit, band);
        if (id != ID_EYE && id != ID_LID) {
          col = weather(col, vBind, band, normalize(vNormal), normalize(mat3(vRotX, vRotY, vRotZ) * vToCamera));
        }
        col = mix(col, edgeCol, edge);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Inverted hull: the back faces pushed out along the normal in screen space, in the line colour.
// Two of them, as in the SDF view:
// contour: wide, wider on the shadow side, and pushed back, so it shows only where the surface behind
//   is well away (CONTOUR_RISE in the SDF view).
// inner: thin, and pulled toward the camera, so it also shows where a part lies close on another or
//   sinks into it (a wing on the body). The stencil keeps it off its own part group, so it can't show
//   through a thin part.
export function hullMaterial(palette, shared, body, kind) {
  const { line } = paletteArrays(palette);
  return new ShaderMaterial({
    name: 'ibis-hull-' + kind,
    side: BackSide,
    defines: { CONTOUR: kind === 'contour' ? 1 : 0 },
    uniforms: { ...shared, uHeadInv: { value: headInv }, uLine: { value: line }, uLook: body.uniforms.uLook, uBlink: body.uniforms.uBlink, uExpr: body.uniforms.uExpr },
    vertexShader: /* glsl */`
      #include <common>
      #include <skinning_pars_vertex>
      ${ids}
      ${SHARED}
      ${PROJECT}
      ${EYE_SPACE}
      attribute float _mat;
      attribute float _group;
      attribute float _line;
      attribute vec3 _outline;   // smooth normal for the push out
      varying float vMat;
      varying vec4 vEye;
      void main() {
        #include <skinbase_vertex>
        vec3 objectNormal = _outline;
        #include <skinnormal_vertex>
        vec3 transformed = position;
        #include <skinning_vertex>
        vec3 worldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vMat = _mat;
        vEye = eyeSpace(position);
        // Move along the view ray, in object space (character space).
        vec3 camera = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vec3 away = normalize(transformed - camera);
      #if CONTOUR
        // Back, but not below the ground the character stands on (y = 0), so the ground can't cover
        // the outline at the feet.
        // The scarf lies on the chest, which curves away under its edge: it gets its wide line only
        // against what is far behind it, so no stray stroke shows a little way off its edge.
        float push = int(_group + 0.5) == GROUP_SCARF ? 0.2 : 0.07;
        if (away.y < 0.0) push = min(push, max(transformed.y - 0.005, 0.0) / -away.y);
        transformed += away * push;
        float units = mix(CONTOUR_SHADE, CONTOUR_LIT, smoothstep(-0.3, 0.6, dot(worldNormal, uSun)));
      #else
        // The jaw sits just under the thin bill, so it pulls less, or its line would show through.
        transformed -= away * (int(_group + 0.5) == GROUP_JAW ? 0.01 : 0.04);
        float units = LINE_INNER;
      #endif
        units *= stroke(position);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        vec2 dir = normalize(mat3(viewMatrix) * worldNormal).xy;
        float px = max(units * pixelsPerUnit(clip.w), LINE_MIN_PX) * _line;
        clip.xy += normalize(dir + 1e-6) * px * ndcPerPixel() * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      ${ids}
      ${SHARED}
      ${EYE}
      uniform vec3 uLine[${MAT.LID + 1}];
      varying float vMat;
      varying vec4 vEye;
      void main() {
        int id = int(vMat + 0.5);
        if (id == ID_LID && lidCut(vEye) < 0.0) discard;
        gl_FragColor = vec4(uLine[id], 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Lines along the material borders: one screen-space quad per border edge, skinned at both ends.
export function lineMaterial(shared) {
  return new ShaderMaterial({
    name: 'ibis-lines',
    uniforms: { ...shared },
    vertexShader: /* glsl */`
      #include <common>
      #include <skinning_pars_vertex>
      ${SHARED}
      ${PROJECT}
      attribute vec3 other;          // the other end of the edge
      attribute vec4 skinIndexOther;
      attribute vec4 skinWeightOther;
      attribute vec2 corner;         // x: 0 at this end, 1 at the far end. y: side, -1 or 1
      attribute vec3 lineColor;
      varying vec3 vColor;
      vec4 skinned(vec3 p, vec4 index, vec4 weight) {
        mat4 m = getBoneMatrix(index.x) * weight.x + getBoneMatrix(index.y) * weight.y
               + getBoneMatrix(index.z) * weight.z + getBoneMatrix(index.w) * weight.w;
        return modelViewMatrix * (bindMatrixInverse * (m * (bindMatrix * vec4(p, 1.0))));
      }
      void main() {
        vec4 a = skinned(position, skinIndex, skinWeight);
        vec4 b = skinned(other, skinIndexOther, skinWeightOther);
        // Pull toward the camera a little so the line sits on top of the surface it lies on.
        a.xyz += normalize(-a.xyz) * 0.004;
        b.xyz += normalize(-b.xyz) * 0.004;
        vec4 ca = projectionMatrix * a, cb = projectionMatrix * b;
        // Edge direction in pixels, from this end's point of view toward the far end.
        vec2 dir = normalize((cb.xy / cb.w - ca.xy / ca.w) / ndcPerPixel() + 1e-6) * (corner.x > 0.5 ? -1.0 : 1.0);
        float px = max(LINE_INNER * stroke(position) * pixelsPerUnit(ca.w), LINE_MIN_PX);
        ca.xy += vec2(-dir.y, dir.x) * corner.y * 0.5 * px * ndcPerPixel() * ca.w;
        vColor = lineColor;
        gl_Position = ca;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function sharedUniforms() {
  return { uSun: { value: new Vector3(-0.45, 1.3, 0.55).normalize() }, uViewHeight: { value: 700 } };
}
