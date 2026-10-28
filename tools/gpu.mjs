// GPU time of free play frames, with timer queries (EXT_disjoint_timer_query_webgl2), median of N.
// Usage: npm run gpu -- "index.html?time=night" [WxH] [ratio] [frames]
// GPU_SETUP: JS to run in the page first, for a cost by parts (hide a mesh: window.demo.scene...).
import { openBrowser } from './browser.mjs';

const [path = 'index.html', size = '1200x800', ratio = '1.5', frames = '120'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const { page, base, close } = await openBrowser({ width, height });
const sep = path.includes('?') ? '&' : '?';
await page.goto(base + path + sep + `ui=0&sound=0&scale=${ratio}`);
await page.waitForFunction(() => window.demo?.frame, null, { timeout: 120000 });
if (process.env.GPU_SETUP) await page.evaluate(process.env.GPU_SETUP);
const ms = await page.evaluate(async n => {
  const { renderer, frame } = window.demo, gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  renderer.setAnimationLoop(null);
  const next = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 30; i++) { frame(); await next(); }   // warm up: compile, first shadows
  const pending = [], times = [];
  for (let i = 0; i < n || pending.length; i++) {
    if (i < n) {
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      frame();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(q);
    }
    await next();
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  }
  times.sort((a, b) => a - b);
  return { median: times[times.length >> 1], min: times[0], max: times[times.length - 1], n: times.length };
}, Number(frames));
console.log(ms ? `GPU ${ms.median.toFixed(2)} ms median (min ${ms.min.toFixed(2)}, max ${ms.max.toFixed(2)}, ${ms.n} frames)` : 'no timer query');
await close();
