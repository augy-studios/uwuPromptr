/*
 * What the watch knows: the prompter's state as the phone's app last sent it (StateListener),
 * and the watch's own settings, the wrist taps' interval and Twist to play or pause.
 *
 * The phone only sends while the watch keeps saying hello (Link.hello): every 20 seconds while
 * the watch's screen is open, ambient included, and whenever the tile is shown. So a state
 * that's old means the watch was put away, or the phone's app is closed, not that nothing's
 * happening.
 */
package org.uwuapps.cue.wear;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import androidx.wear.tiles.TileService;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.CopyOnWriteArrayList;

final class Store {
    /** How often the watch says hello while it's looking. Keep under watch.js's ATTACHED_MS. */
    static final long HELLO_EVERY_MS = 20_000;
    // Paused, the phone only sends in answer to a hello; two missed and it's gone.
    private static final long STALE_MS = 45_000;
    // A hello the phone didn't answer in this long: its app isn't open.
    private static final long ANSWER_MS = 4_000;

    /** The wrist taps' choices, in seconds. 0 is off. */
    static final int[] PACES = {0, 30, 60, 120, 300};

    static final double SPEED_MIN = 0.1;
    static final double SPEED_MAX = 40;

    private static final String PREFS = "cue";
    private static final Object lock = new Object();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final CopyOnWriteArrayList<Runnable> listeners = new CopyOnWriteArrayList<>();
    private static State cached;

    /** The watch's screen is open, ambient or not: keep the phone sending. */
    static volatile boolean watching;
    /** When the watch last asked the phone for the state. */
    static volatile long helloAt;

    private Store() {}

    /** One state from the phone, as watch.js's summary sends it. */
    static final class State {
        final boolean live;
        final String role;
        final boolean playing;
        final double speed;
        final long elapsed;
        final double progress;
        final String name;
        /** When it arrived, on this watch's clock. */
        final long at;

        State(JSONObject o, long at) {
            live = o.optBoolean("live");
            role = o.optString("role", "prompter");
            playing = o.optBoolean("playing");
            speed = o.optDouble("speed", 12);
            elapsed = Math.max(0, o.optLong("elapsed"));
            progress = Math.max(0, Math.min(100, o.optDouble("progress", 0)));
            name = o.optString("name", "");
            this.at = at;
        }

        /** The prompter's clock now, counted on from when this arrived while it plays. */
        long elapsedNow() {
            return playing ? elapsed + Math.max(0, System.currentTimeMillis() - at) : elapsed;
        }

        boolean remote() {
            return "remote".equals(role);
        }
    }

    static State state(Context c) {
        synchronized (lock) {
            if (cached == null) {
                SharedPreferences p = prefs(c);
                String raw = p.getString("state", null);
                if (raw != null) {
                    try {
                        cached = new State(new JSONObject(raw), p.getLong("at", 0));
                    } catch (JSONException ignored) {
                        // A damaged copy: as good as none.
                    }
                }
            }
            return cached;
        }
    }

    /** Whether the phone's app is there and answering. */
    static boolean reachable(State s) {
        long now = System.currentTimeMillis();
        if (s == null || now - s.at > STALE_MS) return false;
        long asked = helloAt;
        return !(asked > s.at && now - asked > ANSWER_MS);
    }

    /** Asked the phone a moment ago, and still waiting for the answer. */
    static boolean asking(State s) {
        long asked = helloAt;
        return asked > (s == null ? 0 : s.at) && System.currentTimeMillis() - asked <= ANSWER_MS;
    }

    /** A state from the phone (StateListener). */
    static void accept(Context c, byte[] data) {
        JSONObject o;
        try {
            o = new JSONObject(new String(data, StandardCharsets.UTF_8));
        } catch (JSONException e) {
            return;
        }
        long now = System.currentTimeMillis();
        State next = new State(o, now);
        State prev = state(c);
        synchronized (lock) {
            cached = next;
            lock.notifyAll();
        }
        prefs(c).edit().putString("state", o.toString()).putLong("at", now).apply();

        pace(c, prev, next);

        // The tile shows what's playing and the script's name; the clock counts by itself.
        if (prev == null || prev.playing != next.playing || prev.live != next.live
                || !prev.name.equals(next.name) || !reachable(prev)) {
            TileService.getUpdater(c).requestUpdate(RemoteTile.class);
        }

        for (Runnable r : listeners) main.post(r);

        // In ambient the watch's own timers can sleep, but a message from the phone always
        // wakes it: say hello from here too, so the phone doesn't stop.
        if (watching && now - helloAt > HELLO_EVERY_MS) Link.hello(c);
    }

    /**
     * Wrist taps. Every interval of the prompter's own clock, so a pause doesn't count and a
     * restart starts over; and a long one when the script reaches its end.
     */
    private static void pace(Context c, State prev, State next) {
        if (prev == null || !reachable(prev)) return;
        if (prev.playing && !next.playing && next.progress >= 99.5) {
            Buzz.end(c);
            return;
        }
        int every = pace(c);
        if (every <= 0 || !next.playing) return;
        long ms = every * 1000L;
        if (next.elapsed / ms > prev.elapsed / ms) Buzz.pace(c);
    }

    /**
     * The next state to arrive after `after`, waiting up to `timeoutMs` for it; whatever's
     * known if none comes. Not on the main thread.
     */
    static State await(Context c, long after, long timeoutMs) {
        long until = System.currentTimeMillis() + timeoutMs;
        synchronized (lock) {
            State s = state(c);
            while ((s == null || s.at <= after) && System.currentTimeMillis() < until) {
                try {
                    lock.wait(Math.max(1, until - System.currentTimeMillis()));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
                s = cached;
            }
            return s;
        }
    }

    static void listen(Runnable r) {
        listeners.add(r);
    }

    static void unlisten(Runnable r) {
        listeners.remove(r);
    }

    /* ---- settings ---- */

    static int pace(Context c) {
        return prefs(c).getInt("pace", 60);
    }

    static void setPace(Context c, int seconds) {
        prefs(c).edit().putInt("pace", seconds).apply();
    }

    static boolean twist(Context c) {
        return prefs(c).getBoolean("twist", false);
    }

    static void setTwist(Context c, boolean on) {
        prefs(c).edit().putBoolean("twist", on).apply();
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
