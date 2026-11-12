// A scripted run of the combo toy (?level=combo): holds keys for set times, logs the combo events and
// takes screenshots. Usage: node tools/combo-bot.mjs OUT_PREFIX [WxH]
// It proves that the rules fire, not that the toy is fun.
import { openBrowser } from './browser.mjs';

const [prefix = '/tmp/combo', size = '1200x800'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const { page, base, close } = await openBrowser({ width, height });
await page.goto(base + 'index.html?sound=0&scale=1&level=combo');
await page.waitForFunction(() => window.demo?.frame && window.demo.combo, null, { timeout: 120000 });
await page.evaluate(() => {
  window.demo.renderer.setAnimationLoop(null);
  window.log = [];
});

// Steps n frames of 1/60 s (the frame time comes from performance.now, so wait one frame each).
async function frames(n) {
  await page.evaluate(async n => {
    const { frame, combo, level } = window.demo;
    for (let i = 0; i < n; i++) {
      frame();
      for (const e of combo.events) {
        const c = level.player.character;
        window.log.push(`${combo.time.toFixed(2)} ${e.type} ${e.link ? `${e.link.name} ${e.link.points}` : e.value ?? ''} @${c.position.x.toFixed(1)},${c.position.z.toFixed(1)} ${c.action ?? ''}`);
      }
      await new Promise(r => requestAnimationFrame(r));
    }
  }, n);
}
// Runs (world direction to each target in turn) for n frames each. The bot steers in world space.
async function runTo(target, n, fast = true) {
  await page.evaluate(([x, z, fast]) => {
    window.demo.input.apply = c => {
      const dx = x - c.position.x, dz = z - c.position.z, d = Math.hypot(dx, dz);
      c.input.move.set(d > 0.3 ? dx / d : 0, d > 0.3 ? dz / d : 0);
      c.input.fast = fast;
      c.input.jump = false;
    };
  }, [...target, fast]);
  await frames(n);
}
const fuse = () => page.evaluate(() => { const { combo, level } = window.demo; const c = level.player.character; return `fuse ${combo.combo?.fuse.toFixed(2)} action ${c.action} drive ${c.drive} grounded ${c.controller.grounded} slide ${!!combo.slide}`; });

await frames(20);
await page.screenshot({ path: `${prefix}-0.png` });
// Through the puddle into the stubbies, then the bins.
await runTo([0, 4], 150);
console.log(await fuse());
await page.screenshot({ path: `${prefix}-1.png` });
await runTo([7, 5], 260);
await page.screenshot({ path: `${prefix}-2.png` });
await runTo([10, -7], 300);
await page.screenshot({ path: `${prefix}-3.png` });
await runTo([-8, -4], 330);
await page.screenshot({ path: `${prefix}-4.png` });
await runTo([-9, 7], 260);
await page.screenshot({ path: `${prefix}-5.png` });
await frames(200);
await page.screenshot({ path: `${prefix}-6.png` });
console.log(await page.evaluate(() => window.demo.combo.pieces.filter(p => p.kind === "bin").map(p => window.demo.level.physics.body(p.id()).position.map(v => v.toFixed(1)).join(",") + " " + p.down).join(" | ")));
// A view from above of the last spill.
await page.evaluate(() => {
  const { combo, camera, controls, follow, frame } = window.demo, s = combo.spills.list.at(-1);
  window.demo.follow.update = () => {};
  controls.target.set(s.x, 0, s.z);
  camera.position.set(s.x + 2, 9, s.z + 6);
  controls.update();
  frame();
});
await page.screenshot({ path: `${prefix}-top.png` });
console.log((await page.evaluate(() => window.log)).join('\n'));
console.log(await page.evaluate(() => JSON.stringify({ total: window.demo.combo.total, spills: window.demo.combo.spills.list.length })));
await close();
