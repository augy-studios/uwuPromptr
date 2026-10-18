package org.uwuapps.cue;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.core.location.LocationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.regex.Pattern;

/**
 * Everything the page can ask of the app, as one Capacitor plugin.
 *
 * The page lays everything out and decides everything; this only adds what a
 * web page cannot do. info() lists the features that will actually work on
 * this phone, and the page shows a feature's controls only when it is listed,
 * so an older APK under a newer site simply shows less.
 *
 * Every argument from the page is checked here. The page is the site, but the
 * WebView runs whatever a mistaken deploy sends.
 */
@CapacitorPlugin(
    name = "Cue",
    permissions = {
        // Nearby Connections, by Android version (Google's list). One alias is
        // picked at runtime, so nothing is asked for that the phone's version
        // does not have.
        @Permission(alias = "nearby33", strings = {
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.NEARBY_WIFI_DEVICES,
        }),
        @Permission(alias = "nearby32", strings = {
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
        }),
        // Fine location is always asked for with coarse: Android 12 ignores a
        // request for fine alone.
        @Permission(alias = "nearby31", strings = {
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        }),
        @Permission(alias = "nearbyFine", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        }),
        @Permission(alias = "nearbyCoarse", strings = { Manifest.permission.ACCESS_COARSE_LOCATION }),
    }
)
public class CuePlugin extends Plugin {

    private static final Pattern TOPIC = Pattern.compile("^cue-[a-z0-9-]{1,40}$");
    private static final Pattern ENDPOINT_NAME = Pattern.compile("^cue-[0-9a-f]{8,32}$");
    private static final Pattern VERSION = Pattern.compile("^\\d+(\\.\\d+){0,3}$");

    /** The loaded plugin, for MainActivity's key handler. */
    private static volatile CuePlugin instance;

    private NearbyLink nearby;
    private WatchLink watch;

    @Override
    public void load() {
        instance = this;
        // The Wear OS watch app talks through Play services' Wearable API.
        if (playServices()) {
            watch = new WatchLink(getContext(), this::watchMessage);
            watch.start();
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (nearby != null) nearby.stop();
        nearby = null;
        if (watch != null) watch.stop();
        watch = null;
        if (instance == this) instance = null;
        MainActivity.keysToPage = false;
    }

    /* ---- what this build can do ---- */

    @SuppressWarnings("deprecation") // versionCode, only before Android 9
    @PluginMethod
    public void info(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            result.put("version", info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
        } catch (PackageManager.NameNotFoundException e) {
            result.put("version", "0");
            result.put("versionCode", 0);
        }
        result.put("android", Build.VERSION.SDK_INT);

        JSArray features = new JSArray();
        features.put("update");
        features.put("keepAwake");
        features.put("brightness");
        features.put("immersive");
        features.put("keys");
        // Only with google-services.json built in: without it nothing could
        // ever arrive.
        if (!FirebaseApp.getApps(context).isEmpty()) features.put("push");
        if (playServices()) features.put("nearby");
        if (watch != null) features.put("watch");
        result.put("features", features);
        call.resolve(result);
    }

    private boolean playServices() {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
        } catch (Exception e) {
            return false;
        }
    }

    /* ---- the screen ---- */

    /** The screen stays on: the WebView has no Screen Wake Lock API. */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /**
     * This window's brightness, 0 to 1, or the phone's own setting with
     * anything below 0. Only while the app is in front: the phone's setting is
     * never changed, so no WRITE_SETTINGS.
     */
    @PluginMethod
    public void brightness(PluginCall call) {
        Double level = call.getDouble("level", -1.0);
        float value = level == null || level < 0
            ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            : (float) Math.max(0.01, Math.min(1.0, level));
        getActivity().runOnUiThread(() -> {
            WindowManager.LayoutParams params = getActivity().getWindow().getAttributes();
            params.screenBrightness = value;
            getActivity().getWindow().setAttributes(params);
            call.resolve();
        });
    }

    /** Fullscreen: the navigation bar hidden as well as the status bar. The
     *  Fullscreen API is unreliable in a WebView. */
    @PluginMethod
    public void immersive(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        getActivity().runOnUiThread(() -> {
            MainActivity.immersive = on;
            if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).applySystemBars();
            JSObject result = new JSObject();
            result.put("on", on);
            call.resolve(result);
        });
    }

    /* ---- clickers and volume keys ---- */

    /** Volume and media keys go to the page as "key" events while on. */
    @PluginMethod
    public void keys(PluginCall call) {
        MainActivity.keysToPage = call.getBoolean("on", false);
        call.resolve();
    }

    static void sendKey(String name) {
        CuePlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("key", name);
        plugin.notifyListeners("key", data);
    }

    /* ---- updates ---- */

    /**
     * Opens the updater. With `check`, it looks first and says whether there
     * is anything newer; with `version`, it downloads that release at once.
     */
    @PluginMethod
    public void update(PluginCall call) {
        Intent intent = new Intent(getContext(), UpdateActivity.class);
        String version = call.getString("version");
        if (version != null && VERSION.matcher(version).matches()) {
            intent.putExtra(UpdateActivity.EXTRA_VERSION, version);
        } else {
            intent.putExtra(UpdateActivity.EXTRA_CHECK, true);
        }
        getActivity().startActivity(intent);
        call.resolve();
    }

    /* ---- notifications ---- */

    /**
     * Joins or leaves a broadcast topic. Topics are shared by every app in the
     * Firebase project, so this app's all start with "cue-".
     */
    @PluginMethod
    public void topic(PluginCall call) {
        String name = call.getString("name", "");
        if (name == null || !TOPIC.matcher(name).matches()) {
            call.reject("Not a topic name");
            return;
        }
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("This build has no Firebase");
            return;
        }
        boolean on = call.getBoolean("on", false);
        (on ? FirebaseMessaging.getInstance().subscribeToTopic(name) : FirebaseMessaging.getInstance().unsubscribeFromTopic(name))
            .addOnSuccessListener((unused) -> {
                JSObject result = new JSObject();
                result.put("on", on);
                result.put("allowed", Notifications.allowed(getContext()));
                call.resolve(result);
            })
            .addOnFailureListener((error) -> call.reject("Could not reach Firebase", error));
    }

    /** Android's settings for this app, for after a permission was refused. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String what = call.getString("what", "app");
        Context context = getContext();
        Intent intent;
        if ("notifications".equals(what) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else if ("location".equals(what)) {
            intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        call.resolve();
    }

    /* ---- the Wear OS watch ---- */

    /** The prompter's state, to the watch. The page sends it only while a watch listens. */
    @PluginMethod
    public void watchSend(PluginCall call) {
        String data = call.getString("data");
        if (watch != null && data != null && data.length() <= WatchLink.MAX_BYTES) watch.send(data);
        call.resolve();
    }

    /** A message from the watch, to the page as it came (js/watch.js reads it). */
    private void watchMessage(String data) {
        JSObject event = new JSObject();
        event.put("data", data);
        notifyListeners("watch", event);
    }

    /* ---- the offline remote: Nearby Connections ---- */

    /** The prompter end: be findable under `name` and take one remote. */
    @PluginMethod
    public void nearbyAdvertise(PluginCall call) {
        if (!checkName(call)) return;
        if (!nearbyReady(call, "nearbyAdvertiseAllowed")) return;
        startNearby(call, true);
    }

    /** The remote end: find the prompter advertising `name` and connect. */
    @PluginMethod
    public void nearbyDiscover(PluginCall call) {
        if (!checkName(call)) return;
        if (!nearbyReady(call, "nearbyDiscoverAllowed")) return;
        startNearby(call, false);
    }

    @PermissionCallback
    private void nearbyAdvertiseAllowed(PluginCall call) {
        if (nearbyAnswer(call)) startNearby(call, true);
    }

    @PermissionCallback
    private void nearbyDiscoverAllowed(PluginCall call) {
        if (nearbyAnswer(call)) startNearby(call, false);
    }

    @PluginMethod
    public void nearbySend(PluginCall call) {
        String data = call.getString("data");
        if (data == null || nearby == null) {
            call.resolve();
            return;
        }
        nearby.send(data);
        call.resolve();
    }

    /** Drops the connected phone, and keeps advertising. For a remote that
     *  did not give the right code. */
    @PluginMethod
    public void nearbyDisconnect(PluginCall call) {
        if (nearby != null) nearby.disconnect();
        call.resolve();
    }

    @PluginMethod
    public void nearbyStop(PluginCall call) {
        if (nearby != null) nearby.stop();
        nearby = null;
        call.resolve();
    }

    private boolean checkName(PluginCall call) {
        String name = call.getString("name", "");
        if (name == null || !ENDPOINT_NAME.matcher(name).matches()) {
            call.reject("Not an endpoint name");
            return false;
        }
        if (!playServices()) {
            answer(call, "unavailable");
            return false;
        }
        return true;
    }

    /** The alias this phone's Android version needs. */
    private static String nearbyAlias() {
        if (Build.VERSION.SDK_INT >= 33) return "nearby33";
        if (Build.VERSION.SDK_INT == 32) return "nearby32";
        if (Build.VERSION.SDK_INT == 31) return "nearby31";
        if (Build.VERSION.SDK_INT >= 29) return "nearbyFine";
        return "nearbyCoarse";
    }

    /** Asks for the permissions if needed. False means the call is now in the
     *  hands of the permission callback, or has been answered. */
    private boolean nearbyReady(PluginCall call, String callback) {
        String alias = nearbyAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, callback);
            return false;
        }
        return locationReady(call);
    }

    private boolean nearbyAnswer(PluginCall call) {
        if (getPermissionState(nearbyAlias()) != PermissionState.GRANTED) {
            // A refusal is an answer, not an error: the page says what to do.
            answer(call, "denied");
            return false;
        }
        return locationReady(call);
    }

    /** Before Android 12 Nearby needs location switched on, not just allowed. */
    private boolean locationReady(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) return true;
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager != null && !LocationManagerCompat.isLocationEnabled(manager)) {
            answer(call, "location-off");
            return false;
        }
        return true;
    }

    private void startNearby(PluginCall call, boolean advertise) {
        String name = call.getString("name");
        if (nearby != null) nearby.stop();
        nearby = new NearbyLink(getContext(), this::nearbyEvent);
        if (advertise) nearby.advertise(name);
        else nearby.discover(name);
        answer(call, "granted");
    }

    private void nearbyEvent(JSObject event) {
        notifyListeners("nearby", event);
    }

    private static void answer(PluginCall call, String state) {
        JSObject result = new JSObject();
        result.put("state", state);
        call.resolve(result);
    }
}
