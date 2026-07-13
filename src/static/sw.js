/* IncidentGIS service worker — modern caching strategy */
const VERSION = "v2-2026-07-05";
const PRECACHE = `incidentgis-precache-${VERSION}`;
const RUNTIME = `incidentgis-runtime-${VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/assets/css/styles.css",
  "/assets/js/main.js",
  "/assets/icons/logo.svg",
  "/assets/icons/favicon.svg",
  "/assets/icons/favicon-32.png",
  "/assets/icons/favicon-16.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const allowed = new Set([PRECACHE, RUNTIME]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !allowed.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isNavigation(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // ignore cross-origin

  // Navigations: network-first with cache fallback (offline shell)
  if (isNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (/\.(?:css|js|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const cached = await cache.match(request);
        const fetched = fetch(request)
          .then((response) => {
            if (response && response.status === 200) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }

  // Default: try cache then network
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
