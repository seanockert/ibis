// Free play screenshot after warm-up frames. Usage: node tools/playshot.mjs OUT.png [query] [WxH]
import { openBrowser } from './browser.mjs';

const [out, query = '', size = '1200x800'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const { page, base, close } = await openBrowser({ width, height });
await page.goto(base + 'index.html?ui=0&sound=0&scale=1&' + query);
await page.waitForFunction(() => window.demo?.frame, null, { timeout: 120000 });
await page.evaluate(async () => {
  const { renderer, frame } = window.demo;
  renderer.setAnimationLoop(null);
  for (let i = 0; i < 40; i++) { frame(); await new Promise(r => requestAnimationFrame(r)); }
});
await page.screenshot({ path: out });
await close();
