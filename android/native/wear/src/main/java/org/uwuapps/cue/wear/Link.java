/*
 * The watch's side of the link to the phone, over the Wearable Data Layer's messages.
 *
 * What goes to the phone is the web remote's own messages (js/remote.js), so the page treats
 * the watch as one more remote: { type: "hello" } asks for the state, and
 * { type: "command", name, ... } does one thing. The page (js/watch.js) takes only play,
 * pause, toggle, reset, and the speed, whatever arrives.
 *
 * Messages go out one at a time, in order, on one thread, so a turn of the crown's speeds
 * land in the order they were set.
 */
package org.uwuapps.cue.wear;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.ContextCompat;
import androidx.wear.remote.interactions.RemoteActivityHelper;

import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class Link {
    // Keep in step with the phone's WatchLink.java.
    static final String TO_PHONE = "/cue/remote";
    static final String FROM_PHONE = "/cue/state";

    private static final long NODES_FOR_MS = 30_000;
    private static final long WAIT_S = 3;

    private static final ExecutorService out = Executors.newSingleThreadExecutor();
    private static List<String> nodes = new ArrayList<>();
    private static long nodesAt;

    private Link() {}

    /* ---- what the watch says ---- */

    static void hello(Context c) {
        Store.helloAt = System.currentTimeMillis();
        send(c, message("hello"));
    }

    static void command(Context c, String name) {
        send(c, command(name));
    }

    /** The speed one whole step up (+1) or down (-1), as the remote's << and >> do. */
    static void nudgeSpeed(Context c, int direction) {
        send(c, nudge(direction));
    }

    static void setSpeed(Context c, double speed) {
        JSONObject m = command("set");
        try {
            m.put("setting", "speed");
            m.put("value", Double.parseDouble(String.format(Locale.ROOT, "%.1f", speed)));
        } catch (JSONException ignored) {
            // put() on a fresh object with a finite number does not throw.
        }
        send(c, m);
    }

    /** For the tile, which waits on its own thread: a click, or a hello. True if it went. */
    static boolean sendNow(Context c, String click) {
        JSONObject m;
        switch (click) {
            case "toggle":
            case "reset":
                m = command(click);
                break;
            case "slower":
                m = nudge(-1);
                break;
            case "faster":
                m = nudge(1);
                break;
            default:
                Store.helloAt = System.currentTimeMillis();
                m = message("hello");
        }
        return deliver(c, m);
    }

    /**
     * Opens uwuPromptr on the phone: uwu://cue/watch brings the app to the front without
     * moving it off the page it's on. `done` hears whether the phone took it.
     */
    static void openOnPhone(Context c, Consumer<Boolean> done) {
        Intent open = new Intent(Intent.ACTION_VIEW)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setData(Uri.parse("uwu://cue/watch"));
        try {
            ListenableFuture<Void> f = new RemoteActivityHelper(c, out).startRemoteActivity(open);
            f.addListener(() -> {
                boolean ok;
                try {
                    f.get();
                    ok = true;
                } catch (Exception e) {
                    ok = false;
                }
                done.accept(ok);
            }, ContextCompat.getMainExecutor(c));
        } catch (RuntimeException e) {
            done.accept(false);
        }
    }

    /* ---- the wire ---- */

    private static JSONObject message(String type) {
        JSONObject m = new JSONObject();
        try {
            m.put("type", type);
        } catch (JSONException ignored) {
            // Not for a string.
        }
        return m;
    }

    private static JSONObject command(String name) {
        JSONObject m = message("command");
        try {
            m.put("name", name);
        } catch (JSONException ignored) {
            // Not for a string.
        }
        return m;
    }

    private static JSONObject nudge(int direction) {
        JSONObject m = command("nudge");
        try {
            m.put("setting", "speed");
            m.put("value", direction < 0 ? -1 : 1);
            m.put("coarse", true);
        } catch (JSONException ignored) {
            // Not for these.
        }
        return m;
    }

    private static void send(Context c, JSONObject m) {
        Context app = c.getApplicationContext();
        out.execute(() -> deliver(app, m));
    }

    private static boolean deliver(Context c, JSONObject m) {
        byte[] bytes = m.toString().getBytes(StandardCharsets.UTF_8);
        boolean sent = false;
        for (String node : nodes(c)) {
            try {
                Tasks.await(Wearable.getMessageClient(c).sendMessage(node, TO_PHONE, bytes), WAIT_S, TimeUnit.SECONDS);
                sent = true;
            } catch (Exception e) {
                // That phone's out of reach: look again next time.
                nodesAt = 0;
            }
        }
        return sent;
    }

    /** The phone, or phones, connected now. Looked up again every half minute. */
    private static synchronized List<String> nodes(Context c) {
        if (System.currentTimeMillis() - nodesAt < NODES_FOR_MS && !nodes.isEmpty()) return nodes;
        List<String> found = new ArrayList<>();
        try {
            for (Node n : Tasks.await(Wearable.getNodeClient(c).getConnectedNodes(), WAIT_S, TimeUnit.SECONDS)) {
                found.add(n.getId());
            }
        } catch (Exception e) {
            // No phone, or no Wear OS services: nothing to send to.
        }
        nodes = found;
        nodesAt = System.currentTimeMillis();
        return found;
    }
}
