# Porting table

Each part of the site (`main-site/`), where it lives in the app, and how it stands. Storage keys,
script JSON, the remote's wire and its ids are the site's own throughout; `test/logic_test.dart`
checks the ported logic against answers worked out with the site's JavaScript, and
`e2e/tests/remote.spec.js` pairs the app with the site both ways.

| Site | App | Status |
|---|---|---|
| `js/storage.js` scripts, settings, ranges, defaults, the host's code | `lib/data/scripts.dart` | Done, the same keys and JSON |
| `js/prompter.js` scrolling, the clock, settings, flips, the wake lock | `lib/features/prompter/prompter.dart`, `lib/data/prompter_logic.dart` | Done. The wake lock is wakelock_plus on every platform |
| `index.html` the stage, focus arrows, editor, transport, top bar | `lib/features/prompter/prompter_screen.dart`, `editor.dart` | Done |
| `js/edge-tray.js` the three trays, their keys, the side's edge | `lib/features/prompter/trays.dart`, `prompter_screen.dart` | Done |
| `js/app.js` scripts menu, settings, keyboard, chrome hiding, revisions, remote edits | `lib/features/prompter/session.dart`, `scripts_sheet.dart`, `settings_sheet.dart`, `prompter_screen.dart` (`prompterKey`) | Done |
| `js/remote.js` PeerJS host and client, codes, ICE from `/api/turn-credentials` | `lib/remote/peer.dart`, `link.dart`, `codes.dart`, `ice.dart`, `binarypack.dart` | Done: PeerJS's broker and BinaryPack, so it pairs with the site's PeerJS 1.5.4 |
| `js/qr.js` the remote link's QR | `lib/features/prompter/remote_panel.dart` (qr_flutter) | Done |
| `remote.html`, `js/remote-page.js` the remote page, the mirror, editing, the lock | `lib/features/remote/remote_screen.dart`, `remote_session.dart` | Done |
| `js/nearby.js` the offline remote (Android) | `lib/remote/nearby.dart`, `android/app/.../NearbyLink.java` | Done |
| `js/watch.js` the Wear OS watch (Android) | `lib/remote/watch.dart`, `android/app/.../WatchLink.java`, `android/wear/` | Done |
| `js/app-native.js` full brightness, volume keys, alerts, immersive | `lib/features/prompter/app_extras.dart`, `lib/app/fullscreen.dart`, `MainActivity.java` | Done, under the site's keys |
| `js/app-desktop.js` keep on top, shortcuts in other apps, alerts | `lib/desktop/prompter_desk.dart` | Done, under the Electron app's settings keys |
| `js/theme.js` brand colours, light, dark, time-based | `lib/theme/theme.dart`, `lib/features/theme/theme_sheet.dart` | Done, plus Material You |
| `js/tour.js` first-visit tours, Show me around | `lib/features/tour/tour.dart` | Done, under the same keys |
| `js/bug-report.js` Report a bug, Screenshot a page, sent by `api/bug-report.js` | `lib/features/bug/bug_report.dart`, `lib/features/prompter/whole_script.dart` | Done. Screenshot a page takes the whole script on the prompter, or the screen |
| `js/sw-update.js`, `js/app-update.js` update bar | `lib/features/update/update_bar.dart`, `lib/desktop/updater.dart` | Done, as the app's own updater and Updates page (Android), and the desktop's |
| `sw.js` offline | everything is on the device | Works offline from the first open |
| `remote?id=CODE` links, `uwu://cue/` | `lib/app/links.dart`, `AndroidManifest.xml` (verified links) | Done |
| `api/app-release.js` (with `history`), `api/push/release.js` | the site's side of the apps | Extended in 2.0.0 for the Updates page |
| The 1.0.0 apps' data (WebView, Electron) | `lib/data/migrate.dart`, `MainActivity.migrate`, `lib/desktop/leveldb.dart` | Done, once, never over newer values |
