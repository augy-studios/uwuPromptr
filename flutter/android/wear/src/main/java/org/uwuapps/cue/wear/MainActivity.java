/*
 * The watch's screen: the remote for the prompter on your phone, or for whichever prompter
 * the phone's remote page is connected to.
 *
 * What ColorOS watches do natively, done the Wear OS way:
 *   - The crown sets the speed, a tenth at a time, with a click you feel at each step and a
 *     firmer one at each whole number (the screen's own haptics, the watch's linear motor).
 *   - Ambient mode: with your wrist down the screen dims to the script, the clock and the
 *     speed in outline, and stays there rather than going back to the watch face.
 *   - Gestures: Twist to play or pause (Twist.java), and the wrist flicks and extra buttons
 *     some watches send as keys.
 * Plus wrist taps every interval while the script plays (Store.pace).
 *
 * Touch scrolls the screen; the crown is kept for the speed.
 */
package org.uwuapps.cue.wear;

import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.wear.ambient.AmbientLifecycleObserver;
import androidx.wear.ambient.AmbientLifecycleObserverKt;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

public class MainActivity extends ComponentActivity {
    // The site's Classic green, and the watch's greys.
    private static final int BRAND = 0xFFCCFFCC;
    private static final int GREY = 0xFFAAAAAA;
    private static final int DIM = 0xFF707070;
    private static final int KEY = 0xFF2A2A2A;

    // The clock between the phone's once-a-second states.
    private static final long TICK_MS = 250;
    // A turn of the crown owns the speed on screen this long, before the phone's word does.
    private static final long CROWN_HOLD_MS = 1500;
    // At most this often to the phone while the crown turns.
    private static final long CROWN_SEND_MS = 80;
    // How far a smooth crown turns for one step.
    private static final float CROWN_STEP_DP = 18;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<View> interactiveOnly = new ArrayList<>();
    private final Random shift = new Random();

    private ScrollView scroll;
    private TextView status, name, clock, speed, hint, play, paceBtn, twistBtn;
    private View controls, restart, open, twistNote;
    private ProgressBar progress;

    private AmbientLifecycleObserver ambient;
    private boolean inAmbient;
    private Twist twist;
    private boolean resumed;

    private double crownSpeed = -1;
    private long crownAt;
    private float crownPx;
    private boolean crownQueued;

    private final Runnable render = this::render;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            render();
            main.postDelayed(this, TICK_MS);
        }
    };

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            Link.hello(MainActivity.this);
            main.postDelayed(this, Store.HELLO_EVERY_MS);
        }
    };

    private final AmbientLifecycleObserver.AmbientLifecycleCallback ambientCallback =
            new AmbientLifecycleObserver.AmbientLifecycleCallback() {
                @Override
                public void onEnterAmbient(AmbientLifecycleObserver.AmbientDetails details) {
                    inAmbient = true;
                    main.removeCallbacks(ticker);
                    showAmbient(details.getDeviceHasLowBitAmbient());
                    render();
                }

                @Override
                public void onUpdateAmbient() {
                    // Once a minute. A few pixels each time, so nothing burns in.
                    scroll.setTranslationX(dp(shift.nextInt(9) - 4));
                    scroll.setTranslationY(dp(shift.nextInt(9) - 4));
                    if (System.currentTimeMillis() - Store.helloAt > Store.HELLO_EVERY_MS) Link.hello(MainActivity.this);
                    render();
                }

                @Override
                public void onExitAmbient() {
                    inAmbient = false;
                    showInteractive();
                    if (resumed) main.post(ticker);
                    render();
                }
            };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        build();
        twist = new Twist(this, this::gesture);
        twistBtn.setVisibility(twist.available() ? View.VISIBLE : View.GONE);
        twistNote.setVisibility(twist.available() ? View.VISIBLE : View.GONE);
        ambient = AmbientLifecycleObserverKt.AmbientLifecycleObserver(this, ambientCallback);
        getLifecycle().addObserver(ambient);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        Store.watching = true;
        Store.listen(render);
        main.post(heartbeat);
        if (!inAmbient) main.post(ticker);
        if (Store.twist(this)) twist.start();
        // Focus, so the crown's turns come here.
        scroll.requestFocus();
        render();
    }

    @Override
    protected void onPause() {
        resumed = false;
        Store.watching = false;
        Store.unlisten(render);
        main.removeCallbacks(heartbeat);
        main.removeCallbacks(ticker);
        twist.stop();
        super.onPause();
    }

    /* ---- what's shown ---- */

    private void render() {
        Store.State s = Store.state(this);
        boolean ok = Store.reachable(s);
        boolean asking = Store.asking(s);
        boolean usable = ok && s.live;

        String said;
        if (!ok) {
            said = asking ? "Finding your phone…" : "Open uwuPromptr on your phone.";
        } else if (s.remote() && !s.live) {
            said = "Connect your phone’s remote to a prompter.";
        } else if (inAmbient) {
            said = s.playing ? "Playing" : "Paused";
        } else {
            said = s.remote() ? "Through your phone’s remote" : "On your phone";
        }
        setText(status, said);
        setText(name, s == null ? "uwuPromptr" : (s.name.isEmpty() ? "Untitled script" : s.name));

        long elapsed = s == null ? 0 : s.elapsedNow();
        setText(clock, inAmbient ? (elapsed / 60000) + " min" : clock(elapsed));
        setText(speed, String.format(Locale.ROOT, "Speed %.1f", speedShown(s)));
        setText(play, s != null && s.playing ? "Pause" : "Play");
        progress.setProgress(s == null ? 0 : (int) Math.round(s.progress * 10));

        for (View v : new View[]{play, restart, controls}) v.setAlpha(usable ? 1f : 0.4f);
        if (!inAmbient) open.setVisibility(ok || asking ? View.GONE : View.VISIBLE);

        setText(paceBtn, "Wrist taps: " + paceName(Store.pace(this)));
        setText(twistBtn, "Twist to play or pause: " + (Store.twist(this) ? "On" : "Off"));
    }

    private double speedShown(Store.State s) {
        if (crownSpeed > 0 && System.currentTimeMillis() - crownAt < CROWN_HOLD_MS) return crownSpeed;
        return s == null ? 12 : s.speed;
    }

    private static String clock(long ms) {
        long total = ms / 1000;
        return String.format(Locale.ROOT, "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60);
    }

    private static String paceName(int seconds) {
        switch (seconds) {
            case 0: return "Off";
            case 30: return "every 30 s";
            case 60: return "every minute";
            default: return "every " + (seconds / 60) + " min";
        }
    }

    private static void setText(TextView v, String text) {
        if (!TextUtils.equals(v.getText(), text)) v.setText(text);
    }

    /* ---- ambient ---- */

    private void showAmbient(boolean lowBit) {
        for (View v : interactiveOnly) v.setVisibility(View.GONE);
        name.setTextColor(Color.WHITE);
        speed.setTextColor(GREY);
        // Low-bit screens have no greys to smooth edges with.
        for (TextView t : new TextView[]{status, name, clock, speed}) t.getPaint().setAntiAlias(!lowBit);
        scroll.scrollTo(0, 0);
    }

    private void showInteractive() {
        for (View v : interactiveOnly) v.setVisibility(View.VISIBLE);
        twistBtn.setVisibility(twist.available() ? View.VISIBLE : View.GONE);
        twistNote.setVisibility(twist.available() ? View.VISIBLE : View.GONE);
        name.setTextColor(BRAND);
        speed.setTextColor(BRAND);
        for (TextView t : new TextView[]{status, name, clock, speed}) t.getPaint().setAntiAlias(true);
        scroll.setTranslationX(0);
        scroll.setTranslationY(0);
    }

    /* ---- the crown ---- */

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        if (ev.getAction() == MotionEvent.ACTION_SCROLL && ev.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER)) {
            // Clockwise is a negative scroll, and faster.
            if (!inAmbient) crown(-ev.getAxisValue(MotionEvent.AXIS_SCROLL));
            return true;
        }
        return super.dispatchGenericMotionEvent(ev);
    }

    private void crown(float axis) {
        Store.State s = Store.state(this);
        if (!Store.reachable(s) || !s.live) {
            haptic(HapticFeedbackConstants.REJECT);
            return;
        }
        int steps;
        if (Math.abs(axis) >= 1f) {
            // A rotating bezel's click: one step each.
            steps = Math.round(axis);
        } else {
            crownPx += axis * ViewConfiguration.get(this).getScaledVerticalScrollFactor();
            float step = dp(CROWN_STEP_DP);
            steps = (int) (crownPx / step);
            crownPx -= steps * step;
        }
        if (steps == 0) return;

        double from = speedShown(s);
        double to = clampSpeed(from + steps * 0.1);
        if (to == from) {
            haptic(HapticFeedbackConstants.REJECT);
            return;
        }
        crownSpeed = to;
        crownAt = System.currentTimeMillis();
        boolean whole = Math.floor(from + 1e-6) != Math.floor(to + 1e-6);
        haptic(whole ? wholeHaptic() : notchHaptic());
        if (!crownQueued) {
            crownQueued = true;
            main.postDelayed(() -> {
                crownQueued = false;
                Link.setSpeed(this, crownSpeed);
            }, CROWN_SEND_MS);
        }
        render();
    }

    private static double clampSpeed(double v) {
        double r = Math.round(v * 10) / 10.0;
        return Math.max(Store.SPEED_MIN, Math.min(Store.SPEED_MAX, r));
    }

    private static int notchHaptic() {
        return Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.SEGMENT_FREQUENT_TICK : HapticFeedbackConstants.CLOCK_TICK;
    }

    private static int wholeHaptic() {
        return Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CONFIRM;
    }

    private void haptic(int kind) {
        scroll.performHapticFeedback(kind);
    }

    /* ---- gestures and keys ---- */

    /** Wrist flicks (on watches that still send them) and spare buttons: play or pause. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_NAVIGATE_NEXT:
            case KeyEvent.KEYCODE_NAVIGATE_PREVIOUS:
            case KeyEvent.KEYCODE_STEM_1:
            case KeyEvent.KEYCODE_STEM_2:
            case KeyEvent.KEYCODE_STEM_3:
                if (event.getRepeatCount() == 0) gesture();
                return true;
            default:
                return super.onKeyDown(keyCode, event);
        }
    }

    private void gesture() {
        Store.State s = Store.state(this);
        if (!Store.reachable(s) || !s.live) {
            haptic(HapticFeedbackConstants.REJECT);
            return;
        }
        haptic(HapticFeedbackConstants.CONFIRM);
        Link.command(this, "toggle");
    }

    /* ---- the controls ---- */

    private void toggle() {
        if (usable()) Link.command(this, "toggle");
    }

    private void restart() {
        if (usable()) Link.command(this, "reset");
    }

    private void nudge(int direction) {
        if (!usable()) return;
        crownSpeed = clampSpeed(speedShown(Store.state(this)) + direction);
        crownAt = System.currentTimeMillis();
        Link.nudgeSpeed(this, direction);
        render();
    }

    private boolean usable() {
        Store.State s = Store.state(this);
        return Store.reachable(s) && s.live;
    }

    private void openOnPhone() {
        Link.openOnPhone(this, ok -> {
            Toast.makeText(this, ok ? "Opening on your phone" : "Couldn’t reach your phone", Toast.LENGTH_SHORT).show();
            // Ask again once it's had a moment to open.
            if (ok) main.postDelayed(() -> Link.hello(this), 2500);
        });
    }

    private void cyclePace() {
        int now = Store.pace(this);
        int next = Store.PACES[0];
        for (int i = 0; i < Store.PACES.length; i++) {
            if (Store.PACES[i] == now) next = Store.PACES[(i + 1) % Store.PACES.length];
        }
        Store.setPace(this, next);
        render();
    }

    private void toggleTwist() {
        boolean on = !Store.twist(this);
        Store.setTwist(this, on);
        if (on && resumed) twist.start();
        else twist.stop();
        render();
    }

    /* ---- the views ---- */

    private void build() {
        scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.BLACK);
        scroll.setFocusable(true);
        scroll.setFocusableInTouchMode(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        // Round screens: room at the top and bottom, and in from the edges.
        boolean round = getResources().getConfiguration().isScreenRound();
        int side = dp(round ? 22 : 10), top = dp(round ? 26 : 10), bottom = dp(round ? 44 : 14);
        col.setPadding(side, top, side, bottom);
        scroll.addView(col);
        setContentView(scroll);

        status = text(12, GREY, false);
        name = text(15, BRAND, true);
        name.setMaxLines(1);
        name.setEllipsize(TextUtils.TruncateAt.END);
        clock = text(30, Color.WHITE, false);
        clock.setFontFeatureSettings("tnum");
        speed = text(15, BRAND, true);
        hint = text(11, DIM, false);
        hint.setText("Turn the crown for the speed");
        col.addView(status);
        col.addView(name);
        col.addView(clock);
        col.addView(speed);
        col.addView(only(hint));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setPadding(0, dp(6), 0, dp(6));
        TextView slower = key("−", 44, 44, KEY, Color.WHITE, v -> nudge(-1));
        slower.setContentDescription("Slower");
        play = key("Play", 80, 52, BRAND, Color.BLACK, v -> toggle());
        TextView faster = key("+", 44, 44, KEY, Color.WHITE, v -> nudge(1));
        faster.setContentDescription("Faster");
        row.addView(slower);
        row.addView(gapWide(8));
        row.addView(play);
        row.addView(gapWide(8));
        row.addView(faster);
        controls = row;
        col.addView(only(row));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(1000);
        progress.setProgressTintList(ColorStateList.valueOf(BRAND));
        progress.setLayoutParams(new LinearLayout.LayoutParams(dp(120), dp(8)));
        col.addView(only(progress));

        restart = key("Restart", 120, 40, KEY, Color.WHITE, v -> restart());
        col.addView(only(spaced(restart)));
        open = key("Open on phone", 140, 40, BRAND, Color.BLACK, v -> openOnPhone());
        col.addView(only(spaced(open)));

        TextView heading = text(12, GREY, false);
        heading.setText("On your wrist");
        heading.setPadding(0, dp(16), 0, dp(2));
        col.addView(only(heading));
        paceBtn = key("", 150, 44, KEY, Color.WHITE, v -> cyclePace());
        col.addView(only(spaced(paceBtn)));
        TextView paceNote = text(11, DIM, false);
        paceNote.setText("Two taps each time, by the prompter’s clock, and three long ones at the end.");
        col.addView(only(paceNote));
        twistBtn = key("", 150, 52, KEY, Color.WHITE, v -> toggleTwist());
        col.addView(only(spaced(twistBtn)));
        TextView note = text(11, DIM, false);
        note.setText("A quick turn of the wrist and back.");
        twistNote = note;
        col.addView(only(note));
    }

    private View only(View v) {
        interactiveOnly.add(v);
        return v;
    }

    private View spaced(View v) {
        LinearLayout.LayoutParams p = (LinearLayout.LayoutParams) v.getLayoutParams();
        p.topMargin = dp(6);
        return v;
    }

    private TextView text(float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        t.setPadding(0, dp(2), 0, dp(2));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return t;
    }

    private TextView key(String label, int widthDp, int heightDp, int fill, int ink, View.OnClickListener click) {
        TextView k = new TextView(this);
        k.setText(label);
        k.setTextColor(ink);
        k.setTextSize(TypedValue.COMPLEX_UNIT_SP, label.length() <= 1 ? 22 : 14);
        k.setTypeface(Typeface.DEFAULT_BOLD);
        k.setGravity(Gravity.CENTER);
        k.setPadding(dp(8), 0, dp(8), 0);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(heightDp) / 2f);
        k.setBackground(new RippleDrawable(ColorStateList.valueOf(0x40FFFFFF), shape, null));
        k.setClickable(true);
        k.setOnClickListener(click);
        k.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), LinearLayout.LayoutParams.WRAP_CONTENT));
        k.setMinHeight(dp(heightDp));
        return k;
    }

    private View gapWide(int widthDp) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), 1));
        return v;
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
