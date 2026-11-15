// The website (main-site/) on 47392, as Vercel serves it: clean addresses (/remote is
// remote.html), and /api/turn-credentials answering with no relay, as an unconfigured site does.
// For tests/remote.spec.js, which pairs the app with the site's own prompter and remote.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../main-site");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/turn-credentials") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, data: { iceServers: [], relay: false } }));
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  if (path === "") path = "index.html";
  let file = resolve(root, path);
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  try {
    if (!extname(file)) file += ".html";
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
}).listen(47392, "127.0.0.1", () => console.log(`${root} on 47392`));
