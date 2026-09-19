// uwuPromptr service worker.
//
// This worker never takes over on its own. It installs, then waits, and the
// only thing that promotes it is somebody pressing Reload in the update bar.
// That is why there is no skipWaiting() in install and no clients.claim() in
// activate: both of those do silently what the bar exists to ask about.
//
// VERSION is the trigger for the whole update prompt. The browser compares
// this file byte for byte, so if it has not changed there is no update to
// prompt about however much else in the build has moved.
//
// It is a plain integer, counting up by one. Bump it in the same change as
// any edit to anything the worker serves, never as a separate tidy-up
// afterwards: a version left behind is an update bar nobody ever sees.
const VERSION = 2;
const CACHE = `uwuPromptr-${VERSION}`;

// Everything the app needs to boot and run with no network at all. The
// remote pairing library is deliberately absent: it is fetched from a CDN
// only when somebody opens the remote panel, and the prompter works without
// it.
const ASSETS = [
  "/",
  "/index.html",
  "/remote.html",
  "/404.html",
  "/404.css",
  "/css/theme.css",
  "/css/app.css",
  "/js/app.js",
  "/js/remote-page.js",
  "/js/theme.js",
  "/js/icons.js",
  "/js/ui.js",
  "/js/storage.js",
  "/js/prompter.js",
  "/js/remote.js",
  "/js/qr.js",
  "/js/sw-update.js",
  "/UPC-192.png",
  "/UPC-512.png",
  "/favicon.ico",
  "/manifest.json",
];

/* -- Install: cache the shell, then wait -- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One miss must not fail the whole install and leave the app with no
      // worker, so each asset is added on its own.
      Promise.all(
        ASSETS.map((asset) =>
          cache.add(asset).catch((cause) => {
            console.warn("sw: could not cache", asset, cause);
          })
        )
      )
    )
  );
});

/* -- Activate: clean old caches -- */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

/* -- Message: the one place skipWaiting is ever called -- */

self.addEventListener("message", (event) => {
  const type = typeof event.data === "string" ? event.data : event.data?.type;

  if (type === "skip-waiting") {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

/* -- Fetch: strategy per route -- */

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that is not a plain GET is not ours to cache or replay.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin: analytics, and the PeerJS library and its broker. None of
  // it belongs in the app cache, and a stale copy of any of it is worse than
  // no copy, so it goes straight to the network.
  if (url.origin !== self.location.origin) {
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
      event.respondWith(cacheFirst(request));
    }
    return;
  }

  // The app shell is small and versioned by the cache name, so a navigation
  // is served from the cache and the network is only the fallback. This is
  // what makes the prompter open with no connection.
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  // API - network-first
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

/* -- Strategies -- */

async function navigationHandler(request) {
  const url = new URL(request.url);
  // cleanUrls in vercel.json serves /remote from remote.html, so both
  // spellings have to land on the same cached document. Matching only the
  // clean one sends an offline visitor to /remote.html the prompter instead.
  const path = url.pathname.replace(/\/$/, "");
  const target = path === "/remote" || path === "/remote.html" ? "/remote.html" : "/index.html";

  const cached = await caches.match(target);
  if (cached) return cached;

  try {
    return await fetch(request);
  } catch {
    const fallback = await caches.match("/index.html");
    return fallback || new Response("Offline", { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "You appear to be offline." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque cross-origin responses have a status of 0 and are still worth
    // keeping for the fonts; anything else has to have succeeded.
    if (response.ok || response.type === "opaque") {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}
