const CACHE_NAME = 'deadline-tracker-v1.3';
const ASSETS = [
  './',
  './index.html',
  './script.js',
  './manifest.json'
];

// Install — кешуємо всі assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate — чистимо старі кеші
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — стратегія: спочатку мережа, потім кеш
self.addEventListener('fetch', (event) => {
  // Не кешуємо API-запити
  const url = new URL(event.request.url);
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('generativelanguage.googleapis.com') ||
      url.hostname.includes('accounts.google.com')) {
    return; // network-only для API
  }

  event.respondWith(
    fetch(event.request).then((response) => {
      // Кешуємо успішні відповіді для локальних ресурсів
      if (response.ok && (url.origin === location.origin)) {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, cloned);
        });
      }
      return response;
    }).catch(() => {
      // Якщо мережі немає — повертаємо з кешу
      return caches.match(event.request).then((cached) => {
        return cached || new Response('Offline — немає мережі', { status: 503 });
      });
    })
  );
});
