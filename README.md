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

There are apps too, built with Flutter from one project: for Android (Material You by default,
with a remote that needs no wifi and an Updates page), for Wear OS watches (play, pause and the
speed on the crown), and for Windows, macOS and Linux (a command bar, a mini remote, shortcuts
from any app, and a glass look in each system's own style). Downloads are on the
[latest release](https://github.com/augy-studios/uwuPromptr/releases/latest), and
[Privacy](https://cue.uwuapps.org/privacy) says what's kept: your scripts stay on your device.

It follows the feature set of [promptr.tv](https://promptr.tv)
([source](https://github.com/manifestinteractive/teleprompter)), with finer
control over speed and font size and a remote that needs no server of ours.

## Repository layout

```text
main-site/                 the website, deployed as a static site on Vercel, with a few functions
                           (TURN credentials, the app's releases, Report a bug, the release push)
flutter/                   the Android, Wear OS, Windows, macOS and Linux apps (flutter/README.md)
release/                   the APKs and the App Bundle, one folder per version, and how to publish
announcements/             release notes for GitHub and Google Play, and Telegram announcements
docs/                      the specs the site and the apps follow, and the store's screenshots
scripts/                   bug-report-test.mjs, Report a bug's API tested without Telegram
.github/workflows/         builds the desktop installers onto the GitHub release
turn-server/               optional coturn relay, for pairing across networks
GOOGLE-PLAY.md             putting the Android app on Google Play
BUG-REPORT-SETUP.md        the Telegram bot that Report a bug sends through
CODE_OF_CONDUCT.md
LICENSE                    MIT
```

`flutter/README.md` covers the apps: what's where, building the signed APK and App Bundle with
one command, and the Playwright suite. `flutter/FIREBASE-SETUP.md` sets up New version alerts,
and `flutter/android/wear/README.md` covers the watch app. `release/README.md` is how to publish
a version.

`main-site/README.md` covers the website: what is in each file, the keyboard shortcuts, how the
theme works, and what to do before a deploy. `main-site/.env.example` lists its environment
variables, all optional.

## The specs

The specs in `docs/` are shared with the other UwU Apps projects, and they are the source of
truth for the parts they cover. When one of them changes, the site and the apps follow it.

- **`uwuapps-theme.md`**, **`uwuapps-retrofit-time-mode.md`**: seven brand colours and three mode
  settings (light, dark, follow the clock). `main-site/css/theme.css` and `js/theme.js` are copied
  from it; the apps' `lib/theme/theme.dart` reads the same keys.
- **`update-bar-spec.md`**: the bar that appears when a new version of the site is waiting.
- **`edge-tray-spec.md`**: the prompter's three Edge Trays.
- **`page-tour-spec.md`**: the first-visit tours, on the site and in the apps.
- **`STUN-p2p-spec.md`**: pairing devices without a server of ours.
- **`flutter-android-app-spec.md`**, **`flutter-desktop-app-spec.md`**,
  **`desktop-features-spec.md`**: what the apps are and how they're built.

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
the theme, the service worker, the update bar or the tours, check the change
against the relevant spec in `docs/`: those are shared with other projects,
and a change that only suits this app belongs in the app rather than in the
spec. A change to the site's features belongs in the apps too
(`flutter/PORTING.md`).

## Licence

MIT, see `LICENSE`.
