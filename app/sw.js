// Offline support: the app shell is cached on install; vendor libraries are cached the first time they load.
// Patient data lives in IndexedDB, never in this cache. API calls always go to the network.
const VERSION = 'v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/parsers.js', 'js/note.js', 'js/store.js', 'js/importers.js', 'js/defaults.js', 'js/docx.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // Network first for the shell so updates arrive when the computer is reachable; cache when offline.
  e.respondWith(
    // no-cache: always ask the server whether a file changed, so updates show on the next open.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
