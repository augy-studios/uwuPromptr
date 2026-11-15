# The app in a browser, driven by Playwright

The real Flutter screens, built for the web from `main_e2e.dart`, with a stand-in for the Android
side and the site's API answered by the tests (`tests/helpers.js`), so they run offline and the
same every time, except `tests/remote.spec.js`, which pairs the app with the website both ways
through PeerJS's public broker and needs the internet. The website itself is served beside it by
`site-serve.mjs` (for that, and for `tests/site.spec.js`, the site's own form and tours). This
build is for testing only and never ships.

```powershell
cd flutter\e2e
npm install
npx playwright install chromium
npm run build      # flutter build web, into flutter/build/web
npm test
```

The app is served on 47391 and the website on 47392.

Query parameters: `?android=1` draws as the Android app does (its Updates page, Material You by
default), `?wallpaper=1` pretends the phone has wallpaper colours, `?play=1` acts as the Google
Play build, `?nearby=1` and `?watch=1` as a phone with Google Play services and a paired watch,
`?desktop=1` draws the desktop's title bar, rail and scripts pane, `?welcome=1` the desktop's
Make it yours window, `?notour=1` keeps tours from starting, and `?page=remote&id=CODE` opens the
remote. What the app asked of its Android side is in `window.e2eCalls`, and
`window.e2eEmit(plugin, event, json)` says what Android would have said.

The tests find things as a screen reader would (`getByRole`, by name), so a change that makes a
button nameless, or names it twice, fails here.

`shots/capture.mjs` and `shots/compose.mjs` make the store's screenshots from the same build
(`GOOGLE-PLAY.md`, section 7).
