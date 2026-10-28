// Frame meter, top left: frame time and fps from the time between frames, the CPU time of the frame's
// JS, and the GPU time where the browser has timer queries (EXT_disjoint_timer_query_webgl2: desktop
// Chrome and Firefox, not Safari). Means over METER.every seconds.
//
//   const meter = new Meter(renderer);
//   meter.begin();  ...the frame...  meter.end();
const METER = { every: 0.5 };

export class Meter {
  constructor(renderer) {
    this.el = document.getElementById('meter');
    this.el.hidden = false;
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];   // GPU queries not read yet
    this.last = performance.now();
    this.sum = { frame: 0, cpu: 0, gpu: 0, n: 0, gpuN: 0 };
  }

  begin() {
    this.start = performance.now();
    if (!this.ext || this.pending.length > 4) return;
    this.query = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
  }

  end() {
    const { gl, ext, sum } = this, now = performance.now();
    if (this.query) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.pending.push(this.query);
      this.query = null;
    }
    // Results come a few frames later. A disjoint (the GPU did something else) spoils them.
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { sum.gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; sum.gpuN++; }
      gl.deleteQuery(q);
    }
    sum.frame += now - this.last;
    sum.cpu += now - this.start;
    sum.n++;
    this.last = now;
    if (sum.frame < METER.every * 1000) return;
    const frame = sum.frame / sum.n;
    let text = `${frame.toFixed(1)} ms  ${Math.round(1000 / frame)} fps\ncpu ${(sum.cpu / sum.n).toFixed(1)}`;
    if (sum.gpuN) text += `  gpu ${(sum.gpu / sum.gpuN).toFixed(1)}`;
    this.el.textContent = text;
    this.sum = { frame: 0, cpu: 0, gpu: 0, n: 0, gpuN: 0 };
  }
}
