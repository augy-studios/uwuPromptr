# Firebase setup: New version alerts

The app's one notification is **"uwuPromptr X is out"**, sent when a new Android release is
published on GitHub, to everybody who turned on **New version alerts** (Prompter settings >
Android app). It goes through the shared **UwU Apps** Firebase project.

Without any of this the app builds and works; it simply has no **New version alerts** switch.
The update bar and the Edge Tray's **Check for updates** button work either way.

There are three parts, about fifteen minutes in all:

1. The app gets `google-services.json`, so it can receive.
2. Vercel gets a service account key, so the site can send.
3. GitHub gets a webhook, so publishing a release triggers the send.

---

## 1. Add the app to the UwU Apps project

1. Open the [Firebase console](https://console.firebase.google.com/) and pick **UwU Apps**.
2. Next to **Project Overview**, click the gear, then **Project settings**.
3. Under **Your apps**, click **Add app**, then the **Android** icon.
4. Fill in:
   - **Android package name**: `org.uwuapps.cue` (exactly; it cannot be changed later)
   - **App nickname**: `uwuPromptr`
   - **Debug signing certificate SHA-1**: leave empty. Messaging does not need it.
5. Click **Register app**, then **Download google-services.json**.
6. Save it as:

   ```text
   android\native\app\google-services.json
   ```

   It is git-ignored at both levels; don't commit it. Skip the console's remaining steps
   (the Gradle lines are already in the project) with **Next** and **Continue to console**.

> If the build later says **"No matching client found for package name 'org.uwuapps.cue'"**,
> the file was downloaded before the app was added. Download it again from **Project
> settings** > **Your apps** > **uwuPromptr**.

Rebuild:

```powershell
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
```

The script prints `Firebase: google-services.json found, notifications on.` The app's
Prompter settings then shows the **Android app** section with **New version alerts**.

## 2. Let the site send: the service account key

The webhook (`main-site/api/push/release.js`) sends through FCM's HTTP v1 API with a service
account key.

1. In **Project settings**, open the **Cloud Messaging** tab and check that **Firebase Cloud
   Messaging API (V1)** says **Enabled**. If it doesn't, follow its link to enable it.
2. Open the **Service accounts** tab and click **Generate new private key** > **Generate
   key**. A JSON file downloads.
   - If another UwU app's Vercel project already holds a key for this Firebase project, you
     can reuse that value instead of making another one.
3. In [Vercel](https://vercel.com/), open the **uwuPromptr** project > **Settings** >
   **Environment Variables** and add:

   | Name | Value | Environments |
   |---|---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | the whole JSON file's contents, pasted as is (base64 of it also works) | Production |

4. Delete the downloaded JSON file, or move it into your password manager. Don't leave it in
   the repository: the `.gitignore` files catch `*firebase-adminsdk*.json`, but a renamed copy
   would slip through.

## 3. Send on release: the GitHub webhook

1. Make a secret. In PowerShell:

   ```powershell
   -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
   ```

2. In Vercel, add it next to the key from step 2:

   | Name | Value | Environments |
   |---|---|---|
   | `GITHUB_WEBHOOK_SECRET` | the secret | Production |

3. Optional, recommended: a GitHub token, so the release check is never rate-limited. On
   GitHub, **Settings** > **Developer settings** > **Fine-grained tokens** > **Generate new
   token**, with **Public repositories (read-only)** access and no extra permissions. Add it
   in Vercel as `GITHUB_TOKEN`.
4. **Redeploy** the site in Vercel (**Deployments** > the latest > **Redeploy**), so the
   functions see the new variables.
5. On GitHub, open **augy-studios/uwuPromptr** > **Settings** > **Webhooks** > **Add webhook**:
   - **Payload URL**: `https://cue.uwuapps.org/api/push/release`
   - **Content type**: `application/json`
   - **Secret**: the secret from step 1
   - **Which events?** > **Let me select individual events**: tick **Releases** only, untick
     **Pushes**
   - **Active**: ticked
6. Click **Add webhook**. Under **Recent Deliveries**, the ping should show a green tick and
   the response `{"ok":true,"pong":true}`. A 401 means the secret in Vercel and on GitHub
   differ, or the site was not redeployed; a 503 means `GITHUB_WEBHOOK_SECRET` is not set.

## Checking it

1. On a phone with an APK built after step 1: **Prompter settings** > **Android app** > **New
   version alerts**. Android 13 and newer ask for permission at this point.
2. Firebase console > **Messaging** > **Create your first campaign** (or **New campaign**) >
   **Firebase Notification messages**. Write a title and text, then **Target** > **Topic**:
   `cue-releases`. Send it now. It should arrive with the app open and with it closed.
3. The real thing happens when a release is published with the tag `android-v<version>` and
   its APK attached (see `release/README.md`). Tapping the notification opens the updater.

## How it fits together

```text
GitHub release published (android-v1.1.0, APK attached)
  └─► webhook ─► cue.uwuapps.org/api/push/release   checks the signature, the tag, the APK
                   └─► FCM topic "cue-releases"      api/_push/fcm.js, with FIREBASE_SERVICE_ACCOUNT
                         └─► every phone that joined the topic: "uwuPromptr 1.1.0 is out"
                               └─► tap ─► the app's updater downloads and installs 1.1.0
```

- Topics are shared by every app in the UwU Apps project, so this app's are prefixed `cue-`.
- Turning the switch off leaves the topic. It never unregisters the phone from Firebase, which
  would drop every other subscription with it.
- The notification's channel is **New versions**, a switch in Android's own settings for
  the app.
