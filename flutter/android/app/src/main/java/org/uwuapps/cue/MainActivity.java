package org.uwuapps.cue;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.core.content.FileProvider;
import androidx.core.location.LocationManagerCompat;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;

/**
 * The app's one window, and the bridge to the Dart side (lib/native/bridge.dart): one method
 * channel, whose "call" names a plugin and a method and carries its options as JSON, answered
 * with JSON. Two plugins:
 *
 *   App   info, launchLink, installApk (the GitHub APK only), setReleases (the Firebase topic for
 *         new versions, FIREBASE-SETUP.md), openSettings, background (Back's second press), and
 *         migrate (what the old WebView app kept, read once)
 *   Cue   the prompter's: brightness (this window only), keys (volume keys and clickers to the
 *         prompter), the offline remote over Nearby Connections (nearbyAdvertise, nearbyDiscover,
 *         nearbySend, nearbyDisconnect, nearbyStop), and watchSend (the Wear OS watch app)
 *
 * And their events: App's "link" (a link arriving while the app runs) and "openUpdates" (a tapped
 * notification of a new version); Cue's "key", "nearby" and "watch".
 *
 * Every option from the Dart side is checked here, as the old app's CuePlugin checked the page's.
 */
public class MainActivity extends FlutterActivity {
    static final String CHANNEL = "org.uwuapps.cue/bridge";
    /** The topic main-site/api/push/release.js sends to: the old app's own, kept. */
    static final String RELEASES_TOPIC = "cue-releases";
    static final String OPEN_UPDATES = "org.uwuapps.cue.OPEN_UPDATES";
    /** The site the old WebView app loaded, whose storage is read once (migrate). */
    static final String SITE = "https://cue.uwuapps.org";

    private static final int ASK_NOTIFICATIONS = 41;
    private static final int ASK_NEARBY = 42;
    private static final Pattern ENDPOINT_NAME = Pattern.compile("^cue-[0-9a-f]{8,32}$");

    private MethodChannel channel;
    private String launchLink;
    private MethodChannel.Result pendingReleases;
    private boolean pendingReleasesOn;
    private MethodChannel.Result pendingNearby;
    private String pendingNearbyName;
    private boolean pendingNearbyAdvertise;

    private NearbyLink nearby;
    private WatchLink watch;

    /** Set by Cue.keys: the volume and media keys go to the prompter. */
    private volatile boolean keysToPrompter = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Notifications.channels(this);
        launchLink = linkOf(getIntent());
        // Into the camera cutout, rather than a black strip beside it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        // The Wear OS watch app talks through Play services' Wearable API.
        if (playServices()) {
            watch = new WatchLink(this, data -> {
                Map<String, Object> event = new HashMap<>();
                event.put("data", data);
                emit("Cue", "watch", event);
            });
            watch.start();
        }
    }

    @Override
    protected void onDestroy() {
        if (nearby != null) nearby.stop();
        nearby = null;
        if (watch != null) watch.stop();
        watch = null;
        super.onDestroy();
    }

    @Override
    public void configureFlutterEngine(@NonNull FlutterEngine engine) {
        super.configureFlutterEngine(engine);
        channel = new MethodChannel(engine.getDartExecutor().getBinaryMessenger(), CHANNEL);
        channel.setMethodCallHandler(this::onCall);
    }

    @Override
    protected void onNewIntent(@NonNull Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String link = linkOf(intent);
        if (link == null) return;
        Map<String, Object> data = new HashMap<>();
        data.put("url", link);
        emit("App", "link", data);
    }

    /** The app's own address for what an intent asks: a link, or the Updates page. */
    private static String linkOf(Intent intent) {
        if (intent == null) return null;
        if (OPEN_UPDATES.equals(intent.getAction())) return "uwu://cue/updates";
        // A notification Firebase showed itself carries its data as extras.
        if ("update".equals(intent.getStringExtra("type"))) return "uwu://cue/updates";
        Uri data = intent.getData();
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && data != null) return data.toString();
        return null;
    }

    private void emit(String plugin, String event, Map<String, Object> data) {
        if (channel == null) return;
        Map<String, Object> args = new HashMap<>();
        args.put("plugin", plugin);
        args.put("event", event);
        args.put("data", new JSONObject(data).toString());
        new Handler(Looper.getMainLooper()).post(() -> {
            if (channel != null) channel.invokeMethod("event", args);
        });
    }

    private void onCall(MethodCall call, MethodChannel.Result result) {
        switch (call.method) {
            case "hello":
            case "listen":
            case "unlisten":
                result.success(null);
                return;
            case "call":
                break;
            default:
                result.notImplemented();
                return;
        }
        String plugin = call.argument("plugin");
        String method = call.argument("method");
        JSONObject options;
        try {
            String raw = call.argument("options");
            options = new JSONObject(raw == null ? "{}" : raw);
        } catch (Exception e) {
            options = new JSONObject();
        }
        try {
            if ("App".equals(plugin)) app(method, options, result);
            else if ("Cue".equals(plugin)) cue(method, options, result);
            else result.error("unavailable", "No plugin " + plugin, null);
        } catch (Exception e) {
            result.error("failed", e.getMessage(), null);
        }
    }

    private static void ok(MethodChannel.Result result, JSONObject answer) {
        result.success(answer == null ? null : answer.toString());
    }

    private boolean firebaseReady() {
        try {
            return !FirebaseApp.getApps(this).isEmpty();
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean playServices() {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS;
        } catch (Throwable t) {
            return false;
        }
    }

    // ---------- App ----------

    private void app(String method, JSONObject o, MethodChannel.Result result) throws Exception {
        switch (method) {
            case "info": {
                JSONArray features = new JSONArray();
                features.put("links");
                features.put("keepAwake");
                features.put("brightness");
                features.put("immersive");
                features.put("keys");
                if (!BuildConfig.PLAY) features.put("update");
                // Only with google-services.json built in: without it nothing could ever arrive.
                if (firebaseReady()) features.put("push");
                if (playServices()) features.put("nearby");
                if (watch != null) features.put("watch");
                JSONObject a = new JSONObject();
                a.put("platform", "android");
                a.put("version", BuildConfig.VERSION_NAME);
                a.put("build", BuildConfig.VERSION_CODE);
                a.put("play", BuildConfig.PLAY);
                a.put("sdk", Build.VERSION.SDK_INT);
                // For a bug report (lib/features/bug/bug_report.dart): "Android 16 · Google Pixel 9".
                a.put("release", Build.VERSION.RELEASE);
                a.put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim());
                a.put("features", features);
                ok(result, a);
                return;
            }
            case "launchLink": {
                JSONObject a = new JSONObject();
                if (launchLink != null) a.put("url", launchLink);
                launchLink = null;
                ok(result, a);
                return;
            }
            case "installApk":
                installApk(o, result);
                return;
            case "setReleases":
                setReleases(o.optBoolean("on"), result);
                return;
            case "openSettings":
                openSettings(o.optString("page", "app"));
                ok(result, null);
                return;
            case "background":
                moveTaskToBack(true);
                ok(result, new JSONObject());
                return;
            case "migrate":
                migrate(result);
                return;
            default:
                result.error("unavailable", "No method " + method, null);
        }
    }

    private void openSettings(String page) {
        Intent i;
        if ("notifications".equals(page) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        } else if ("location".equals(page)) {
            i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        }
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }
    }

    /** A downloaded, checked APK to Android's installer, once installing from this app is allowed. */
    private void installApk(JSONObject o, MethodChannel.Result result) {
        if (BuildConfig.PLAY) {
            result.error("unavailable", "Google Play updates this app", null);
            return;
        }
        File apk = new File(o.optString("path"));
        if (!apk.exists()) {
            result.error("failed", "The download is gone", null);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            result.error("permission", "Allow installing apps from uwuPromptr", null);
            return;
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", apk);
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
        ok(result, null);
    }

    /** Joins or leaves the release topic; turning it on asks for notifications first (Android 13+). */
    private void setReleases(boolean on, MethodChannel.Result result) {
        if (!firebaseReady()) {
            result.error("unavailable", "Built without Firebase", null);
            return;
        }
        if (on && Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingReleases = result;
            pendingReleasesOn = true;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFICATIONS);
            return;
        }
        subscribe(on, result);
    }

    private void subscribe(boolean on, MethodChannel.Result result) {
        FirebaseMessaging fm = FirebaseMessaging.getInstance();
        (on ? fm.subscribeToTopic(RELEASES_TOPIC) : fm.unsubscribeFromTopic(RELEASES_TOPIC))
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) ok(result, null);
                    else result.error("network", "Couldn't reach Firebase", null);
                });
    }

    private static final String DUMP = "(function(){var o={};try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k);}}catch(e){}return JSON.stringify(o);})()";

    /**
     * What the old WebView app (1.0.0) kept in localStorage for the site: its scripts, settings
     * and the rest. Read by a WebView that's never shown, given the site's address as its own so
     * it sees the site's storage, with nothing fetched. The WebView's copy is left as it was.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private void migrate(MethodChannel.Result result) {
        WebView web;
        try {
            web = new WebView(this);
        } catch (RuntimeException e) {
            // No WebView on this phone at all: nothing to read.
            try {
                JSONObject out = new JSONObject();
                out.put("found", false);
                out.put("items", new JSONObject());
                ok(result, out);
            } catch (JSONException ignored) {
                result.success(null);
            }
            return;
        }
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            private boolean done;

            @Override
            public void onPageFinished(WebView view, String url) {
                if (done) return;
                done = true;
                view.evaluateJavascript(DUMP, value -> {
                    JSONObject out = new JSONObject();
                    JSONObject items = new JSONObject();
                    try {
                        // evaluateJavascript hands back the result as a JSON string literal.
                        Object text = new JSONTokener(value == null ? "\"{}\"" : value).nextValue();
                        JSONObject all = new JSONObject(text instanceof String ? (String) text : "{}");
                        for (Iterator<String> keys = all.keys(); keys.hasNext(); ) {
                            String k = keys.next();
                            items.put(k, all.optString(k));
                        }
                        out.put("found", items.length() > 0);
                        out.put("items", items);
                    } catch (JSONException ignored) {
                        // Nothing readable: nothing to bring over.
                    }
                    ok(result, out);
                    view.destroy();
                });
            }
        });
        web.loadDataWithBaseURL(SITE + "/", "<!doctype html><title></title>", "text/html", "utf-8", null);
    }

    // ---------- Cue ----------

    private void cue(String method, JSONObject o, MethodChannel.Result result) throws Exception {
        switch (method) {
            case "brightness": {
                // This window's brightness, 0 to 1, or the phone's own setting below 0. The phone's
                // setting is never changed, so no WRITE_SETTINGS.
                double level = o.optDouble("level", -1);
                float value = level < 0
                        ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                        : (float) Math.max(0.01, Math.min(1.0, level));
                WindowManager.LayoutParams params = getWindow().getAttributes();
                params.screenBrightness = value;
                getWindow().setAttributes(params);
                ok(result, null);
                return;
            }
            case "keys":
                keysToPrompter = o.optBoolean("on");
                ok(result, null);
                return;
            case "watchSend": {
                String data = o.optString("data", null);
                if (watch != null && data != null && data.length() <= WatchLink.MAX_BYTES) watch.send(data);
                ok(result, null);
                return;
            }
            case "nearbyAdvertise":
            case "nearbyDiscover": {
                String name = o.optString("name", "");
                if (!ENDPOINT_NAME.matcher(name).matches()) {
                    result.error("failed", "Not an endpoint name", null);
                    return;
                }
                if (!playServices()) {
                    answer(result, "unavailable");
                    return;
                }
                boolean advertise = "nearbyAdvertise".equals(method);
                String[] needed = nearbyPermissions();
                if (!granted(needed)) {
                    pendingNearby = result;
                    pendingNearbyName = name;
                    pendingNearbyAdvertise = advertise;
                    requestPermissions(needed, ASK_NEARBY);
                    return;
                }
                startNearby(name, advertise, result);
                return;
            }
            case "nearbySend": {
                String data = o.optString("data", null);
                if (data != null && nearby != null) nearby.send(data);
                ok(result, null);
                return;
            }
            case "nearbyDisconnect":
                if (nearby != null) nearby.disconnect();
                ok(result, null);
                return;
            case "nearbyStop":
                if (nearby != null) nearby.stop();
                nearby = null;
                ok(result, null);
                return;
            default:
                result.error("unavailable", "No method " + method, null);
        }
    }

    /** What this phone's Android version needs for Nearby Connections (Google's list). Fine
     *  location is always asked with coarse: Android 12 ignores a request for fine alone. */
    private static String[] nearbyPermissions() {
        List<String> p = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            p.add(Manifest.permission.BLUETOOTH_SCAN);
            p.add(Manifest.permission.BLUETOOTH_ADVERTISE);
            p.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (Build.VERSION.SDK_INT >= 33) p.add(Manifest.permission.NEARBY_WIFI_DEVICES);
        if (Build.VERSION.SDK_INT <= 31) {
            if (Build.VERSION.SDK_INT >= 29) p.add(Manifest.permission.ACCESS_FINE_LOCATION);
            p.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        return p.toArray(new String[0]);
    }

    private boolean granted(String[] permissions) {
        for (String p : permissions) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    /** Before Android 12 Nearby needs location switched on, not just allowed. */
    private boolean locationReady() {
        if (Build.VERSION.SDK_INT >= 31) return true;
        LocationManager manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        return manager == null || LocationManagerCompat.isLocationEnabled(manager);
    }

    private void startNearby(String name, boolean advertise, MethodChannel.Result result) {
        if (!locationReady()) {
            answer(result, "location-off");
            return;
        }
        if (nearby != null) nearby.stop();
        nearby = new NearbyLink(this, event -> emit("Cue", "nearby", event));
        if (advertise) nearby.advertise(name);
        else nearby.discover(name);
        answer(result, "granted");
    }

    /** A refusal is an answer, not an error: the Dart side says what to do. */
    private static void answer(MethodChannel.Result result, String state) {
        try {
            JSONObject a = new JSONObject();
            a.put("state", state);
            ok(result, a);
        } catch (JSONException e) {
            result.success(null);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants);
        if (requestCode == ASK_NOTIFICATIONS && pendingReleases != null) {
            MethodChannel.Result result = pendingReleases;
            pendingReleases = null;
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) subscribe(pendingReleasesOn, result);
            else result.error("permission", "Notifications are off for uwuPromptr", null);
        } else if (requestCode == ASK_NEARBY && pendingNearby != null) {
            MethodChannel.Result result = pendingNearby;
            pendingNearby = null;
            if (granted(nearbyPermissions())) startNearby(pendingNearbyName, pendingNearbyAdvertise, result);
            else answer(result, "denied");
        }
    }

    // ---------- clickers ----------

    /**
     * Volume keys, and the play/pause and headset keys, as a clicker: only while the prompter has
     * asked for them (Volume keys start and stop, in Prompter settings), and only the press, not
     * its repeats. Both the press and the release are kept, so the volume doesn't change as well.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (keysToPrompter) {
            String name = keyName(event.getKeyCode());
            if (name != null) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    Map<String, Object> data = new HashMap<>();
                    data.put("key", name);
                    emit("Cue", "key", data);
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private static String keyName(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_VOLUME_UP: return "volumeUp";
            case KeyEvent.KEYCODE_VOLUME_DOWN: return "volumeDown";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                return "playPause";
            default: return null;
        }
    }

    /** The app's notification channel, made once: the old app's own, "updates", kept. */
    static final class Notifications {
        static final String CHANNEL_UPDATES = "updates";

        static void channels(Context context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel releases = new NotificationChannel(CHANNEL_UPDATES, "New versions", NotificationManager.IMPORTANCE_DEFAULT);
            releases.setDescription("When a new version of uwuPromptr is out");
            nm.createNotificationChannel(releases);
        }
    }
}
