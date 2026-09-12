const CACHE = 'frontier-poker-v1';

const PRECACHE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/engine.js",
  "./js/ai.js",
  "./js/guide.js",
  "./js/career.js",
  "./fonts/SS4.woff2",
  "./fonts/SS4reg.woff2",
  "./manifest.json",
  "./assets/logo.png",
  "./assets/gold.png",
  "./assets/star.png",
  "./assets/icons/home.png",
  "./assets/icons/spade.png",
  "./assets/icons/horseshoe.png",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/avatars/alice.png",
  "./assets/avatars/bat.png",
  "./assets/avatars/bill.png",
  "./assets/avatars/doc.png",
  "./assets/avatars/jane.png",
  "./assets/cards/10C.svg",
  "./assets/cards/10D.svg",
  "./assets/cards/10H.svg",
  "./assets/cards/10S.svg",
  "./assets/cards/2C.svg",
  "./assets/cards/2D.svg",
  "./assets/cards/2H.svg",
  "./assets/cards/2S.svg",
  "./assets/cards/3C.svg",
  "./assets/cards/3D.svg",
  "./assets/cards/3H.svg",
  "./assets/cards/3S.svg",
  "./assets/cards/4C.svg",
  "./assets/cards/4D.svg",
  "./assets/cards/4H.svg",
  "./assets/cards/4S.svg",
  "./assets/cards/5C.svg",
  "./assets/cards/5D.svg",
  "./assets/cards/5H.svg",
  "./assets/cards/5S.svg",
  "./assets/cards/6C.svg",
  "./assets/cards/6D.svg",
  "./assets/cards/6H.svg",
  "./assets/cards/6S.svg",
  "./assets/cards/7C.svg",
  "./assets/cards/7D.svg",
  "./assets/cards/7H.svg",
  "./assets/cards/7S.svg",
  "./assets/cards/8C.svg",
  "./assets/cards/8D.svg",
  "./assets/cards/8H.svg",
  "./assets/cards/8S.svg",
  "./assets/cards/9C.svg",
  "./assets/cards/9D.svg",
  "./assets/cards/9H.svg",
  "./assets/cards/9S.svg",
  "./assets/cards/AC.svg",
  "./assets/cards/AD.svg",
  "./assets/cards/AH.svg",
  "./assets/cards/AS.svg",
  "./assets/cards/JC.svg",
  "./assets/cards/JD.svg",
  "./assets/cards/JH.svg",
  "./assets/cards/JS.svg",
  "./assets/cards/KC.svg",
  "./assets/cards/KD.svg",
  "./assets/cards/KH.svg",
  "./assets/cards/KS.svg",
  "./assets/cards/QC.svg",
  "./assets/cards/QD.svg",
  "./assets/cards/QH.svg",
  "./assets/cards/QS.svg",
  "./assets/cards/back.svg"
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Cache-first: all game resources are static so the PWA can run offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;

      return fetch(e.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
