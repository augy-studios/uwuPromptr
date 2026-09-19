# uwuPromptr

Teleprompter PWA at [cue.uwuapps.org](https://cue.uwuapps.org). Follows the
feature set of [promptr.tv](https://promptr.tv)
([source](https://github.com/manifestinteractive/teleprompter)), with finer
control and a peer to peer remote.

## What it does

- **Scrolls a script** at a speed you set, with a timer, a reading guide, and
  both mirror axes for anyone shooting through glass.
- **Granular speed and font size.** Font moves a pixel at a time, speed a
  tenth at a time, rather than the whole steps the reference app uses. Hold
  shift for bigger jumps.
- **Multiple scripts**, switched from the menu in the top bar. Everything is
  kept on the device, and nothing is uploaded.
- **Remote control** from another device at `/remote?id=CODE`, paired by a six
  character code or the QR code next to it.
- **Works offline.** Once it has been opened, the prompter needs no connection
  to open, scroll, save or edit. Only pairing a remote needs the network.

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
css/theme.css    the uwuapps theme system, per uwuapps-theme.md
css/app.css      prompter layout, the update bar, and the remote page
js/theme.js      7 brand colours, light/dark/time-based mode
js/prompter.js   scrolling, the clock, the settings that shape the read
js/storage.js    scripts and settings, all in localStorage
js/remote.js     both ends of the remote, over WebRTC
js/qr.js         QR encoder, so pairing codes work with no network
js/sw-update.js  the update prompt bar, per update-bar-spec.md
js/app.js        the prompter page
js/remote-page.js the remote page
sw.js            service worker: caches the shell, and waits
```

## Theme

Two axes that combine freely: seven brand colours and light/dark/time-based
mode, per `uwuapps-theme.md` at the repo root. The brand colour drives the
prompter itself:

- **Light mode:** the brand colour is the background, the text is near-black.
- **Dark mode:** the background is near-black, the text is the brand colour.

Time-based mode follows the device clock, light from 09:00 to 18:00. The two
hours appear both in `js/theme.js` and in the pre-paint script in each
`<head>`, and have to be changed together.

## Deploying

**Bump `VERSION` in `sw.js` on every deploy.** It is the trigger for the whole
update prompt: the browser compares the worker byte for byte, so a version
left alone is an update bar nobody ever sees.

The worker deliberately never calls `skipWaiting()` outside its message
handler and never calls `clients.claim()` on activate. A new version installs,
waits, and only takes over when somebody presses Reload in the update bar.

The `/api` folder is for Vercel serverless functions and is unused; remove it
if it stays that way.
