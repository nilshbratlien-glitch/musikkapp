const CACHE = "musikkapp-offline-v1";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/malletsight/markup.html",
  "/malletsight/app.css",
  "/malletsight/abcjs.js",
  "/malletsight/theory.js",
  "/malletsight/generator.js",
  "/malletsight/renderer.js",
  "/malletsight/audio.js",
  "/malletsight/app.js",
];
const PDFJS_CDN_PREFIX = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";
const PDF_LIB_CDN_PREFIX = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/";
const PRECACHE_CDN_URLS = [
  `${PDFJS_CDN_PREFIX}build/pdf.min.js`,
  `${PDFJS_CDN_PREFIX}build/pdf.worker.min.js`,
  `${PDF_LIB_CDN_PREFIX}dist/pdf-lib.min.js`,
];

function isAsset(url) {
  if (url.pathname === "/sw.js" || url.pathname === "/offline-manifest.json") return false;
  return url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs") || url.pathname.endsWith(".css");
}

function isPinnedCdn(href) {
  return href.startsWith(PDFJS_CDN_PREFIX) || href.startsWith(PDF_LIB_CDN_PREFIX);
}

async function putIfOk(request, response) {
  if (!response || !response.ok || response.redirected) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

async function fetchManifestAssets() {
  try {
    const res = await fetch("/offline-manifest.json", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.assets)) return null;
    return data.assets.filter((item) => typeof item === "string" && item.startsWith("/"));
  } catch {
    return null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const manifestAssets = await fetchManifestAssets();
      const immutableUrls = [...(manifestAssets ?? []), ...PRECACHE_CDN_URLS];

      await Promise.all([
        ...SHELL.map(async (path) => {
          try {
            const response = await fetch(path, { cache: "no-cache" });
            if (response.ok && !response.redirected) await cache.put(path, response);
          } catch {
            /* En feilet fil skal ikke stoppe installasjonen. */
          }
        }),
        ...immutableUrls.map(async (url) => {
          try {
            const existing = await cache.match(url);
            if (existing) return;
            const response = await fetch(url);
            if (response.ok && !response.redirected) await cache.put(url, response);
          } catch {
            /* En feilet fil skal ikke stoppe installasjonen. */
          }
        }),
      ]);

      if (manifestAssets) {
        const keep = new Set(manifestAssets);
        const keys = await cache.keys();
        await Promise.all(
          keys.map((req) => {
            const pathname = new URL(req.url).pathname;
            if (pathname.startsWith("/assets/") && !keep.has(pathname)) {
              return cache.delete(req);
            }
            return Promise.resolve(false);
          }),
        );
      }

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
  const pinnedCdn = isPinnedCdn(url.href);
  if (url.origin !== self.location.origin && !pinnedCdn) return;

  if (pinnedCdn) {
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

  if (url.pathname.startsWith("/assets/")) {
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

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        putIfOk(event.request, response);
        return response;
      })
      .catch(() =>
        caches
          .match(event.request, { ignoreSearch: url.pathname.startsWith("/malletsight/") })
          .then((cached) => cached || fetch(event.request)),
      ),
  );
});
