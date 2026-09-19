// uwuPromptr service worker.
//
// BUMP VERSION ON EVERY CHANGE TO THIS SITE. Not once per release, and not only
// when this file itself changes: any edit under main-site/ means a new build,
// and a worker that is not bumped keeps serving the previous one to everybody
// who has visited before. vercel.json serves this file with
// Cache-Control: max-age=0, must-revalidate so the browser will always fetch
// it, but the file has to actually differ for that to matter.
//
// ---------------------------------------------------------------------------
// What this file does, in the order the requests arrive
// ---------------------------------------------------------------------------
//
//   navigation to /remote or /remote.html   the cached remote shell
//   navigation to anything else             the cached prompter shell
//   /css/**, /js/**, icons, the manifest    cache first
//   Google Fonts                            cache first, kept across versions
//   /api/**                                 network only, never cached
//   any other cross origin request          not intercepted at all
//   anything that is not a GET              not intercepted at all
//
// On localhost every one of those becomes network first, so an edit shows up
// on reload rather than after a version bump. See IS_DEV.
//
// ---------------------------------------------------------------------------
// The four rules that are easy to break here
// ---------------------------------------------------------------------------
//
// **1. skipWaiting and clients.claim happen only when a person asks.** A new
// worker installs, then waits, and the update bar offers a reload. Neither call
// appears in install or activate. The page asks by posting `skip-waiting`, and
// that is the only route to either. Adding either one elsewhere to fix a
// caching complaint turns this into a silent mid-session takeover, which is the
// thing the bar exists to prevent.
//
// **2. A response carrying `private` or `no-store` never enters the cache.**
// Nothing this app serves is private today: there are no accounts and every
// script lives on the device. isCacheable() is here so that the day something
// does answer `no-store`, the cache does not quietly keep it anyway. Every
// write goes through it.
//
// **3. Nothing cross origin is cached except the font files.** The Cache API is
// per origin, and the PeerJS library and its broker are deliberately left to
// the network: a stale copy of a signalling library is worse than no copy. The
// fonts are the one exception, and they are versioned by URL by Google.
//
// **4. A missing precache entry costs one file, not the feature.** The list
// below is written by hand, and `node check-precache.js` fails on an entry that
// is not on disk, or on a shipped file nobody precaches. Belt and braces,
// because entries are added one at a time rather than through cache.addAll:
// with addAll a single bad path rejects the whole promise, the install fails,
// and every offline behaviour silently never turns on.
//
// ---------------------------------------------------------------------------
// The caches, and which of them survive a version bump
// ---------------------------------------------------------------------------
//
//   shell-{VERSION}   the precached app shell and static assets. Versioned,
//                     and dropped on activate. This is the update mechanism:
//                     a new VERSION is a new cache, filled from the network.
//   fonts             the self-hosted-by-Google font files. Not versioned:
//                     they are immutable and keyed by a URL that changes when
//                     they do, so re-fetching them on every deploy would cost
//                     a flash of unstyled text for nothing.
//
// VERSION is a plain integer, counting up by one. Not a semantic version:
// nothing reads it as one, and it exists only so the browser sees this file
// differ byte for byte.
const VERSION = 10;

const SHELL = `uwuPromptr-shell-${VERSION}`;
const FONTS = "uwuPromptr-fonts";

// Anything not in here is deleted on activate. An allowlist rather than "delete
// everything that is not the current shell", because the font cache has to
// survive an update, and because deleting every cache on the origin would take
// the other uwuapps sites' caches with it if they ever share one.
const KEEP = new Set([SHELL, FONTS]);

// On localhost the worker goes to the network first and falls back to the
// cache. Cache-first there means every edit is invisible until VERSION is
// bumped, with no update bar to explain why, which is a long way to travel to
// find out you changed a file. Deployed origins are unaffected and stay
// cache-first, which is what makes the app open offline.
const IS_DEV =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.hostname === "[::1]";

/* -------------------------------------------------------------------------
 * The precache list
 *
 * **Written by hand and checked by node check-precache.js.**
 *
 * These are the addresses the browser asks for, not the files on disk.
 * cleanUrls is on, so /remote and /remote.html both answer, and the worker maps
 * both onto the one cached document.
 *
 * The PeerJS library is deliberately absent. It is fetched from a CDN only when
 * somebody opens the remote panel, and the prompter works without it: pairing
 * needs a connection anyway, so caching the library would buy nothing and a
 * stale signalling library is worse than none.
 *
 * UPC-main.png is absent for a different reason: it is the og:image, which only
 * a crawler ever fetches.
 * ---------------------------------------------------------------------- */

const PRECACHE = [
  // The two documents, and the address the launcher opens.
  "/",
  "/index.html",
  "/remote.html",
  // Served by Vercel for an unknown path. Precached so that an offline reader
  // who follows a dead link gets the real page rather than a browser error.
  "/404.html",
  "/404.css",

  // Styles.
  "/css/theme.css",
  "/css/app.css",

  // Every module. A precached page whose module is missing is a page that
  // renders its markup and then does nothing, which is worse than not caching
  // the page at all.
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

  // The icons the interface itself uses, and the manifest.
  "/UPC-192.png",
  "/UPC-512.png",
  "/favicon.ico",
  "/manifest.json",
];

/* -------------------------------------------------------------------------
 * Install and activate
 * ---------------------------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(fillShell());
  // No skipWaiting. The new worker waits until somebody accepts the update
  // prompt. Everything below is written to be correct while a previous version
  // is still the one in control.
});

/**
 * Fetch every precache entry into the shell cache, one at a time.
 *
 * `cache.addAll` would be shorter and is the wrong shape: it rejects as a whole
 * on the first bad entry, the install fails, and every offline behaviour is
 * silently off. This reports what it could not get and keeps the rest.
 *
 * `cache: 'reload'` on each request matters. Without it an install can be
 * populated out of the browser's own HTTP cache, so a worker bumped to a new
 * VERSION would fill its brand new cache with the previous build's files,
 * which is the exact failure the bump exists to prevent.
 */
async function fillShell() {
  const cache = await caches.open(SHELL);
  const failed = [];

  await Promise.all(
    PRECACHE.map(async (path) => {
      try {
        const response = await fetch(new Request(path, { cache: "reload" }));
        if (!response.ok) throw new Error(String(response.status));
        await cache.put(path, response);
      } catch (cause) {
        failed.push(`${path} (${cause?.message ?? cause})`);
      }
    })
  );

  if (failed.length > 0) {
    console.warn(
      `[uwuPromptr] ${failed.length} of ${PRECACHE.length} precache entries ` +
        `could not be stored. Offline is degraded, not off:\n  ${failed.join("\n  ")}`
    );
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key)));
    })()
  );
  // No clients.claim, for the same reason there is no skipWaiting above.
});

/* -------------------------------------------------------------------------
 * Talking to the page
 * ---------------------------------------------------------------------- */

self.addEventListener("message", (event) => {
  const data = event.data;
  const type = typeof data === "string" ? data : data?.type;

  // What is actually running, which is the only way a page can tell a worker
  // that did not update from one that did.
  //
  // Answered over the supplied MessageChannel port when there is one, so the
  // caller gets its own reply rather than every page on the origin hearing it,
  // and over event.source when there is not. Answering only one of the two is
  // a handshake that times out against exactly half of its callers.
  if (type === "version") {
    const reply = { type: "version", version: VERSION };
    const port = event.ports?.[0];
    if (port) port.postMessage(reply);
    else event.source?.postMessage(reply);
    return;
  }

  // The one way either of these is ever called. sw-update.js posts it when the
  // reader presses Reload, and reloads on controllerchange.
  if (type === "skip-waiting") {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

/* -------------------------------------------------------------------------
 * Fetch
 * ---------------------------------------------------------------------- */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Not intercepted at all. A write must never be replayed or answered from a
  // cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // A range request is a partial read of something already being streamed.
  // Answering one from a whole cached body is how audio and video break.
  if (request.headers.has("range")) return;

  // Cross origin. The fonts are cached because they are immutable and keyed by
  // a URL that changes when they do; everything else, which means analytics and
  // the PeerJS library and its broker, is left alone entirely.
  if (url.origin !== self.location.origin) {
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
      event.respondWith(cacheFirst(request, FONTS));
    }
    return;
  }

  event.respondWith(handle(request, url));
});

async function handle(request, url) {
  // Never cached, in either direction. There is nothing under /api/ today; this
  // is here so that adding something does not quietly inherit the shell's
  // cache-first rule.
  if (url.pathname.startsWith("/api/")) return networkOnly(request);

  if (request.mode === "navigate") return navigation(request, url);

  return IS_DEV ? networkFirst(request) : cacheFirst(request, SHELL);
}

/**
 * A navigation.
 *
 * The shell is served from the cache without asking the network, which is what
 * makes the prompter open with no connection. The update path is the VERSION
 * bump, not a revalidation on every page view.
 */
async function navigation(request, url) {
  // cleanUrls in vercel.json serves /remote from remote.html, so both spellings
  // have to land on the same cached document. Matching only the clean one sends
  // an offline visitor to /remote.html the prompter instead.
  const path = url.pathname.replace(/\/$/, "");
  const target = path === "/remote" || path === "/remote.html" ? "/remote.html" : "/index.html";

  // In development the freshest document wins, so an edit to the HTML shows up
  // on reload rather than after a version bump.
  if (IS_DEV) {
    try {
      return await fetch(request);
    } catch {
      const cached = await caches.match(target);
      return cached ?? offlineResponse();
    }
  }

  const cached = await caches.match(target);
  if (cached) return cached;

  try {
    return await fetch(request);
  } catch {
    // An address nobody precached, offline. The prompter shell is the honest
    // answer: it is the app, and it opens.
    const fallback = await caches.match("/index.html");
    return fallback ?? offlineResponse();
  }
}

/* -------------------------------------------------------------------------
 * Strategies
 * ---------------------------------------------------------------------- */

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "You appear to be offline." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

/** Development only. The cache is there so the app survives the dev server. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await store(SHELL, request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? offlineResponse();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) await store(cacheName, request, response.clone());
    return response;
  } catch {
    return offlineResponse();
  }
}

function offlineResponse() {
  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}

/* -------------------------------------------------------------------------
 * Writing to a cache
 * ---------------------------------------------------------------------- */

/**
 * Whether a response may be stored at all. **Every write goes through here.**
 *
 * Nothing this app serves answers `private` or `no-store` today, because there
 * are no accounts and nothing on the server knows who is asking. The test is
 * here so that the day something does, the cache does not keep it anyway: a
 * rule added after the fact has to find every write, and a rule added now has
 * only one place to live.
 */
function isCacheable(response) {
  if (!response) return false;

  // An opaque cross origin response has a status of 0 and cannot be inspected.
  // The font files arrive this way, and they are the one thing worth keeping
  // sight unseen: immutable, and keyed by a URL that changes when they do.
  if (response.type === "opaque") return true;

  if (response.status !== 200) return false;

  // basic is same origin. This also refuses a redirect that was followed, whose
  // body belongs to a different address than the one asked for.
  if (response.type !== "basic" && response.type !== "default") return false;
  if (response.redirected) return false;

  const control = (response.headers.get("Cache-Control") ?? "").toLowerCase();
  if (control.includes("no-store") || control.includes("private")) return false;

  const vary = (response.headers.get("Vary") ?? "").toLowerCase();
  if (vary === "*" || vary.includes("cookie")) return false;

  return true;
}

async function store(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
}
