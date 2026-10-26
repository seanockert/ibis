// Evaluates parts of the SDF model on the GPU and reads the results back.
import kernel from './bake.glsl?raw';
import { createProgram, fragmentSource, setRigUniforms } from '../../src/sdf/gl.js';

const WIDTH = 2048;        // texels per row
const MAX_ROWS = 2048;     // rows per draw

export class SdfEval {
  // bird: from src/birds.js. rig: a solved rig of the bird.
  constructor(bird, rig) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
    this.gl = gl;
    this.prog = createProgram(gl, fragmentSource('', kernel, bird));
    gl.useProgram(this.prog);
    setRigUniforms(gl, this.prog, rig);
    this.target = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, WIDTH, MAX_ROWS);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    // Keep the render target off every texture unit, so no draw reads the texture it writes.
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.pointTex = gl.createTexture();
    this.uniform('uPoints', '1i', 1);
  }

  uniform(name, fn, ...v) { this.gl['uniform' + fn](this.gl.getUniformLocation(this.prog, name), ...v); }

  // Runs the kernel for count samples. Returns 4 floats per sample.
  run(count, mode, part) {
    const { gl } = this;
    this.uniform('uMode', '1i', mode);
    this.uniform('uPart', '1i', part);
    this.uniform('uWidth', '1i', WIDTH);
    const out = new Float32Array(count * 4);
    for (let offset = 0; offset < count; offset += WIDTH * MAX_ROWS) {
      const rows = Math.ceil(Math.min(count - offset, WIDTH * MAX_ROWS) / WIDTH);
      this.uniform('uOffset', '1i', offset);
      gl.viewport(0, 0, WIDTH, rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const chunk = new Float32Array(WIDTH * rows * 4);
      gl.readPixels(0, 0, WIDTH, rows, gl.RGBA, gl.FLOAT, chunk);
      out.set(chunk.subarray(0, Math.min(chunk.length, out.length - offset * 4)), offset * 4);
    }
    return out;
  }

  // Distance at every grid point. Index: x + nx * (y + ny * z).
  grid(part, min, cell, dims) {
    this.uniform('uMin', '3f', min[0], min[1], min[2]);
    this.uniform('uCell', '1f', cell);
    this.uniform('uDims', '3i', dims[0], dims[1], dims[2]);
    const raw = this.run(dims[0] * dims[1] * dims[2], 0, part);
    const d = new Float32Array(raw.length / 4);
    for (let i = 0; i < d.length; i++) d[i] = raw[i * 4];
    return d;
  }

  upload(xyz) {
    const { gl } = this;
    const n = xyz.length / 3;
    const rows = Math.ceil(n / WIDTH);
    const data = new Float32Array(WIDTH * rows * 4);
    for (let i = 0; i < n; i++) data.set(xyz.subarray(i * 3, i * 3 + 3), i * 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.pointTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, WIDTH, rows, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Distance and material id at each point of xyz (3 floats per point).
  points(part, xyz) {
    this.upload(xyz);
    const raw = this.run(xyz.length / 3, 1, part);
    const n = xyz.length / 3, d = new Float32Array(n), id = new Float32Array(n);
    for (let i = 0; i < n; i++) { d[i] = raw[i * 4]; id[i] = raw[i * 4 + 1]; }
    return { d, id };
  }

  // Gradient (3 floats per point) and distance at each point of xyz.
  gradient(part, xyz) {
    this.upload(xyz);
    const raw = this.run(xyz.length / 3, 2, part);
    const n = xyz.length / 3, g = new Float32Array(n * 3), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { g.set(raw.subarray(i * 4, i * 4 + 3), i * 3); d[i] = raw[i * 4 + 3]; }
    return { g, d };
  }

  // sRGB lit, shade and line colours for material ids 0..31.
  palette() {
    const raw = this.run(96, 3, 0);
    const pick = (id, row) => Array.from(raw.subarray((row * 32 + id) * 4, (row * 32 + id) * 4 + 3));
    return id => ({ lit: pick(id, 0), shade: pick(id, 1), line: pick(id, 2) });
  }
}
