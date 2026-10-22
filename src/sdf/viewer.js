// Raymarch reference view. URL params: anim (1 and up: a move from src/moves.js), t (fixed time), debug, aa, scale,
// yaw and pitch (fixed camera), sheet (turnaround), bench (frames to time).
import raymarch from './raymarch.glsl?raw';
import { createProgram, fragmentSource, setRigUniforms } from './gl.js';
import { Character } from '../ibis/motion/character.js';
import { solveRig } from '../ibis/rig.js';
import { MOVES, scriptedCharacter, startMove } from '../moves.js';

const params = new URLSearchParams(location.search);
// ui=0 hides the buttons and the hint, for tools/strip.mjs.
if (params.get('ui') === '0') for (const el of document.querySelectorAll('.bar, .hint')) el.style.display = 'none';
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
let moveIndex = Math.max(Number(params.get('anim') || 1) - 1, 0);
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const scale = Number(params.get('scale') || Math.min(window.devicePixelRatio, 1.5));
let frame = 0, last = performance.now();
const mouse = [0, 0, 0, 0];
// Fixed camera for screenshots: yaw in radians, pitch 0..1.
if (params.has('yaw')) { mouse[0] = (Number(params.get('yaw')) / (2 * Math.PI) + 0.5) * innerWidth; mouse[1] = Number(params.get('pitch') || 0.24) * innerHeight; mouse[2] = 1; }

let body = raymarch;
if (params.has('debug')) body = body.replace(/#define DEBUG_MODE \d/, `#define DEBUG_MODE ${params.get('debug')}`);
if (params.has('aa')) body = body.replace(/#define AA \d/, `#define AA ${params.get('aa')}`);
const header = 'uniform vec3 iResolution; uniform float iTime; uniform int iFrame; uniform vec4 iMouse; uniform vec2 iOffset;\nout vec4 outColor;';
const prog = createProgram(gl, fragmentSource(header, body + '\nvoid main() { mainImage(outColor, gl_FragCoord.xy - iOffset); outColor.a = 1.0; }\n'));

// The character moves on the spot: this view draws character space only.
const character = fixedTime !== null ? scriptedCharacter(moveIndex, fixedTime) : new Character();
let script = startMove(character, moveIndex), moveTime = 0;

// Views drawn side by side: the live view, or a turnaround sheet when ?sheet=1.
const sheetYaws = [0, -Math.PI / 2, Math.PI, -0.8];

function draw() {
  drawFrame();
  if (fixedTime === null) requestAnimationFrame(draw); else document.title = 'DONE';
}

function drawFrame() {
  const w = Math.round(canvas.clientWidth * scale), h = Math.round(canvas.clientHeight * scale);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.useProgram(prog);
  const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (fixedTime === null) { script(character, moveTime); moveTime += dt; character.update(Math.max(dt, 1e-4)); }
  const t = fixedTime !== null ? fixedTime : moveTime;
  setRigUniforms(gl, prog, solveRig(character.pose));
  const views = params.has('sheet') ? sheetYaws.length : 1;
  const vw = Math.floor(w / views);
  for (let v = 0; v < views; v++) {
    gl.viewport(v * vw, 0, vw, h);
    let m = mouse;
    if (views > 1) m = [(sheetYaws[v] / (2 * Math.PI) + 0.5) * vw, 0.24 * h, 1, 0];
    gl.uniform2f(gl.getUniformLocation(prog, 'iOffset'), v * vw, 0);
    gl.uniform3f(gl.getUniformLocation(prog, 'iResolution'), vw, h, 1);
    gl.uniform1f(gl.getUniformLocation(prog, 'iTime'), t);
    gl.uniform1i(gl.getUniformLocation(prog, 'iFrame'), frame);
    gl.uniform4f(gl.getUniformLocation(prog, 'iMouse'), views > 1 ? m[0] : m[0] * scale, views > 1 ? m[1] : m[1] * scale, m[2], m[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  frame++;
}

const bar = document.getElementById('bar');
MOVES.forEach(({ name }, i) => {
  const b = document.createElement('button');
  b.textContent = name;
  b.setAttribute('aria-pressed', String(i === moveIndex));
  b.onclick = () => {
    moveIndex = i;
    script = startMove(character, i);
    moveTime = 0;
    bar.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-pressed', String(j === i)));
  };
  bar.appendChild(b);
});

let dragging = false;
canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); move(e); });
canvas.addEventListener('pointermove', e => { if (dragging) move(e); });
canvas.addEventListener('pointerup', () => { dragging = false; });
function move(e) { mouse[0] = e.offsetX; mouse[1] = canvas.clientHeight - e.offsetY; mouse[2] = 1; }

if (params.has('sheet')) { bar.style.display = 'none'; document.getElementById('hint').style.display = 'none'; }
// ?bench=N: draw N frames in a blocking loop and put the mean frame time in the title.
if (params.has('bench')) {
  const n = Number(params.get('bench')) || 30, px = new Uint8Array(4);
  const once = () => { drawFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  once();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) once();
  document.title = 'BENCH ' + ((performance.now() - t0) / n).toFixed(2) + ' ms';
} else {
  requestAnimationFrame(draw);
}
