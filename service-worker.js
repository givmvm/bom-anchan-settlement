const CACHE_NAME = "couple-ledger-v14";
const ASSETS = [
  "./", "./index.html", "./styles.css?v=14", "./script.js?v=14",
  "./sync-engine.js?v=14", "./sync-config.js?v=14", "./manifest.webmanifest?v=14",
  "./apple-touch-icon.png?v=14", "./icon-192.png?v=14", "./icon-512.png?v=14",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("couple-ledger-") && key !== CACHE_NAME).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Cloud requests must reach the network directly, never the app shell or cache.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () =>
      (await caches.match("./index.html")) || Response.error()));
    return;
  }
  if (!ASSETS.some((asset) => new URL(asset, self.registration.scope).href === url.href)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
    (await cache.match(event.request)) || fetch(event.request)));
});
