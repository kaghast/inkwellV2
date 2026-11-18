/* Inkwell service worker
 *
 * - Page navigations: network first; when offline, the offline page is shown.
 * - Built assets (/assets/*, content-hashed): cache first.
 * - Icons, manifest, fonts and the Leaflet stylesheet: stale-while-revalidate.
 * - API calls, uploaded files, map tiles and anything cross-origin else are never
 *   cached, so private note data does not end up in the browser cache.
 */
const VERSION = "v1";
const SHELL_CACHE = `inkwell-shell-${VERSION}`;
const ASSET_CACHE = `inkwell-assets-${VERSION}`;
const STATIC_CACHE = `inkwell-static-${VERSION}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE, STATIC_CACHE];
const OFFLINE_URL = "/offline.html";
const MAX_ASSETS = 80;

const SHELL_FILES = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("inkwell-") && !KEEP.includes(n)).map((n) => caches.delete(n)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
    trimCache(cacheName, MAX_ASSETS);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit || network;
}

async function networkFirstPage(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(OFFLINE_URL)) || new Response("Çevrimdışı", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Never cache private data or server-rendered OAuth pages
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/uploads/")) return;

    if (request.mode === "navigate") {
      event.respondWith(networkFirstPage(event));
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      event.respondWith(cacheFirst(request, ASSET_CACHE));
      return;
    }
    if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
      event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    }
    return;
  }

  // Fonts and the Leaflet stylesheet: fine to reuse offline
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com" ||
    (url.hostname === "unpkg.com" && url.pathname.startsWith("/leaflet@"))
  ) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});
