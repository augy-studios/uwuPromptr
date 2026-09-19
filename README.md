# uwuPromptr

A teleprompter that works offline, at [cue.uwuapps.org](https://cue.uwuapps.org).

Write a script, press space, and it scrolls. Speed and font size adjust a
step at a time while it runs, you can keep as many scripts as you like and
switch between them, and a second device can drive the whole thing over a six
character pairing code.

**The remote needs both devices on the same network.** The same wifi, or a
mobile hotspot shared from one to the other, which is the reliable way to do it
anywhere. `main-site/README.md` explains why, and `turn-server/` has the
optional relay that would lift the restriction.

It follows the feature set of [promptr.tv](https://promptr.tv)
([source](https://github.com/manifestinteractive/teleprompter)), with finer
control over speed and font size and a remote that needs no server of ours.

## Repository layout

```text
main-site/                 the app, deployed as a static site on Vercel
turn-server/               optional coturn relay, for pairing across networks
uwuapps-theme.md           theme system spec, shared across UwU Apps
uwuapps-retrofit-time-mode.md  how time-based mode was added to it
update-bar-spec.md         the update prompt bar spec
CODE_OF_CONDUCT.md
LICENSE                    MIT
```

`main-site/README.md` covers the app itself: what is in each file, the
keyboard shortcuts, how the theme works, and what to do before a deploy.

## The three specs

The files at the root are portable specs shared with the other UwU Apps
projects, and they are the source of truth for the parts of the app they
cover. When one of them changes, the app follows it, not the other way round.

- **`uwuapps-theme.md`** defines seven brand colours and three mode settings
  (light, dark, and follow the clock) that combine into fourteen valid
  looks. `main-site/css/theme.css` and `main-site/js/theme.js` are copied
  from it, with only the storage key changed.
- **`uwuapps-retrofit-time-mode.md`** is the procedure for adding the
  time-based mode option, and records why the daylight hours are duplicated
  in the pre-paint script in every `<head>`.
- **`update-bar-spec.md`** defines the bar that appears when a new version
  has downloaded and is waiting. The rule the whole thing rests on is that a
  new service worker never activates on its own.

## Running it locally

There is no build step and there are no dependencies to install. Serve
`main-site/` over HTTP and open it:

```bash
cd main-site
python -m http.server 8000
```

A service worker needs a secure context, so use `localhost` rather than a LAN
IP, or the worker and the update bar will not register.

## Contributing

Please read `CODE_OF_CONDUCT.md`. Before opening a pull request that touches
the theme, the service worker, or the update bar, check the change against
the relevant spec above: those three are shared with other projects, and a
change that only suits this app belongs in the app rather than in the spec.

## Licence

MIT, see `LICENSE`.
