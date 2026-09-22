/* Service Worker של ראש בראש: שומר את מעטפת האתר להפעלה מהירה ובלי רשת.
   נתוני התוכניות נטענים תמיד מהרשת קודם (ונופלים למטמון אם אין), וההקלטות
   עצמן לא נשמרות. */
const VERSION = 'rosh-v3-fresh';
const SHELL = [
  './', './index.html', './archive.html', './episode.html',
  './assets/css/rosh.css', './assets/js/ui.js', './assets/js/store.js', './assets/js/player.js',
  './assets/js/home.js', './assets/js/archive.js', './assets/js/episode.js',
  './assets/img/medallion.svg', './manifest.webmanifest',
  './assets/css/program.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // הקלטות: ישר מהרשת, בלי מטמון
  if (/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(url.pathname)) return;
  // נתונים: רשת קודם, מטמון כגיבוי
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req)));
    return;
  }
  // Always revalidate application files so deployments cannot mix old and new UI.
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((r) => {
    if (r.ok) {
      const copy = r.clone();
      e.waitUntil(caches.open(VERSION).then((c) => c.put(req, copy)));
    }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
