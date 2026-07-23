const CACHE_NAME = 'deadline-tracker-v1.5-command-desk';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './script.js',
  './manifest.json',
<<<<<<< HEAD
  './logo-mark.svg',
  './deadline-alert.svg'
=======
  './logo-mark.svg'
>>>>>>> 4382c049699f15468a2739c3189ec53e20a07363
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

// Fetch — stale-while-revalidate для локальних ресурсів (миттєве завантаження + фонове оновлення),
// network-only для сторонніх API (Google/Gemini/Telegram)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isThirdPartyApi =
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.hostname.includes('accounts.google.com');

  if (isThirdPartyApi) return; // мережа, без кешування

  if (url.origin !== location.origin) {
    // Зовнішні статичні ресурси (шрифти, telegram-web-app.js) — cache-first
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const cloned = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Локальні ресурси — stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached || new Response('Offline — немає мережі', { status: 503 }));
        return cached || network;
      })
    )
  );
});
