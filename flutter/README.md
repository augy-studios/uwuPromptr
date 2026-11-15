# uwuPromptr's apps

Android (with its Wear OS watch app), Windows, macOS and Linux from one Flutter project, with the
same features, words, stored data and remote as the website in `../main-site/`, which stays the
specification (`docs/flutter-android-app-spec.md`, `docs/flutter-desktop-app-spec.md`,
`docs/desktop-features-spec.md`, `docs/page-tour-spec.md`). `PORTING.md` maps each part of the site
to its Dart. They replace 1.0.0's Capacitor and Electron apps, and update them in place.

```text
lib/
  main.dart, run.dart     start-up: the store, the old app's data brought across once, the bridge
                          (or the desktop's host), the theme, then the app
  app/                    the shell: home (the two pages), links, fullscreen, navigation
  api/                    the site's /api/*, and whether the network's there
  data/                   storage under the site's keys, scripts and settings, the prompter's
                          arithmetic, and the migration from the 1.0.0 apps
  features/prompter/      the prompter page: the engine, trays, editor, scripts, settings, the
                          remote panel and its host session
  features/remote/        the remote page: connecting, the mirror, editing from it
  features/               theme, tour, bug (Report a bug), update (the Updates page)
  remote/                 PeerJS over WebRTC (the site's remote.js), Nearby and the watch
  native/bridge.dart      the one way to platform code: Native.call / has / on
  desktop/                the desktop layer: window, tray, title bar, updater, installers' side
  theme/                  Material You and the UwU Apps look; the site's icons
android/                  the Gradle project: app/ (Java for Nearby, the watch, the updater, FCM),
                          wear/ (the Wear OS watch app)
windows/ macos/ linux/    the runners, each with a small native channel (Jump List, Dock…)
installers/               NSIS, WiX, .deb/.rpm/AppImage and .dmg scripts, and the update files
e2e/                      the screens in a browser, driven by Playwright (e2e/README.md)
test/                     unit tests for the ported logic and the release notes
```

## Building

**Android**, from the project root in PowerShell, with `android.keystore` and
`keystore.properties` in `flutter\` (the 1.0.0 app's key, not in git: restore them from your
backup):

```powershell
powershell -ExecutionPolicy Bypass -File flutter\build-apk.ps1        # the APK and the watch's, for GitHub
powershell -ExecutionPolicy Bypass -File flutter\build-apk.ps1 -Aab   # the App Bundle, for Google Play
```

Each run raises the version code (the `+N` in `pubspec.yaml`) by one, builds, checks the
signature against the app's key, and copies the files to `release\<version>\`. Both are shrunk
and obfuscated (R8 and Dart's `--obfuscate`); the mapping and Dart symbols stay beside them,
git-ignored, for reading crash reports. Raise the version name yourself for a new release.

Firebase (New version alerts) needs `android\app\google-services.json`: `FIREBASE-SETUP.md`.

**Desktop**: GitHub Actions builds every platform on publish (`.github/workflows/build-desktop.yml`).
To try one locally: `flutter build windows` (or `macos`, `linux`), and `flutter run -d windows`.

## Testing

```powershell
cd flutter
flutter analyze
flutter test                       # the ported logic, the LevelDB reader, the release notes
cd e2e; npm install; npx playwright install chromium
npm run build; npm test            # the real screens in Chromium (e2e/README.md)
```

`e2e/tests/remote.spec.js` pairs the app with the website both ways through PeerJS's broker, so it
needs the internet.
