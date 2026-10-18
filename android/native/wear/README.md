# uwuPromptr for Wear OS

The prompter's remote on your wrist. A small native watch app (Java, plain views, no
Compose), built alongside the phone's app by `android/build-apk.ps1` into
`release/<version>/uwupromptr-<version>-watch.apk`.

It drives the **uwuPromptr app on the paired phone**, not a prompter directly:

- On the **prompter** page, the watch drives that phone's prompter. No code to type, and the
  phone's screen stays on while the watch is listening.
- On the **remote** page, connected to a prompter anywhere (web or nearby), the watch drives
  that prompter through the phone.

The phone's app has to be open. If the watch can't reach it, it says so and offers **Open on
phone**.

## What it does

| Part | What it does |
|---|---|
| `MainActivity` | The watch's screen: the script's name, the prompter's clock, the speed, **Play**/**Pause**, **−** and **+** (a whole step), **Restart**, and the progress. Settings below: **Wrist taps** and **Twist to play or pause** |
| `RemoteTile` | The **Prompter remote** tile: name, a clock that counts by itself while playing (ProtoLayout's dynamic time), speed, **Play**/**Pause**, **−**, **+**, **Restart**. Each button reloads the tile with its id (`LoadAction`); the tile sends it and waits up to 1.5 s for the phone's answer |
| `Link` | Messages to the phone over the Wearable Data Layer (`/cue/remote`), in order on one thread; **Open on phone** (`RemoteActivityHelper`, `uwu://cue/watch`) |
| `StateListener` | The phone's summary of the prompter (`/cue/state`), with the app open or not |
| `Store` | The last state, whether the phone is answering, the wrist taps' timing, and the settings |
| `Twist` | The gyroscope gesture |
| `Buzz` | The wrist taps' vibrations |

### The ColorOS watch features, the Wear OS way

ColorOS's watch software isn't open, so each of its features is rebuilt here from what Wear OS
offers. OPPO's and OnePlus's own recent watches (OPPO Watch X, OnePlus Watch 2 and later) run
Wear OS alongside their low-power engine, so they run this app too.

| ColorOS feature | Here |
|---|---|
| Crown with a click per notch | The crown sets the speed a tenth at a time. Each step is a tick you feel (`SEGMENT_FREQUENT_TICK` on Wear OS 5, `CLOCK_TICK` before), each whole number a firmer one (`SEGMENT_TICK`, or `CONFIRM`), and the ends of the range a reject buzz. A rotating bezel (Galaxy Watch) steps once per click. Crown turns go to the phone at most every 80 ms |
| Low-power co-processor display | Ambient mode (`AmbientLifecycleObserver`): wrist down, the screen dims to the name, the minutes and the speed in white on black, moved a few pixels each minute against burn-in, without anti-aliasing on low-bit screens, and stays there rather than going back to the watch face. The phone's state keeps arriving, so the taps carry on. Wear OS has no public API for the co-processor itself |
| Motion gestures | **Twist to play or pause**: a quick turn of the wrist and back, from the gyroscope (spin about the forearm past 6 rad/s, then back past 4 within 0.6 s, then 1.2 s rest). Off until turned on, and only while the app's screen is open. Wrist flicks (`KEYCODE_NAVIGATE_NEXT`/`PREVIOUS`) and spare buttons (`KEYCODE_STEM_1` to `3`) on watches that send them also play or pause. Knuckle slides have no Wear OS API |

From the rest of the suggestions, for Wear OS watches:

- **Wrist taps** (Gemini's haptic pacing): two short taps every 30 s, 1, 2 or 5 minutes of the
  prompter's own clock (a pause doesn't count, Restart starts over), and three long ones when
  the script reaches its end. Played as alarm vibrations so they come through with the screen
  off.
- **Tile**: as above. There's no complication: a watch face's slot can't hold a play button.

## The link to the phone

```text
 watch                                phone (uwuPromptr app)                page
 Link ──/cue/remote──► WatchLink (MessageClient listener) ──"watch" event──► js/watch.js
 StateListener ◄──/cue/state── WatchLink.send ◄──Cue.watchSend── summary
```

- **To the phone**: the web remote's own messages. `{ type: "hello" }` asks for the state;
  `{ type: "command", name: "toggle" | "reset" }`, `nudge` with `setting: "speed"`, or `set`
  with `setting: "speed"` and a value. `js/watch.js` lets through only play, pause, toggle,
  reset and the speed: a watch never edits the script or hangs up the remote.
- **From the phone**: `{ v: 1, live, role, playing, speed, elapsed, progress, name }`. `role`
  is `prompter` or `remote`; `live` is false on a remote page that isn't connected.
- **When**: the watch says hello on opening, every 20 s while its screen is open (ambient too,
  as it answers each state with a hello when one is due), and when the tile is shown. The page
  answers at once, then sends once a second while the script plays and at once on any other
  change, for 90 s after the last hello. With no watch, nothing is sent.
- **Who**: the Data Layer only connects an app to its own copy on the other device, signed
  with the same key. That is the whole of the pairing.

## Why it's built the way it is

- **Same application id and signing key as the phone's** (`org.uwuapps.cue`, the phone's
  keystore): the Data Layer needs both. The build script checks both APKs carry the key in
  `assetlinks.json`.
- **Same version as the phone's**, read from `app/build.gradle` by `wear/build.gradle`, so a
  version is only ever raised there.
- **Not standalone** (`com.google.android.wearable.standalone` false): it does nothing without
  the phone's app.
- **minSdk 30**, Wear OS 3, the first to take other apps' tiles.
- Not on Google Play, so the phone's self-updater never offers the watch's APK:
  `api/_lib/release.js` skips any `-watch.apk`. The watch app is updated by installing the new
  one over it, as below.

## Installing it on a watch

Wear OS has no browser to download an APK with, so it goes on from a computer with `adb`
(Android Studio's SDK has it, in `platform-tools`):

1. On the watch: **Settings** > **System** > **About** > **Versions**, tap **Build number** seven
   times. Then **Settings** > **Developer options**: turn on **ADB debugging** and **Debug over
   Wi-Fi** (or **Wireless debugging**). The watch and the computer must be on the same Wi-Fi.
2. Wireless debugging on Wear OS 4 and later: tap **Pair new device**, then on the computer
   `adb pair <ip>:<port>` with the code the watch shows.
3. `adb connect <ip>:<port>` with the address the watch shows, then
   `adb install -r uwupromptr-<version>-watch.apk`. `-r` installs over an older version.
4. On the watch, add the **Prompter remote** tile: long-press the watch face's tiles, or
   **Add tile** on the phone's watch app.

Phone apps that sideload to a watch (Wear Installer and the like) work too. Turn ADB debugging
off again afterwards: it costs battery.

## Checking a build

- With the phone on the prompter page: open the watch app, the phone shows "Your watch is
  connected", and **Play**, **Pause**, **Restart**, **−** and **+** do what they say.
- The crown: speed changes by tenths with a tick each, a firmer tick at each whole number, a
  reject at 0.1 and 40.
- Wrist down: the dim screen with the name, minutes and speed; wrist up: everything back.
- **Wrist taps** every 30 s: two taps on the prompter's clock; three long ones at the end.
- **Twist to play or pause**, on: a quick twist toggles; walking and gesturing don't.
- The tile: draws, its buttons work, its clock counts while playing.
- Phone app closed: "Open uwuPromptr on your phone", and **Open on phone** opens it.
- Phone on the remote page: not connected says so; connected drives the far prompter.
