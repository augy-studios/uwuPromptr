// Checks sw.js's PRECACHE list against what is actually on disk.
//
//   node check-precache.js
//
// The list is written by hand, which is the right trade for a site this size,
// but a hand-written list drifts in two directions and neither announces
// itself:
//
//   an entry with no file    the install logs a warning nobody reads, and one
//                            page or module is quietly missing offline
//   a file with no entry     it works online and vanishes offline, which is
//                            the failure that only shows up on a train
//
// No dependencies, like the rest of this site.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// Addresses the worker precaches that are not a file on disk of the same name.
// cleanUrls means "/" is served from index.html.
const ALIASES = new Map([["/", "index.html"]]);

// Shipped files that are deliberately not precached, with the reason. Anything
// here is a decision; anything not here and not precached is a finding.
const DELIBERATELY_ABSENT = new Map([
  ["/sw.js", "The worker itself. Caching it is how a worker becomes unreplaceable."],
  ["/UPC-main.png", "The og:image. Only a crawler ever fetches it."],
  ["/vercel.json", "Build configuration. Vercel reads it; the browser never asks for it."],
  ["/browserconfig.xml", "Old Windows tile metadata, fetched by nothing the app runs."],
  ["/robots.txt", "For crawlers, which are never offline."],
  ["/check-precache.js", "This checker. Not part of the site."],
  ["/js/icons.test.mjs", "A test. Not part of the site."],
]);

// Directories whose contents are not part of the app shell.
const SKIP_DIRS = new Set(["node_modules", ".git", ".well-known", "images", "api"]);

const CACHEABLE = /\.(html|css|js|mjs|json|png|ico|svg|woff2?|xml|txt)$/;

function readPrecache() {
  const source = readFileSync(join(root, "sw.js"), "utf8");
  const block = source.match(/const PRECACHE = \[([\s\S]*?)\n\];/);
  if (!block) {
    console.error("check-precache: could not find the PRECACHE list in sw.js.");
    process.exit(1);
  }
  // Entries only, not the prose: strip comments before reading the strings.
  const withoutComments = block[1].replace(/\/\/.*$/gm, "");
  return [...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push("/" + relative(root, full).split(sep).join("/"));
  }
  return out;
}

const precache = readPrecache();
const onDisk = walk(root).filter((path) => CACHEABLE.test(path));

const problems = [];

// 1. Every entry has a file behind it.
for (const entry of precache) {
  const file = ALIASES.get(entry) ?? entry.replace(/^\//, "");
  if (!existsSync(join(root, file))) {
    problems.push(`precached but not on disk: ${entry}`);
  }
}

// 2. Every shipped file is either precached or deliberately absent.
const precached = new Set(precache.map((entry) => ALIASES.get(entry) ? "/" + ALIASES.get(entry) : entry));
for (const file of onDisk) {
  if (precached.has(file)) continue;
  if (DELIBERATELY_ABSENT.has(file)) continue;
  problems.push(
    `on disk but not precached: ${file}\n` +
    `      Add it to PRECACHE in sw.js, or to DELIBERATELY_ABSENT here with the reason.`
  );
}

// 3. No duplicates, which would fetch the same file twice on install.
const seen = new Set();
for (const entry of precache) {
  if (seen.has(entry)) problems.push(`listed twice in PRECACHE: ${entry}`);
  seen.add(entry);
}

if (problems.length > 0) {
  console.error("check-precache found problems:\n");
  for (const problem of problems) console.error("  - " + problem);
  console.error("");
  process.exit(1);
}

console.log(
  `check-precache: ${precache.length} entries, all present, ` +
  `and every shipped file is accounted for.`
);
