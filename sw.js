const CACHE = 'frontier-poker-616acbe18b';

const FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/ai.js',
  './js/app.js',
  './js/career.js',
  './js/engine.js',
  './js/guide.js',
  './fonts/SS4.woff2',
  './fonts/SS4reg.woff2',
  './assets/avatars/alice.png',
  './assets/avatars/bat.png',
  './assets/avatars/bill.png',
  './assets/avatars/doc.png',
  './assets/avatars/full/alice.jpg',
  './assets/avatars/full/bat.jpg',
  './assets/avatars/full/bill.jpg',
  './assets/avatars/full/doc.jpg',
  './assets/avatars/full/jane.jpg',
  './assets/avatars/jane.png',
  './assets/cards/10C.svg',
  './assets/cards/10D.svg',
  './assets/cards/10H.svg',
  './assets/cards/10S.svg',
  './assets/cards/2C.svg',
  './assets/cards/2D.svg',
  './assets/cards/2H.svg',
  './assets/cards/2S.svg',
  './assets/cards/3C.svg',
  './assets/cards/3D.svg',
  './assets/cards/3H.svg',
  './assets/cards/3S.svg',
  './assets/cards/4C.svg',
  './assets/cards/4D.svg',
  './assets/cards/4H.svg',
  './assets/cards/4S.svg',
  './assets/cards/5C.svg',
  './assets/cards/5D.svg',
  './assets/cards/5H.svg',
  './assets/cards/5S.svg',
  './assets/cards/6C.svg',
  './assets/cards/6D.svg',
  './assets/cards/6H.svg',
  './assets/cards/6S.svg',
  './assets/cards/7C.svg',
  './assets/cards/7D.svg',
  './assets/cards/7H.svg',
  './assets/cards/7S.svg',
  './assets/cards/8C.svg',
  './assets/cards/8D.svg',
  './assets/cards/8H.svg',
  './assets/cards/8S.svg',
  './assets/cards/9C.svg',
  './assets/cards/9D.svg',
  './assets/cards/9H.svg',
  './assets/cards/9S.svg',
  './assets/cards/AC.svg',
  './assets/cards/AD.svg',
  './assets/cards/AH.svg',
  './assets/cards/AS.svg',
  './assets/cards/JC.svg',
  './assets/cards/JD.svg',
  './assets/cards/JH.svg',
  './assets/cards/JS.svg',
  './assets/cards/KC.svg',
  './assets/cards/KD.svg',
  './assets/cards/KH.svg',
  './assets/cards/KS.svg',
  './assets/cards/QC.svg',
  './assets/cards/QD.svg',
  './assets/cards/QH.svg',
  './assets/cards/QS.svg',
  './assets/cards/back.svg',
  './assets/gold.png',
  './assets/icon-1024.png',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-1024.png',
  './assets/icon-maskable-512.png',
  './assets/icons/home.png',
  './assets/icons/horseshoe.png',
  './assets/icons/spade.png',
  './assets/logo.png',
  './assets/social.jpg',
  './assets/splash-1024.png',
  './assets/splash-512.png',
  './assets/star.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Added one at a time: addAll rejects the whole batch if any single request
      // fails, which would leave the game with no cache at all.
      .then((cache) => Promise.all(FILES.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first. Every file is static and the game must run with no connection at all.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
