/*
 * Offline support for the ringtone studio.
 *
 * Cutting a ringtone is pure Web Audio work in the page, so once the page
 * itself is cached there is nothing left that needs the network. The AI vocal
 * separation is the exception: it pulls its runtime from a CDN on demand, and
 * cross-origin requests are left on the default path untouched.
 */

const VERSION = "v1";
const CACHE = `ringtones-${VERSION}`;
const SHELL = ["./", "./index.html", "./profile.js", "./favicon.svg", "./manifest.webmanifest", "./icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One missing entry should not fail the whole install.
      Promise.all(
        SHELL.map((path) =>
          cache.add(new Request(path, { cache: "reload" })).catch(() => undefined),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("ringtones-") && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** HTML: fresh when online, the last good copy when not. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put("./index.html", response.clone());
    }
    return response;
  } catch (error) {
    const cached = (await caches.match("./index.html")) ?? (await caches.match("./"));
    if (cached) return cached;
    throw error;
  }
}

/** The script and the artwork: instant from cache, refreshed in the background. */
async function handleAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    })
    .catch((error) => {
      if (cached) return cached;
      throw error;
    });
  return cached ?? network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // A partial response must not be cached or replayed as the whole file.
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL("./", self.location.href).pathname)) return;

  event.respondWith(request.mode === "navigate" ? handleNavigation(request) : handleAsset(request));
});
