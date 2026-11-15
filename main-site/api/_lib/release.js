// The Android app's releases on GitHub, shared by /api/app-release (the app's
// updater and its Updates page) and the release webhook. Not a function itself:
// Vercel skips files under a folder that starts with an underscore.

export const REPO = "augy-studios/uwuPromptr";
export const TAG_PREFIX = "android-v";

const VERSION = /^\d+(\.\d+){0,3}$/;

/**
 * Whether version `a` is later than `b`, number by number, so 1.10.0 comes
 * after 1.9.0. The same rule as js/app-update.js and the Flutter app's
 * newerVersion() (flutter/lib/features/update/update_bar.dart).
 */
export function isNewer(a, b) {
  const x = String(a ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  const y = String(b ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p > q;
  }
  return false;
}

/**
 * What a release offers the updater, or null if it offers nothing: a draft, a
 * pre-release, a tag the updater does not read, or no APK finished uploading.
 */
export function describeRelease(release) {
  if (!release || release.draft || release.prerelease) return null;

  const tag = String(release.tag_name ?? "");
  if (!tag.startsWith(TAG_PREFIX)) return null;
  const version = tag.slice(TAG_PREFIX.length);
  if (!VERSION.test(version)) return null;

  // The phone's APK. The Wear OS watch's, -watch.apk, sits beside it on the
  // same release and is never offered to a phone: it would not install there.
  const apk = (release.assets ?? []).find(
    (asset) =>
      asset?.state === "uploaded" &&
      /\.apk$/i.test(asset?.name ?? "") &&
      !/-watch\.apk$/i.test(asset?.name ?? "")
  );
  if (!apk) return null;

  // GitHub gives each asset a digest, "sha256:<hex>". The updater checks the
  // download against it before installing.
  const digest = String(apk.digest ?? "");
  const sha256 = digest.startsWith("sha256:") ? digest.slice("sha256:".length).toLowerCase() : null;

  return {
    version,
    apk: apk.browser_download_url,
    size: apk.size ?? null,
    sha256,
    page: release.html_url ?? null,
    // For the Updates page: when it came out, and its notes as plain lines, the
    // bold, code and link markup taken out (headings and bullets kept).
    date: release.published_at ?? null,
    notes: plain(release.body),
  };
}

function plain(body) {
  return String(body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/** Every release worth offering, newest first, from the newest hundred. */
export async function allReleases() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "uwuPromptr-release-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional. Unauthenticated, GitHub allows 60 requests an hour per address;
  // the cache in front of this makes that one every ten minutes regardless.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

  const list = await response.json();
  return (Array.isArray(list) ? list : [])
    .map(describeRelease)
    .filter(Boolean)
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0));
}

/** The highest released version. */
export async function latestRelease() {
  return (await allReleases())[0] ?? null;
}
