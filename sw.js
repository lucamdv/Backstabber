const CACHE_NAME = "backstabber-shell-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./game.html",
  "./manifest.webmanifest",
  "./version.json",
  "./css/style-index.css",
  "./css/style-game.css",
  "./css/oracle.css",
  "./css/mobile-index.css",
  "./css/mobile-game.css",
  "./js/setup.js",
  "./js/runtime-performance.js",
  "./js/classes.js",
  "./js/engine.js",
  "./js/oracle.js",
  "./js/pwa.js",
  "./images/isologo.png",
  "./images/isotipo.png",
  "./images/icon-192.png",
  "./images/icon-512.png",
  "./images/menu.png",
  "./images/playmat.png",
  "./images/playmat_mobile.png",
  "./images/verso_card.png",
  "./images/magnata_card.png",
  "./images/executor_card.png",
  "./images/sentinela_card.png",
  "./images/mercenario_card.png",
  "./images/broker_card.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("backstabber-") && key !== CACHE_NAME)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (fallbackUrl && cache.match(fallbackUrl));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.destination === "video") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  if (["script", "style"].includes(request.destination) || url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
