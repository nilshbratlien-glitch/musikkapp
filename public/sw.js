const CACHE = "musikkapp-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

function isAsset(url) {
  if (url.pathname === "/sw.js") return false;
  return url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
}

async function putIfOk(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || fetch(event.request))),
    );
    return;
  }

  if (!SHELL.includes(url.pathname) && !isAsset(url)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        putIfOk(event.request, response);
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || fetch(event.request))),
  );
});
