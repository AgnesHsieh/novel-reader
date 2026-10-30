// Service Worker for 墨韻讀書 (Offline PWA Support)
const CACHE_NAME = 'moyu-reader-v9';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/reader.css',
  './js/chinese_conv.js',
  './js/sources.js',
  './js/db.js',
  './js/tts.js',
  './js/app.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching offline static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;
  const url = new URL(event.request.url);

  // API calls: Network-first, offline graceful JSON fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ success: false, offline: true, error: 'Offline mode' }), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      })
    );
    return;
  }

  // Static Assets: Network-first with Cache fallback (ignoreSearch: true handles ?v=...)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Network failed (offline): Match in cache, ignoring query parameters like ?v=233
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;

        // If offline and navigating, return cached index.html
        if (event.request.mode === 'navigate') {
          const indexCached = (await caches.match('./index.html', { ignoreSearch: true })) ||
                              (await caches.match('./', { ignoreSearch: true }));
          if (indexCached) return indexCached;
        }

        return new Response('離線模式', { status: 503, statusText: 'Offline' });
      })
  );
});
