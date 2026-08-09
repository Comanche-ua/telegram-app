const CACHE_NAME = 'deadline-tracker-v9.30';
const ASSETS = [
  './',
  './index.html',
  './planner.html',
  './themes.css',
  './base.css',
  './script.js',
  './shtat-default.csv',
  './manifest.json',
  './logo-mark.svg',
  './deadline-alert.svg'
];

// Install — попередньо кешуємо ключові assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// Activate — чистимо старі кеші
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Fetch — Network-first для app.css та script.js (для миттєвого оновлення в Telegram WebApp),
// Stale-while-revalidate для інших
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isThirdPartyApi =
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('docs.google.com') ||
    url.hostname.includes('sheets.googleusercontent.com') ||
    url.hostname.includes('script.google.com');

  if (isThirdPartyApi) return; // мережа, без кешування

  // Network-first для локальних JS/CSS ресурсів
  if (url.origin === location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Для решти локальних файлів — stale-while-revalidate
  if (url.origin === location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const network = fetch(event.request)
            .then((response) => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            })
            .catch(() => cached || new Response('Offline', { status: 503 }));
          return cached || network;
        })
      )
    );
    return;
  }

  // Зовнішні статичні ресурси — cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
