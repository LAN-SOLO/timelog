// timelog — Service Worker für die Web-Version: App-Shell offline verfügbar
// halten. Strategie „Netz zuerst, Cache als Rückfall“, damit ein neuer Stand
// nach dem Deploy sofort greift und die App ohne Netz trotzdem startet.
const CACHE = 'timelog-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match(new URL('./', self.registration.scope).href);
          if (shell) return shell;
        }
        return new Response('offline', { status: 503, statusText: 'offline' });
      })
  );
});
