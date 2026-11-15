const CACHE = "musikkapp-shell-v8";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];
const PDFJS_CDN_PREFIX = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";

function isAsset(url) {
  if (url.pathname === "/sw.js") return false;
  return url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs") || url.pathname.endsWith(".css");
}

async function putIfOk(request, response) {
  if (!response || !response.ok || response.redirected) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            const response = await fetch(path);
            if (response.ok && !response.redirected) await cache.put(path, response);
          } catch {
            /* En feilet fil skal ikke stoppe installasjonen. */
          }
        }),
      );
      await self.skipWaiting();
    })(),
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
  const isPinnedPdfJs = url.href.startsWith(PDFJS_CDN_PREFIX);
  if (url.origin !== self.location.origin && !isPinnedPdfJs) return;

  if (isPinnedPdfJs) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            putIfOk(event.request, response);
            return response;
          }),
      ),
    );
    return;
  }

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
