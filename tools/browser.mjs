// Starts the Vite dev server and headless Chrome on the GPU, for the shot, bench and bake tools.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

export async function openBrowser({ width = 700, height = 700 } = {}) {
  const server = await createServer({ logLevel: 'error', server: { port: 0 } });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error(m.text()); });
  page.on('pageerror', e => console.error(e.message));
  const close = async () => { await browser.close(); await server.close(); };
  return { page, base, close };
}
