# Releases

Each version's Android builds live here, one folder per version, as SG Bus Timings keeps them:

```text
release/2.0.0/
  uwupromptr-2.0.0.apk                Android, for GitHub          flutter\build-apk.ps1
  uwupromptr-2.0.0-watch.apk          Wear OS, for GitHub          the same, built with the phone's
  uwupromptr-2.0.0.aab                Android, for Google Play     flutter\build-apk.ps1 -Aab
  uwupromptr-2.0.0-mapping.txt        reads the APK's crashes      not in git, not uploaded
  uwupromptr-2.0.0-symbols.zip        reads its Dart crashes       not in git, not uploaded
  uwupromptr-2.0.0-play-mapping.txt   the same for the bundle      not in git (Play has its own copy)
  uwupromptr-2.0.0-play-symbols.zip   the same for the bundle      not in git
```

The APKs and the App Bundle are committed with the code they were built from. GitHub refuses any
file over 100 MB: one that big is listed by name in the root `.gitignore` and goes only on the
GitHub release. The desktop installers (`.exe`, `.msi`, `.dmg` and `.zip`, `.deb`, `.rpm`,
`.AppImage`, and the `latest*.yml` update files) are built by GitHub Actions and live only on the
GitHub release.

All of them share one version number and one GitHub release, tagged `android-v<version>`.

## Publishing a version

1. **Raise the version name** in `flutter/pubspec.yaml` (`2.0.0+N` becomes `2.0.1+N`). Leave the
   `+N`: every build raises it by one by itself, as Google Play refuses a version code it has
   seen, and a phone only takes a higher one as an update.
2. **Build the Android files**, from the project root in PowerShell:

   ```powershell
   powershell -ExecutionPolicy Bypass -File flutter\build-apk.ps1        # the APK and the watch's
   powershell -ExecutionPolicy Bypass -File flutter\build-apk.ps1 -Aab   # the App Bundle
   ```

   Each checks its signature against the app's key, and the bundle that nothing of the updater
   or the advertising ID is left in it. Both are shrunk and obfuscated, as Google Play asks.
3. **Deploy the site first** if this release needs anything new from it (the Updates page reads
   `/api/app-release`, Report a bug posts to `/api/bug-report`).
4. **Commit the code, `pubspec.yaml` and `release/<version>/`** and push.
5. **Make the release**, with the APKs attached **before** publishing:
   - **Releases** > **Draft a new release**, tag `android-v<version>` (**Create new tag on
     publish**, target `main`), title `uwuPromptr <version>`.
   - Paste `announcements/release-notes-<version>.md` into **Describe this release**.
   - Attach `uwupromptr-<version>.apk` and `uwupromptr-<version>-watch.apk`, and wait for both to
     finish uploading. Never the `.aab`: that's for Google Play (`GOOGLE-PLAY.md`).
   - Tick **Set as the latest release**, then **Publish release**.
6. GitHub Actions (**Build desktop apps**) builds Windows, macOS and Linux from the tag and adds
   their installers and `latest*.yml` files to the release, about 20 minutes later. Or run it by
   hand first with the tag, and it makes a draft release with them, for the APKs to join.
7. Post `announcements/announcement-<version>.md` to the UwU Apps Telegram channel, and upload the
   bundle to Google Play with `announcements/play-release-notes-<version>.md`.

`https://github.com/augy-studios/uwuPromptr/releases/latest` always points at the newest one.

## How phones and computers hear about it

- **Android (GitHub APK)**: within ten minutes the app's bar says the version is out (from
  `/api/app-release`, which skips drafts, pre-releases, tags that aren't `android-v*` and releases
  whose APK hasn't finished uploading), and the Updates page downloads it, checks GitHub's SHA-256
  and installs it. With **New version alerts** on, a notification arrives the moment it's
  published (`main-site/api/push/release.js`, `flutter/FIREBASE-SETUP.md`): that's why the APK
  has to be attached before **Publish release**. The 1.0.0 app hears the same way and installs
  2.0.0 over itself.
- **Android (Google Play)**: Play updates it.
- **Wear OS**: watches don't update themselves: install the new `-watch.apk` over the old one
  (`flutter/android/wear/README.md`).
- **Windows, macOS, Linux AppImage**: the app reads the `latest*.yml` files on the newest release
  as it opens and every hour, downloads the new version and offers **Restart to update**. The
  1.0.0 Electron app reads the same files, and its updater installs 2.0.0 in place: the
  installers keep its names, folder and uninstall entry (`flutter/installers/`).
- **Windows `.msi`, Linux `.deb` and `.rpm`**: a notification says it's out, with a link here.

## Before you share it

- **Never upload `android.keystore`, `keystore.properties`, `google-services.json` or the
  Firebase service account key**: only the APKs. The repository has to be public for others to
  download them.
- Keep the `-mapping.txt` and `-symbols.zip` files: they're the only way to read the app's crash
  reports back (`flutter symbolize`).

## If something goes wrong

| What happens | What to do |
| --- | --- |
| "App not installed" on the phone | An older copy signed with a different key is installed. Uninstall uwuPromptr, then install again. |
| Play Protect warns about the app | **More details** > **Install anyway**. Registering the package for Android developer verification (`GOOGLE-PLAY.md`, section 5) stops it. |
| No update bar in the Android app | The tag doesn't start `android-v`, the release is a draft or pre-release, the APK hadn't finished uploading, or it's been under 10 minutes. `https://cue.uwuapps.org/api/app-release` shows what phones see. |
| No "new version" notification | GitHub > **Settings** > **Webhooks** > **Recent Deliveries** says why (`flutter/FIREBASE-SETUP.md`). Published before the APK finished uploading? **Redeliver** it. |
| No desktop installers on the release | **Actions** > **Build desktop apps**: the run's log says which platform failed; **Run workflow** with the tag builds them again. |
| You uploaded the wrong file | On the release, **Edit**, delete it, attach the right one, **Update release**. The apps check every download against its checksum. |
