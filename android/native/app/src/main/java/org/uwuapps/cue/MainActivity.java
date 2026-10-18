package org.uwuapps.cue;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The app's one screen: cue.uwuapps.org in Capacitor's WebView.
 *
 * Everything the user sees is the site. This class only sets the window up
 * (no status bar, into the camera cutout, back through the page's history),
 * opens links and notification taps, and hands key presses to the page when
 * it has asked for them.
 */
public class MainActivity extends BridgeActivity {

    /** The site the app loads. capacitor.config.json's server.url, without the slash. */
    public static final String SITE = "https://cue.uwuapps.org";

    /** A remote id: six of the characters the site's codes are made of. */
    private static final Pattern CODE = Pattern.compile("^[BCDFGHJKLMNPQRSTVWXYZ2-9]{6}$");

    /** Marks an intent this activity has already acted on, so a recreated
     *  activity, or Capacitor handing over the launch intent again, does not
     *  open it twice. */
    private static final String HANDLED = "org.uwuapps.cue.handled";

    /** Set by CuePlugin.immersive: the navigation bar is hidden too. */
    static boolean immersive = false;

    /** Set by CuePlugin.keys: the volume and media keys go to the page. */
    static volatile boolean keysToPage = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        // Before super.onCreate, or the plugin is not injected into the first
        // page load.
        registerPlugin(CuePlugin.class);
        super.onCreate(savedInstanceState);

        Notifications.createChannels(this);

        // Into the camera cutout, rather than a black strip beside it on
        // phones before Android 15.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        // Back goes back through the page, and at the first page sends the app
        // to the background instead of closing it, so the script stays put.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge == null ? null : bridge.getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Here rather than in onCreate: SystemBars shows the bars as it starts,
        // and the shade or another app can leave them showing.
        if (hasFocus) applySystemBars();
    }

    /** The status bar hidden (a swipe shows it for a moment), and in
     *  fullscreen the navigation bar with it. */
    void applySystemBars() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
        if (immersive) {
            controller.hide(WindowInsetsCompat.Type.navigationBars());
        } else {
            controller.show(WindowInsetsCompat.Type.navigationBars());
        }
    }

    /**
     * Volume keys, and the play/pause and headset keys, as a clicker.
     *
     * Only while the page has asked for them (the setting in Prompter
     * settings), and only the press, not its repeats. Both the press and the
     * release are consumed, so the volume does not change as well.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (keysToPage) {
            String name = keyName(event.getKeyCode());
            if (name != null) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    CuePlugin.sendKey(name);
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

    /**
     * What the app was opened with: a link to the site, a uwu://cue/ link, or
     * a tapped "new version" notification.
     */
    private void handleIntent(Intent intent) {
        if (intent == null || intent.getBooleanExtra(HANDLED, false)) return;

        // A tapped push carries its data as extras.
        String type = intent.getStringExtra("type");
        if ("update".equals(type)) {
            intent.putExtra(HANDLED, true);
            intent.removeExtra("type");
            Intent update = new Intent(this, UpdateActivity.class);
            String version = intent.getStringExtra("version");
            if (version != null && version.matches("^\\d+(\\.\\d+){0,3}$")) {
                update.putExtra(UpdateActivity.EXTRA_VERSION, version);
            } else {
                update.putExtra(UpdateActivity.EXTRA_CHECK, true);
            }
            startActivity(update);
            return;
        }

        Uri uri = intent.getData();
        if (!Intent.ACTION_VIEW.equals(intent.getAction()) || uri == null) return;
        intent.putExtra(HANDLED, true);

        String url = pageFor(uri);
        if (url == null) return;
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().post(() -> bridge.getWebView().loadUrl(url));
        }
    }

    /**
     * The page on the site a link stands for. Only the two pages the site has,
     * and a remote id only when it is a valid one; anything else is the
     * prompter. Null for uwu://cue/watch, which only brings the app to the
     * front: the watch's Open on phone, which mustn't move a phone that is on
     * the remote page off it.
     */
    static String pageFor(Uri uri) {
        String path = uri.getPath() == null ? "" : uri.getPath();
        if ("uwu".equals(uri.getScheme())) {
            // uwu://cue/remote?id=XXXXXX has "remote" as its path.
            path = "/" + path.replaceFirst("^/+", "");
        }
        path = path.replaceFirst("\\.html$", "").replaceFirst("/+$", "");

        if ("uwu".equals(uri.getScheme()) && path.equals("/watch")) return null;

        if (path.equals("/remote")) {
            String id = uri.getQueryParameter("id");
            if (id != null && CODE.matcher(id.toUpperCase(Locale.ROOT)).matches()) {
                return SITE + "/remote?id=" + id.toUpperCase(Locale.ROOT);
            }
            return SITE + "/remote";
        }
        return SITE + "/";
    }
}
