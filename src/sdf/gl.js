// WebGL helpers shared by the SDF view and the bake.
import eye from './eye.glsl?raw';
import library from './library.glsl?raw';
import { rigUniforms } from '../ibis/rig.js';

// Fragment shader source: the header, the library, the eye, the model of bird (src/birds.js), then the body.
export function fragmentSource(header, body, bird) {
  return `#version 300 es
precision highp float; precision highp int;
${header}
${library}
${bird.eye}
${eye}
${bird.model}
${body}`;
}

export function createProgram(gl, fs) {
  const vs = '#version 300 es\nvoid main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }';
  const prog = gl.createProgram();
  for (const [type, text] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

// Sets the g* rig uniforms of model.glsl from a solved rig. The program must be in use.
export function setRigUniforms(gl, prog, R) {
  for (const [name, v] of Object.entries(rigUniforms(R))) {
    const loc = gl.getUniformLocation(prog, name);
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.isVector2) gl.uniform2f(loc, v.x, v.y);
    else if (v.isVector3) gl.uniform3f(loc, v.x, v.y, v.z);
    else if (v.isVector4) gl.uniform4f(loc, v.x, v.y, v.z, v.w);
    else gl.uniformMatrix3fv(loc, false, v.elements);
  }
}
