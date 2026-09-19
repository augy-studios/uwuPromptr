# uwuPromptr

The app itself: a static site, deployed to [cue.uwuapps.org](https://cue.uwuapps.org)
on Vercel. No build step, no dependencies, no backend.

For the repository as a whole, and for the three specs this app follows, see
the [root README](../README.md).

## What it does

- **Scrolls a script** at a speed you set, with a timer, a reading guide, and
  both mirror axes for anyone shooting through glass.
- **Granular speed and font size.** Font moves a pixel at a time, speed a
  tenth at a time, rather than the whole steps the reference app uses. Hold
  shift for bigger jumps.
- **Multiple scripts**, switched from the menu in the top bar.
- **Remote control** from another device at `/remote?id=CODE`, paired by a six
  character code or the QR code beside it.
- **Works offline.** Once it has been opened once, the prompter needs no
  connection to open, scroll, save, or edit.

## Keyboard

| Key | Does |
| --- | --- |
| Space, B, period | Start and stop |
| Up, Down | Font size |
| Left, Right, Page Up, Page Down | Speed |
| Shift with any of the above | Bigger steps |
| F | Fullscreen |
| Escape | Reset to the top, or close a modal |

## Layout

```text
css/theme.css       the uwuapps theme system, per uwuapps-theme.md
css/app.css         prompter layout, the update bar, and the remote page
js/theme.js         7 brand colours, light/dark/time-based mode
js/icons.js         inline SVG icons, hydrated from data-icon
js/ui.js            modals, icon hydration, toasts
js/prompter.js      scrolling, the clock, the settings that shape the read
js/storage.js       scripts and settings, all in localStorage
js/remote.js        both ends of the remote, over WebRTC
js/qr.js            QR encoder, so pairing codes work with no network
js/sw-update.js     the update prompt bar, per update-bar-spec.md
js/app.js           the prompter page
js/remote-page.js   the remote page
sw.js               service worker: caches the shell, and waits
index.html          the prompter
remote.html         the remote, served at /remote by cleanUrls
api/                Vercel serverless functions. Empty and unused.
```

## Where the data lives

Everything is on the device, in `localStorage`, under the `uwupromptr.`
prefix: the scripts, which one is open, the prompter settings, and the theme.
Nothing is uploaded and there is no account to make.

The one thing that touches the network is pairing a remote. The two devices
find each other through the public PeerJS broker and then talk directly over
WebRTC, so a script never passes through a server. If the broker cannot be
reached, the remote is unavailable and the prompter carries on unchanged.

## Environment

**None.** There is nothing to configure in Vercel, no `.env` to create, and
no secrets. The site is static files, it has no backend, and no code here
reads an environment variable.

Two IDs are written into the HTML directly. Both are public, client-side
identifiers rather than secrets, and there is no build step that could
substitute them in from anywhere else:

| Value | Where | What it is |
| --- | --- | --- |
| `G-FMCYFTFPEL` | `index.html`, `remote.html`, `404.html` | Google Analytics measurement ID |
| `ca-pub-9715826188316382` | `404.html` | AdSense publisher ID |

To change either, edit the `<head>` of each page that carries it.

## Theme

Two axes that combine freely: seven brand colours and three mode settings,
per `uwuapps-theme.md` at the repository root. The brand colour drives the
prompter itself:

- **Light mode:** the brand colour is the background, the text is near-black.
- **Dark mode:** the background is near-black, the text is the brand colour.

Time-based mode follows the device clock, light from 09:00 up to but not
including 18:00. The two hours appear both in `js/theme.js`
(`LIGHT_FROM_HOUR`, `LIGHT_UNTIL_HOUR`) and in the pre-paint script in each
`<head>`, which cannot import anything and has to resolve the mode before
first paint. **Change them together.**

## Deploying

**Bump `VERSION` in `sw.js` whenever anything the worker serves changes.** It
is the trigger for the whole update prompt: the browser compares the worker
byte for byte, so a version left alone is an update bar nobody ever sees.
Treat forgetting as a build error rather than a habit.

It is a plain integer, counting up by one: `2`, then `3`. Not a semantic
version, because nothing here reads it as one. Bump it in the same change
that edits the HTML, CSS, or JavaScript, rather than as a tidy-up before a
deploy, which is the step that gets skipped.

The worker deliberately never calls `skipWaiting()` outside its message
handler, and never calls `clients.claim()` on activate. A new version
installs, waits, and only takes over when somebody presses Reload in the
update bar. Adding either call elsewhere to fix a caching complaint turns the
whole design into a silent mid-session takeover, which is what the bar exists
to prevent.

`vercel.json` sets `cleanUrls`, which is what serves `remote.html` at
`/remote`. The service worker maps both spellings to the same cached
document, so the remote opens offline either way.

## Checking a release by hand

The update bar cannot be verified by reading the code. It takes about two
minutes:

1. Open the site, let the worker install, confirm no bar.
2. Bump `VERSION` and deploy, or serve locally.
3. Reload once. The new worker downloads and waits. The bar appears.
4. Press **Not now**. The bar goes. Navigate to another page: it is back,
   because a new version is still ready.
5. Press **Reload**. The page reloads once and the bar is gone.
6. Confirm in devtools that the old worker is gone rather than still waiting.
7. Repeat with the tab left open across the deploy, which exercises the
   `updatefound` path rather than the already-waiting one. Both have to work.

Worth checking at the same time: with the network throttled to offline in
devtools, the prompter still opens, scrolls, and saves an edit.
