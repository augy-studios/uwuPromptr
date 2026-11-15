// The newest version of the Android app, for its updater, and every version
// before it, for the Flutter app's Updates page.
//
//   GET /api/app-release
//   { version, apk, size, sha256, page, date, notes, history }
//   or { version: null, history: [] }
//
// `history` is every release, newest first, each { version, date, notes, page }.
// The 1.0.0 WebView app reads only the first five fields, which keep their
// meaning.
//
// Read from GitHub Releases: not a draft, not a pre-release, tagged
// android-v<version>, with an .apk that has finished uploading. Cached at the
// edge for ten minutes, so GitHub sees one request every ten minutes however
// many phones ask. ?v=<version> is ignored, but as a different address it gets
// past the cache: the app adds it when a notification says a release went out
// seconds ago.

import { allReleases } from "./_lib/release.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Use GET." });
  }

  try {
    const releases = await allReleases();
    const history = releases.map(({ version, date, notes, page }) => ({ version, date, notes, page }));
    response.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    // The app's browser build (its Playwright suite) asks from another origin.
    response.setHeader("Access-Control-Allow-Origin", "*");
    return response.status(200).json(releases[0] ? { ...releases[0], history } : { version: null, history });
  } catch (cause) {
    // Not cached: the next phone to ask should try GitHub again.
    response.setHeader("Cache-Control", "no-store");
    console.warn("app-release:", cause?.message ?? cause);
    return response.status(502).json({ error: "Could not reach GitHub." });
  }
}
