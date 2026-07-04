const CACHE_NAME = "couple-ledger-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=11",
  "./script.js?v=11",
  "./sync-config.js?v=11",
  "./manifest.webmanifest?v=11",
  "./apple-touch-icon.png?v=11",
  "./icon-192.png?v=11",
  "./icon-512.png?v=11",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
