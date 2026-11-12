// Service worker: the game starts offline. The build (swPlugin in vite.config.js) puts VERSION and FILES
// (every file in dist) in front of this file and writes dist/sw.js. Not used by the dev server.
//
// Install: cache all files. Fetch: the cache first, else the network. A new build gives a new VERSION, so
// the browser installs the new worker, which takes over at once and deletes the old cache. The open page
// keeps the old files; the next launch gets the new ones.

const CACHE = 'ibis-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('ibis-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // A page load gets the cached page of its path, with or without URL parameters (moves.html?t=0.5).
  // Any other path gets the game, as the host does.
  const page = req.mode === 'navigate';
  const opts = { ignoreSearch: true, ignoreVary: true };
  e.respondWith(caches.open(CACHE).then(async c =>
    (page ? await c.match(url.pathname, opts) ?? await c.match('/index.html') : await c.match(req, opts)) ?? fetch(req)));
});
