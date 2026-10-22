// Mean GPU frame time of a page. Usage: npm run bench -- "sdf.html?anim=2&t=1.0" [WxH] [frames]
import { openBrowser } from './browser.mjs';

const [path, size = '1280x800', frames = '30'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const { page, base, close } = await openBrowser({ width, height });
const sep = path.includes('?') ? '&' : '?';
await page.goto(base + path + sep + 'scale=1&bench=' + frames);
await page.waitForFunction(() => document.title.startsWith('BENCH'), null, { timeout: 120000 });
console.log(await page.title());
await close();
