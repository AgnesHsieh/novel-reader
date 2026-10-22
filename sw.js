// Service Worker for 墨韻讀書 (Offline PWA Support)
const CACHE_NAME = 'moyu-reader-v4';

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
  const url = new URL(event.request.url);

  // Bypass API requests to allow offline fallback in frontend IndexedDB
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first with cache fallback
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
      .catch(() => {
        // If offline, serve from cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback to index.html if navigating
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('離線模式', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
