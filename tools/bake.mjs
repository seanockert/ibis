// Bakes src/sdf/model.glsl into public/ibis.glb. Usage: npm run bake
import { writeFileSync } from 'node:fs';
import { openBrowser } from './browser.mjs';
import { pack } from './pack.mjs';

const { page, base, close } = await openBrowser();
await page.goto(base + 'tools/bake/bake.html');
await page.waitForFunction(() => window.bakeResult, null, { timeout: 300000 });
const result = await page.evaluate(() => window.bakeResult);
await close();
if (result.error) { console.error(result.error); process.exit(1); }
const glb = await pack(Buffer.from(result.glb, 'base64'));
writeFileSync('public/ibis.glb', glb);
console.table(result.stats);
const tris = result.stats.reduce((s, p) => s + p.tris, 0);
console.log(`public/ibis.glb: ${tris} triangles, ${(glb.length / 1024).toFixed(0)} KB`);
