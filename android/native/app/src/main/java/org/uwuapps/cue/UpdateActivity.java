package org.uwuapps.cue;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Updates the app from GitHub Releases, with Android's own installer.
 *
 * Started three ways: the update bar's Update (a version given: download at
 * once), the Edge Tray's Check for updates (`check`: look, then say there is
 * nothing newer or ask), and a tapped "new version" notification (a version
 * given, so the release check reads past the server's ten-minute cache).
 *
 * Before installing it checks the file came from this repository's releases,
 * matches GitHub's SHA-256 for it, is this app, and is newer. Android then
 * checks the signature itself: only the same key can update an installed app.
 */
public class UpdateActivity extends AppCompatActivity {

    static final String EXTRA_CHECK = "check";
    static final String EXTRA_VERSION = "version";
    static final String EXTRA_STATUS = "installStatus";

    private static final String RELEASE_API = MainActivity.SITE + "/api/app-release";
    private static final String APK_PREFIX = "https://github.com/augy-studios/uwuPromptr/releases/download/";
    private static final String RELEASES_PAGE = "https://github.com/augy-studios/uwuPromptr/releases/latest";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private TextView message;
    private ProgressBar progress;
    private Button primary;
    private Button secondary;

    /** Downloaded and checked, waiting for "Install unknown apps" to be allowed. */
    private File waitingToInstall;
    private boolean busy;

    private static final class Release {
        String version;
        String apk;
        String sha256;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_update);
        setFinishOnTouchOutside(false);
        message = findViewById(R.id.updateMessage);
        progress = findViewById(R.id.updateProgress);
        primary = findViewById(R.id.updatePrimary);
        secondary = findViewById(R.id.updateSecondary);
        // The installer reporting back after this screen had already gone.
        if (getIntent().hasExtra(EXTRA_STATUS)) {
            installFailed(getIntent().getIntExtra(EXTRA_STATUS, PackageInstaller.STATUS_FAILURE));
            return;
        }
        // Android 8 to 10 restart the app when "Install unknown apps" is
        // granted. The activity comes back with its intent and starts over,
        // and a download that already finished is reused rather than repeated.
        begin(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.hasExtra(EXTRA_STATUS)) {
            installFailed(intent.getIntExtra(EXTRA_STATUS, PackageInstaller.STATUS_FAILURE));
        } else if (!busy) {
            begin(intent);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from Android's "Install unknown apps" page.
        if (waitingToInstall != null && canInstall()) {
            File file = waitingToInstall;
            waitingToInstall = null;
            install(file);
        }
    }

    @Override
    protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }

    /* ---- looking ---- */

    private void begin(Intent intent) {
        boolean check = intent.getBooleanExtra(EXTRA_CHECK, false);
        String wanted = intent.getStringExtra(EXTRA_VERSION);
        busy = true;
        showBusy(getString(R.string.update_checking), -1);

        worker.execute(() -> {
            Release release;
            try {
                release = fetchRelease(wanted);
            } catch (Exception e) {
                runOnUiThread(() -> showDone(getString(R.string.update_offline), true));
                return;
            }

            String installed = installedVersion();
            if (release == null || !newer(release.version, installed)) {
                runOnUiThread(() -> showDone(getString(R.string.update_newest, installed), false));
                return;
            }

            if (check) {
                runOnUiThread(() -> offer(release, installed));
            } else {
                download(release);
            }
        });
    }

    private Release fetchRelease(String wanted) throws Exception {
        // ?v= is ignored by the server but gets past its cache, for a release
        // published seconds ago.
        String url = RELEASE_API + (wanted != null ? "?v=" + Uri.encode(wanted) : "");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (connection.getResponseCode() != 200) throw new IOException("HTTP " + connection.getResponseCode());
            String body;
            try (InputStream in = connection.getInputStream()) {
                body = new String(readAll(in), StandardCharsets.UTF_8);
            }
            JSONObject json = new JSONObject(body);
            if (json.isNull("version")) return null;
            Release release = new Release();
            release.version = json.getString("version");
            release.apk = json.getString("apk");
            release.sha256 = json.isNull("sha256") ? null : json.optString("sha256", null);
            return release;
        } finally {
            connection.disconnect();
        }
    }

    private void offer(Release release, String installed) {
        progress.setVisibility(View.GONE);
        message.setText(getString(R.string.update_available, release.version, installed));
        secondary.setText(R.string.update_not_now);
        secondary.setVisibility(View.VISIBLE);
        secondary.setOnClickListener((v) -> finish());
        primary.setText(R.string.update_now);
        primary.setVisibility(View.VISIBLE);
        primary.setOnClickListener((v) -> {
            showBusy(getString(R.string.update_downloading, release.version), 0);
            worker.execute(() -> download(release));
        });
    }

    /* ---- downloading (on the worker thread) ---- */

    private void download(Release release) {
        if (!release.apk.startsWith(APK_PREFIX) || !release.version.matches("^\\d+(\\.\\d+){0,3}$")) {
            runOnUiThread(() -> showFailed(getString(R.string.update_failed_check)));
            return;
        }

        File dir = new File(getCacheDir(), "updates");
        File file = new File(dir, "uwupromptr-" + release.version + ".apk");

        // Already here from before a restart, and still right: no second download.
        if (file.exists() && matches(file, release.sha256)) {
            verifyAndInstall(file);
            return;
        }

        runOnUiThread(() -> showBusy(getString(R.string.update_downloading, release.version), 0));
        clearOld(dir);
        dir.mkdirs();

        HttpURLConnection connection = null;
        try {
            // GitHub answers with a redirect to its file store; both are https,
            // which HttpURLConnection follows.
            connection = (HttpURLConnection) new URL(release.apk).openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            if (connection.getResponseCode() != 200) throw new IOException("HTTP " + connection.getResponseCode());

            long total = connection.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buffer = new byte[64 * 1024];
                long done = 0;
                int lastShown = -1;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("cancelled");
                    out.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    done += read;
                    if (total > 0) {
                        int percent = (int) (done * 100 / total);
                        if (percent != lastShown) {
                            lastShown = percent;
                            runOnUiThread(() -> progress.setProgress(percent));
                        }
                    }
                }
            }

            if (release.sha256 != null && !release.sha256.equalsIgnoreCase(hex(digest.digest()))) {
                file.delete();
                runOnUiThread(() -> showFailed(getString(R.string.update_failed_check)));
                return;
            }
        } catch (Exception e) {
            file.delete();
            runOnUiThread(() -> showFailed(getString(R.string.update_failed_download)));
            return;
        } finally {
            if (connection != null) connection.disconnect();
        }

        verifyAndInstall(file);
    }

    /** Same package, higher versionCode, before Android is asked to install it. */
    private void verifyAndInstall(File file) {
        PackageManager pm = getPackageManager();
        PackageInfo archive = pm.getPackageArchiveInfo(file.getPath(), 0);
        PackageInfo installed;
        try {
            installed = pm.getPackageInfo(getPackageName(), 0);
        } catch (PackageManager.NameNotFoundException e) {
            installed = null;
        }
        if (archive == null || installed == null || !getPackageName().equals(archive.packageName)) {
            file.delete();
            runOnUiThread(() -> showFailed(getString(R.string.update_failed_check)));
            return;
        }
        if (versionCode(archive) <= versionCode(installed)) {
            file.delete();
            runOnUiThread(() -> showFailed(getString(R.string.update_failed_older)));
            return;
        }
        runOnUiThread(() -> install(file));
    }

    /* ---- installing (on the UI thread) ---- */

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
    }

    private void install(File file) {
        if (!canInstall()) {
            // Android 8+: the first update needs "Install unknown apps" for
            // this app. onResume carries on when the user comes back.
            waitingToInstall = file;
            progress.setVisibility(View.GONE);
            message.setText(R.string.update_allow_installs);
            secondary.setText(R.string.update_not_now);
            secondary.setVisibility(View.VISIBLE);
            secondary.setOnClickListener((v) -> finish());
            primary.setText(R.string.update_open_settings);
            primary.setVisibility(View.VISIBLE);
            primary.setOnClickListener((v) -> startActivity(new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())
            )));
            return;
        }

        showBusy(getString(R.string.update_installing), -1);
        worker.execute(() -> {
            try {
                PackageInstaller installer = getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params =
                    new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(getPackageName());
                int id = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(id)) {
                    try (InputStream in = new FileInputStream(file);
                         OutputStream out = session.openWrite("uwupromptr.apk", 0, file.length())) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                        session.fsync(out);
                    }
                    // Mutable: the installer fills in the status and, when it
                    // needs the user, the confirm screen's intent.
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent status = PendingIntent.getBroadcast(
                        this, id, new Intent(this, InstallStatus.class), flags);
                    session.commit(status.getIntentSender());
                }
            } catch (Exception e) {
                runOnUiThread(() -> showFailed(getString(R.string.update_failed)));
            }
        });
    }

    private void installFailed(int status) {
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                // Cancelled on Android's confirm screen: nothing to explain.
                finish();
                return;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                showFailed(getString(R.string.update_failed_conflict));
                return;
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                showFailed(getString(R.string.update_failed_storage));
                return;
            default:
                showFailed(getString(R.string.update_failed));
        }
    }

    /* ---- the dialog's states ---- */

    private void showBusy(String text, int percent) {
        message.setText(text);
        progress.setVisibility(View.VISIBLE);
        progress.setIndeterminate(percent < 0);
        if (percent >= 0) progress.setProgress(percent);
        primary.setVisibility(View.GONE);
        secondary.setVisibility(View.GONE);
    }

    /** A sentence and OK; with `retry`, Try again as well. */
    private void showDone(String text, boolean retry) {
        busy = false;
        progress.setVisibility(View.GONE);
        message.setText(text);
        primary.setText(R.string.update_ok);
        primary.setVisibility(View.VISIBLE);
        primary.setOnClickListener((v) -> finish());
        if (retry) {
            secondary.setText(R.string.update_try_again);
            secondary.setVisibility(View.VISIBLE);
            secondary.setOnClickListener((v) -> begin(getIntent()));
        } else {
            secondary.setVisibility(View.GONE);
        }
    }

    private void showFailed(String text) {
        busy = false;
        progress.setVisibility(View.GONE);
        message.setText(text);
        primary.setText(R.string.update_ok);
        primary.setVisibility(View.VISIBLE);
        primary.setOnClickListener((v) -> finish());
        secondary.setText(R.string.update_open_github);
        secondary.setVisibility(View.VISIBLE);
        secondary.setOnClickListener((v) -> {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_PAGE)));
            finish();
        });
    }

    /* ---- helpers ---- */

    private String installedVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "0";
        }
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    /**
     * Whether `a` is a later version than `b`, number by number, so 1.10.0
     * comes after 1.9.0. The same rule as api/_lib/release.js and
     * js/app-update.js.
     */
    static boolean newer(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = (b == null ? "0" : b).split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0;
            int q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int parse(String part) {
        try {
            return Integer.parseInt(part.replaceAll("\\D.*$", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static boolean matches(File file, String sha256) {
        if (sha256 == null) return false;
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
            return sha256.equalsIgnoreCase(hex(digest.digest()));
        } catch (Exception e) {
            return false;
        }
    }

    private static void clearOld(File dir) {
        File[] old = dir.listFiles();
        if (old == null) return;
        for (File f : old) f.delete();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        return out.toByteArray();
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format("%02x", b));
        return out.toString();
    }
}
