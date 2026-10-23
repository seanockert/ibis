// Renders frames of a move into one grid image, to check timing.
// Usage: npm run strip -- OUT.png "index.html?anim=7&yaw=1.4&pitch=0.1" T0 T1 N [CELL] [COLUMNS]
// Takes N frames from time T0 to T1 (seconds), each CELL pixels square (default 300).
import { openBrowser } from './browser.mjs';

const [out, path, t0 = '0', t1 = '2', n = '8', cell = '300', columns] = process.argv.slice(2);
const count = Number(n), size = Number(cell), cols = Number(columns || Math.min(count, 6));
const { page, base, close } = await openBrowser({ width: size, height: size });
const sep = path.includes('?') ? '&' : '?';
const frames = [];
for (let i = 0; i < count; i++) {
  const t = Number(t0) + (Number(t1) - Number(t0)) * (count > 1 ? i / (count - 1) : 0);
  await page.goto(`${base}${path}${sep}scale=1&ui=0&t=${t.toFixed(3)}`);
  await page.waitForFunction(() => document.title === 'DONE' || document.title === 'COMPILE ERROR', null, { timeout: 60000 });
  frames.push({ t, png: (await page.screenshot()).toString('base64') });
}
const rows = Math.ceil(count / cols);
await page.setViewportSize({ width: cols * size, height: rows * size });
await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${size}px);font:12px system-ui">
${frames.map(f => `<div style="position:relative"><img src="data:image/png;base64,${f.png}" width="${size}" height="${size}">
<span style="position:absolute;left:6px;top:4px">t=${f.t.toFixed(2)}</span></div>`).join('')}</body>`);
await page.screenshot({ path: out, fullPage: true });
await close();
