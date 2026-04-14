const CACHE_NAME = 'fireguard-v3-cache';
const ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Force new SW to take over immediately
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Clear old caches on activate
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for HTML (always get fresh), cache-first for static assets only
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // HTML files: ALWAYS fetch from network (never serve stale)
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  
  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
