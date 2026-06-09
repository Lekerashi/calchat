/* sw.js — minimal service worker so the app is installable and the shell loads offline.
 * Only same-origin app files are cached. API calls to Anthropic/Google always go to the network. */
const CACHE = 'calchat-v2';
const SHELL = [
  '.', 'index.html', 'styles.css', 'app.js', 'claude.js', 'google.js',
  'manifest.webmanifest', 'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle our own files; let API/auth requests pass straight through.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network-first: always try to get the latest version, fall back to cache offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
