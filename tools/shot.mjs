// Renders one frame of a page headless. Usage: npm run shot -- OUT.png "sdf.html?anim=0&t=1.0" [WxH]
import { openBrowser } from './browser.mjs';

const [out, path, size = '700x700'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const { page, base, close } = await openBrowser({ width, height });
const sep = path.includes('?') ? '&' : '?';
await page.goto(base + path + sep + 'scale=1');
await page.waitForFunction(() => document.title === 'DONE' || document.title === 'COMPILE ERROR', null, { timeout: 60000 });
await page.screenshot({ path: out });
await close();
